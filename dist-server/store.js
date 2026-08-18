// Bot + thread persistence. bots.json holds bot records (including the
// thread→instance binding and per-instance resume cursors — upstream's
// ProviderSessionDirectory, recipe step 6: persist the binding from day
// one). messages-<threadId>.json holds the folded transcript.
import { existsSync, readFileSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic.js";
import { peerAllowKey } from "./peer-approval-key.js";
import { DATA_DIR } from "./config.js";
import * as mdb from "./message-db.js";
import { workspaceDir } from "./workspace.js";
import { newId } from "./contracts.js";
import { pickBotName } from "./names.js";
import { redactSecretsInText } from "./redact.js";
/** Everything the BOT authored is scrubbed of content-shaped secrets before
 * it is stored: its reply text, a tool title (an ACP engine's title can be
 * the whole command line), a permission card's summary. What the user typed
 * is theirs and stays as typed. Stored, not just displayed: the transcript
 * is replayed into every rebuild, and a leaked key would otherwise be
 * permanent. */
function redactBotAuthored(message) {
    if (message.role !== "bot")
        return message;
    const out = { ...message };
    if (typeof out.text === "string")
        out.text = redactSecretsInText(out.text);
    if (out.tool?.name)
        out.tool = { ...out.tool, name: redactSecretsInText(out.tool.name) };
    if (out.card) {
        const card = { ...out.card };
        card.title = redactSecretsInText(card.title);
        if (typeof card.subtitle === "string")
            card.subtitle = redactSecretsInText(card.subtitle);
        if (typeof card.summary === "string")
            card.summary = redactSecretsInText(card.summary);
        out.card = card;
    }
    if (out.connector) {
        out.connector = {
            ...out.connector,
            label: redactSecretsInText(out.connector.label),
            description: redactSecretsInText(out.connector.description),
            error: out.connector.error ? redactSecretsInText(out.connector.error) : undefined,
        };
    }
    return out;
}
/** The states in which the bot cannot take a new message. */
export const ACTIVITY_BUSY = new Set(["working", "waiting-on-you", "no-signal"]);
/** What a task is called before its first message names it. */
export const UNTITLED_TASK = "New task";
/** A task's name, taken from the first thing you asked it to do. */
export function titleFromMessage(text) {
    const line = text.trim().split("\n")[0].trim();
    return line.length > 48 ? `${line.slice(0, 47)}…` : line || UNTITLED_TASK;
}
const BOTS_FILE = join(DATA_DIR, "bots.json");
const GROUPS_FILE = join(DATA_DIR, "groups.json");
const messagesFile = (threadId) => join(DATA_DIR, `messages-${threadId}.json`);
const COLORS = [
    "green",
    "blue",
    "red",
    "orange",
    "purple",
    "cyan",
    "pink",
    "yellow",
    "teal",
    "coral",
];
/** Resolve @mentions in a message against a bot roster: `@` must start a
 * word, the name must end on a word boundary (so "@New Bottle" never matches
 * "New Bot"), names match case-insensitively, longest name wins (so
 * "@New Bot 2" never half-matches "New Bot"), hidden bots skipped, results
 * deduped. Callers pre-filter the sender out of `peers`. */
export function mentionedBots(text, peers) {
    const candidates = peers
        .filter((p) => !p.hidden && p.name.trim())
        .sort((a, b) => b.name.length - a.name.length);
    const lower = text.toLowerCase();
    const found = [];
    let at = -1;
    while ((at = lower.indexOf("@", at + 1)) !== -1) {
        if (at > 0 && !/\s/.test(text[at - 1]))
            continue; // user@host, not a tag
        const rest = lower.slice(at + 1);
        const hit = candidates.find((p) => {
            const name = p.name.toLowerCase();
            if (!rest.startsWith(name))
                return false;
            const after = rest[name.length]; // must not run into a longer word
            return after === undefined || !/[a-z0-9]/i.test(after);
        });
        if (hit && !found.includes(hit))
            found.push(hit);
    }
    return found;
}
/** Normalize persisted or API-provided routing. Old rooms did not have this
 * field; giving them their first member as lead fixes the old silent-send
 * behavior without making every prompt fan out to every model. */
export function normalizeGroupDefaultResponder(value, memberIds, dm = false) {
    if (dm)
        return { kind: "mentions" };
    if (value && typeof value === "object") {
        const candidate = value;
        if (candidate.kind === "everyone")
            return { kind: "everyone" };
        if (candidate.kind === "mentions")
            return { kind: "mentions" };
        if (candidate.kind === "member" &&
            typeof candidate.botId === "string" &&
            memberIds.includes(candidate.botId)) {
            return { kind: "member", botId: candidate.botId };
        }
    }
    if (memberIds.length === 0)
        return { kind: "mentions" };
    return { kind: "member", botId: memberIds[0] };
}
/** Resolve the bots invoked by a human room message. Explicit targets win;
 * otherwise the room policy chooses one member, everyone, or nobody. */
export function roomResponders(text, members, defaultResponder) {
    const available = members.filter((member) => !member.hidden);
    if (/(?:^|\s)@everyone\b/i.test(text))
        return available;
    const mentioned = mentionedBots(text, available);
    if (mentioned.length)
        return mentioned;
    if (defaultResponder.kind === "everyone")
        return available;
    if (defaultResponder.kind === "member") {
        const lead = available.find((member) => member.id === defaultResponder.botId);
        return lead ? [lead] : [];
    }
    return [];
}
const onboardingCard = () => ({
    title: "What do you mostly want help with?",
    subtitle: "Pick whatever's closest; we can always expand from there.",
    options: ["Work & projects", "Writing & research", "Life admin", "A bit of everything"],
});
export class Store {
    bots = [];
    groups = [];
    threads = new Map();
    defaultSelection;
    listeners = new Set();
    constructor(defaultSelection) {
        this.defaultSelection = defaultSelection;
        mkdirSync(DATA_DIR, { recursive: true });
        try {
            this.bots = JSON.parse(readFileSync(BOTS_FILE, "utf8"));
        }
        catch {
            this.bots = [];
        }
        try {
            this.groups = JSON.parse(readFileSync(GROUPS_FILE, "utf8"));
        }
        catch {
            this.groups = [];
        }
        // busy never survives a restart — no turn does either. Rooms saved
        // before default responders existed adopt their first member as lead.
        let botsMigrated = false;
        let chiefSeen = false;
        let groupsMigrated = false;
        for (const b of this.bots) {
            // transient state never survives a restart — and if a previous
            // process died mid-turn, bots.json still says busy/working; persist
            // the reset so the next load does not read it again
            if (b.busy || (b.activity !== undefined && b.activity !== "idle"))
                botsMigrated = true;
            b.busy = false;
            b.activity = "idle";
        }
        for (const b of this.bots) {
            if (!b.chiefOfStaff)
                continue;
            if (!chiefSeen) {
                chiefSeen = true;
                if (b.hidden) {
                    b.hidden = false;
                    botsMigrated = true;
                }
                continue;
            }
            b.chiefOfStaff = false;
            botsMigrated = true;
        }
        // Peer grants originally used mutable display names (ask_bot:@Helper).
        // Convert only when exactly one bot has that name; ambiguous legacy
        // entries remain inert rather than granting access to the wrong bot.
        for (const b of this.bots) {
            if (!b.alwaysAllow?.length)
                continue;
            let changed = false;
            const migrated = b.alwaysAllow.map((key) => {
                const match = key.match(/^(ask_bot|delegate_bot):@(.+)$/);
                if (!match)
                    return key;
                const candidates = this.bots.filter((candidate) => candidate.name === match[2]);
                if (candidates.length !== 1)
                    return key;
                changed = true;
                return peerAllowKey(match[1], candidates[0].id);
            });
            if (changed) {
                b.alwaysAllow = [...new Set(migrated)];
                botsMigrated = true;
            }
        }
        for (const g of this.groups) {
            g.busyBotId = null;
            const normalized = normalizeGroupDefaultResponder(g.defaultResponder, g.memberIds, Boolean(g.dm));
            if (JSON.stringify(normalized) !== JSON.stringify(g.defaultResponder))
                groupsMigrated = true;
            g.defaultResponder = normalized;
        }
        if (botsMigrated)
            this.saveBots();
        if (groupsMigrated)
            this.saveGroups();
        // bots saved before tasks existed have one endless thread; adopt it as
        // their first task so nothing is lost and nothing special-cases it
        for (const b of this.bots) {
            if (b.tasks?.length)
                continue;
            b.tasks = [
                {
                    threadId: b.threadId,
                    title: this.firstUserLine(b.threadId) ?? UNTITLED_TASK,
                    createdAt: b.createdAt,
                    resumeCursors: b.resumeCursors ?? {},
                },
            ];
        }
        // Search reads SQLite directly, so migrate every known legacy transcript
        // at startup rather than waiting until the user happens to open it. Only
        // pending JSON files are touched; already-migrated threads stay lazy.
        const knownThreads = new Set([
            ...this.bots.flatMap((b) => [b.threadId, ...(b.tasks ?? []).map((task) => task.threadId)]),
            ...this.groups.map((group) => group.threadId),
        ]);
        for (const threadId of knownThreads) {
            const legacyFile = messagesFile(threadId);
            if (existsSync(legacyFile))
                mdb.readThread(threadId, legacyFile);
        }
    }
    saveBots() {
        writeFileAtomic(BOTS_FILE, JSON.stringify(this.bots, null, 2));
    }
    saveGroups() {
        writeFileAtomic(GROUPS_FILE, JSON.stringify(this.groups.map(({ busyBotId, ...g }) => g), null, 2));
    }
    // ── groups ────────────────────────────────────────────────────────────
    /** Subscribe to every write. Listeners run after the write and after
     * save; a throwing listener never breaks the write. */
    onChange(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    emit(change) {
        for (const listener of [...this.listeners]) {
            try {
                listener(change);
            }
            catch (error) {
                console.error("store: change listener threw", error);
            }
        }
    }
    group(id) {
        return this.groups.find((g) => g.id === id);
    }
    groupByThread(threadId) {
        return this.groups.find((g) => g.threadId === threadId);
    }
    createGroup(name, memberIds, dm = false) {
        const group = {
            id: newId(),
            threadId: newId(),
            name,
            memberIds,
            defaultResponder: dm ? { kind: "mentions" } : { kind: "member", botId: memberIds[0] },
            bulletin: "",
            unread: false,
            createdAt: Date.now(),
            dm: dm || undefined,
            busyBotId: null,
        };
        this.groups.unshift(group);
        this.saveGroups();
        this.emit({ type: "group", groupId: group.id });
        return group;
    }
    /** The bot⇄bot channel for a pair, if it exists (order-insensitive). */
    dmGroup(a, b) {
        return this.groups.find((g) => g.dm && g.memberIds.length === 2 && g.memberIds.includes(a) && g.memberIds.includes(b));
    }
    patchGroup(id, patch) {
        const group = this.group(id);
        if (!group)
            return null;
        Object.assign(group, patch);
        group.defaultResponder = normalizeGroupDefaultResponder(group.defaultResponder, group.memberIds, Boolean(group.dm));
        this.saveGroups();
        this.emit({ type: "group", groupId: group.id });
        return group;
    }
    /** A thread's durable record: DB rows plus any legacy JSON leftovers. */
    deleteThreadRecord(threadId) {
        this.threads.delete(threadId);
        mdb.deleteThread(threadId);
        for (const file of [messagesFile(threadId), `${messagesFile(threadId)}.imported`]) {
            try {
                unlinkSync(file);
            }
            catch { }
        }
    }
    deleteGroup(id) {
        const group = this.group(id);
        if (!group)
            return false;
        this.groups = this.groups.filter((g) => g.id !== id);
        this.saveGroups();
        this.deleteThreadRecord(group.threadId);
        this.emit({ type: "group.deleted", groupId: id });
        return true;
    }
    /** Toggle an emoji reaction on a message ("user" or a member botId). */
    toggleReaction(threadId, messageId, emoji, by) {
        const existing = this.messagesFor(threadId).find((m) => m.id === messageId);
        if (!existing)
            return null;
        const reactions = existing.reactions ?? [];
        const at = reactions.findIndex((r) => r.emoji === emoji && r.by === by);
        const next = at >= 0 ? reactions.filter((_, i) => i !== at) : [...reactions, { emoji, by }];
        return this.patchMessage(threadId, messageId, { reactions: next.length ? next : undefined });
    }
    thread(threadId) {
        let t = this.threads.get(threadId);
        if (t)
            return t;
        // SQLite is the source of truth; a thread with no rows imports its
        // legacy messages-<threadId>.json once, inside readThread
        const { messages, activeLeafId: storedLeaf } = mdb.readThread(threadId, messagesFile(threadId));
        let activeLeafId = storedLeaf;
        // legacy rows carry no parentId — chain them in array order
        let prev = null;
        for (const m of messages) {
            if (m.parentId === undefined)
                m.parentId = prev;
            prev = m.id;
        }
        if (!activeLeafId)
            activeLeafId = messages.at(-1)?.id ?? null;
        t = { messages, activeLeafId };
        this.threads.set(threadId, t);
        return t;
    }
    messagesFor(threadId) {
        return this.thread(threadId).messages;
    }
    activeLeaf(threadId) {
        return this.thread(threadId).activeLeafId;
    }
    /** The visible conversation: root → activeLeafId. */
    activePath(threadId) {
        const t = this.thread(threadId);
        const byId = new Map(t.messages.map((m) => [m.id, m]));
        const path = [];
        let cur = t.activeLeafId ? byId.get(t.activeLeafId) : undefined;
        while (cur) {
            path.push(cur);
            cur = cur.parentId ? byId.get(cur.parentId) : undefined;
        }
        return path.reverse();
    }
    appendMessage(threadId, message) {
        const t = this.thread(threadId);
        const full = { id: newId(), at: Date.now(), parentId: t.activeLeafId, ...redactBotAuthored(message) };
        t.messages.push(full);
        t.activeLeafId = full.id;
        mdb.appendMessage(threadId, full);
        if (full.kind === "screen") {
            for (const pruned of this.pruneScreenFrames(t)) {
                mdb.updateMessage(threadId, pruned);
                this.emit({ type: "message.patch", threadId, message: pruned });
            }
        }
        this.emit({ type: "message", threadId, message: full });
        return full;
    }
    /** Screen frames are ~100-500KB of base64 each; keeping every frame of a
     * long computer session bloats the transcript for nothing the client
     * would ever show. The newest few keep their pixels; older ones stay in
     * the transcript as placeholders. Mirrors the client's own frame cap.
     * Returns the messages whose pixels were dropped so the caller can
     * persist exactly those. */
    pruneScreenFrames(t, keep = 4) {
        const pruned = [];
        let seen = 0;
        for (let i = t.messages.length - 1; i >= 0 && seen < t.messages.length; i--) {
            const m = t.messages[i];
            if (m.kind !== "screen" || !m.png)
                continue;
            seen += 1;
            if (seen > keep) {
                m.png = undefined;
                pruned.push(m);
            }
        }
        return pruned;
    }
    /** Fork the conversation: a new user message that replaces `sourceId`
     * (same parent, new text) and becomes the active leaf. */
    branchMessage(threadId, sourceId, text) {
        const t = this.thread(threadId);
        const source = t.messages.find((m) => m.id === sourceId);
        if (!source)
            return null;
        const full = {
            id: newId(),
            at: Date.now(),
            role: "user",
            kind: "text",
            text,
            parentId: source.parentId ?? null,
        };
        t.messages.push(full);
        t.activeLeafId = full.id;
        mdb.appendMessage(threadId, full);
        this.emit({ type: "message", threadId, message: full });
        return full;
    }
    /** Point the visible conversation at the branch containing `messageId`,
     * descending to that branch's most recently active leaf. */
    setActiveLeaf(threadId, messageId) {
        const t = this.thread(threadId);
        if (!t.messages.some((m) => m.id === messageId))
            return null;
        let cur = messageId;
        for (;;) {
            const children = t.messages.filter((m) => m.parentId === cur);
            if (!children.length)
                break;
            cur = children.reduce((a, b) => (b.at >= a.at ? b : a)).id;
        }
        t.activeLeafId = cur;
        mdb.setActiveLeaf(threadId, cur);
        this.emit({ type: "thread", threadId, activeLeafId: cur });
        return cur;
    }
    patchMessage(threadId, messageId, patch) {
        const t = this.thread(threadId);
        const idx = t.messages.findIndex((m) => m.id === messageId);
        if (idx === -1)
            return null;
        t.messages[idx] = { ...t.messages[idx], ...patch, card: patch.card ?? t.messages[idx].card };
        mdb.updateMessage(threadId, t.messages[idx]);
        this.emit({ type: "message.patch", threadId, message: t.messages[idx] });
        return t.messages[idx];
    }
    bot(id) {
        return this.bots.find((b) => b.id === id) ?? null;
    }
    botByThread(threadId) {
        return this.bots.find((b) => b.threadId === threadId || b.tasks?.some((t) => t.threadId === threadId)) ?? null;
    }
    createBot(profile = {}, opts = {}) {
        const name = profile.name?.trim() || pickBotName(this.bots.map((b) => b.name));
        const bot = {
            id: newId(),
            threadId: newId(),
            name,
            title: profile.title ?? "",
            description: profile.description ?? "",
            notifications: true,
            color: profile.color ?? COLORS[this.bots.length % COLORS.length],
            ...(profile.mascotExpression ? { mascotExpression: profile.mascotExpression } : {}),
            unread: false,
            modelSelection: profile.modelSelection ?? this.defaultSelection(),
            resumeCursors: {},
            createdAt: Date.now(),
        };
        bot.tasks = [{ threadId: bot.threadId, title: UNTITLED_TASK, createdAt: bot.createdAt, resumeCursors: {} }];
        this.bots.unshift(bot);
        this.saveBots();
        // Announce the owner before its onboarding transcript. SSE clients need
        // the bot/thread mapping before they can place either message.
        this.emit({ type: "bot", botId: bot.id });
        if (opts.seedMessages !== false) {
            this.appendMessage(bot.threadId, {
                role: "bot",
                kind: "text",
                text: `Hey — I'm ${name}. Nice to meet you.`,
            });
            this.appendMessage(bot.threadId, { role: "bot", kind: "options", card: onboardingCard() });
        }
        return bot;
    }
    deleteBot(id) {
        const bot = this.bot(id);
        if (!bot)
            return false;
        this.bots = this.bots.filter((b) => b.id !== id);
        // every task's transcript goes with the bot, not just the open one
        for (const threadId of new Set([bot.threadId, ...(bot.tasks ?? []).map((t) => t.threadId)])) {
            this.deleteThreadRecord(threadId);
        }
        // the bot's workspace (files + memory) goes with it — same rule as its
        // transcripts: deleting a bot deletes what it knew
        try {
            rmSync(workspaceDir(id), { recursive: true, force: true });
        }
        catch { }
        this.saveBots();
        this.emit({ type: "bot.deleted", botId: id });
        return true;
    }
    patchBot(id, patch) {
        const bot = this.bot(id);
        if (!bot)
            return null;
        Object.assign(bot, patch);
        this.saveBots();
        this.emit({ type: "bot", botId: id });
        return bot;
    }
    /** The one way runtime state changes. Sets `activity` and derives `busy`
     * from it, so a reader that only knows busy sees the same truth. */
    setActivity(botId, activity) {
        const bot = this.bot(botId);
        if (!bot)
            return null;
        const busy = ACTIVITY_BUSY.has(activity);
        if (bot.activity === activity && Boolean(bot.busy) === busy)
            return bot;
        bot.activity = activity;
        bot.busy = busy;
        this.saveBots();
        this.emit({ type: "bot", botId });
        return bot;
    }
    /** Elect one Chief of Staff (or clear the role) as one persisted change.
     * The changed records are returned so the server can update every open
     * window, including the bot that just handed the role over. */
    setChiefOfStaff(id) {
        if (id && !this.bot(id))
            return null;
        const changed = [];
        for (const bot of this.bots) {
            const next = bot.id === id;
            if (Boolean(bot.chiefOfStaff) === next && !(next && bot.hidden))
                continue;
            if (next) {
                bot.chiefOfStaff = true;
                // The workspace's main contact must stay reachable in the sidebar.
                bot.hidden = false;
            }
            else {
                bot.chiefOfStaff = false;
            }
            changed.push(bot);
        }
        if (changed.length)
            this.saveBots();
        for (const bot of changed)
            this.emit({ type: "bot", botId: bot.id });
        return changed;
    }
    setResumeCursor(botId, instanceId, cursor, threadId) {
        const bot = this.bot(botId);
        if (!bot)
            return;
        // the cursor belongs to the task that produced it, not to the bot
        const task = threadId ? this.taskByThread(botId, threadId) : this.activeTask(botId);
        if (task)
            task.resumeCursors[instanceId] = cursor;
        // The legacy mirror follows the task visible in chat, never a detached
        // routine task working in the background.
        if (!threadId || bot.threadId === threadId)
            bot.resumeCursors[instanceId] = cursor;
        this.saveBots();
        this.emit({ type: "bot", botId });
    }
    /** Record which instance just took a turn on this task. Called at
     * dispatch, not at cursor time — transcript-replay engines never
     * produce a cursor, and they still count as having run last. */
    markTaskDispatched(botId, threadId, instanceId) {
        const task = this.taskByThread(botId, threadId);
        if (!task || task.lastInstanceId === instanceId)
            return;
        task.lastInstanceId = instanceId;
        this.saveBots();
    }
    /** Bank one settled turn onto its task. Called once per turn.completed;
     * the running per-driver token indicator is deliberately not used here
     * because its meaning differs by driver. */
    addTaskUsage(botId, threadId, turn) {
        const task = this.taskByThread(botId, threadId);
        if (!task)
            return null;
        const prev = { input: 0, output: 0, costUsd: null, turns: 0, ...task.usage };
        const cost = typeof turn.costUsd === "number" && Number.isFinite(turn.costUsd) ? turn.costUsd : null;
        const prevCost = typeof prev.costUsd === "number" ? prev.costUsd : null;
        // providers occasionally report NaN or a negative on a partial turn —
        // never let that poison a running tally
        const clean = (n) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0);
        task.usage = {
            input: prev.input + clean(turn.input),
            output: prev.output + clean(turn.output),
            costUsd: cost === null ? prevCost : (prevCost ?? 0) + cost,
            turns: prev.turns + 1,
        };
        this.saveBots();
        this.emit({ type: "bot", botId });
        return task.usage;
    }
    /** The folder a task's turn runs in. Pins on first call from the bot's
     * current folder — unless the task already has a session (a thread from
     * before folders existed), which pins to the default so the folder can't
     * move under it. Returns the pinned value: a path, or null for default. */
    pinTaskCwd(botId, threadId, fallbackCwd, opts = {}) {
        const bot = this.bot(botId);
        const task = bot ? this.taskByThread(botId, threadId) : undefined;
        if (!bot || !task)
            return null;
        if (opts.none) {
            if (task.cwd !== null) {
                task.cwd = null;
                this.saveBots();
                this.emit({ type: "bot", botId });
            }
            return null;
        }
        if (task.cwd === undefined) {
            task.cwd = Object.keys(task.resumeCursors).length === 0 ? (bot.cwd ?? fallbackCwd ?? null) : null;
            this.saveBots();
            this.emit({ type: "bot", botId });
        }
        return task.cwd;
    }
    /** The folder a room's member turns run in. Pins on the first turn that
     * dispatches, from the room's `cwd` at that moment. Pinned, not read
     * live, for the same reason tasks pin (see pinTaskCwd): engines key
     * their sessions and files to the folder a thread starts in, and a room
     * lives on ONE thread forever — so changing the room's folder applies to
     * future rooms, never under a room that already started working
     * somewhere. Returns the pinned value: a path, or null = each member's
     * own default. */
    pinGroupCwd(groupId) {
        const group = this.group(groupId);
        if (!group)
            return null;
        if (group.pinnedCwd === undefined) {
            group.pinnedCwd = group.cwd ?? null;
            this.saveGroups();
            this.emit({ type: "group", groupId: group.id });
        }
        return group.pinnedCwd;
    }
    // ── tasks ─────────────────────────────────────────────────────────────
    /** The first thing the human asked in a thread — a task's natural name. */
    firstUserLine(threadId) {
        const first = this.messagesFor(threadId).find((m) => m.role === "user" && m.kind === "text" && m.text?.trim());
        return first?.text ? titleFromMessage(first.text) : null;
    }
    tasks(botId) {
        return this.bot(botId)?.tasks ?? [];
    }
    activeTask(botId) {
        const bot = this.bot(botId);
        return bot?.tasks?.find((t) => t.threadId === bot.threadId);
    }
    taskByThread(botId, threadId) {
        return this.bot(botId)?.tasks?.find((t) => t.threadId === threadId);
    }
    /** A fresh context on the same bot: new thread, new session, same
     * persona/tools/computer. Becomes the active task. */
    createTask(botId, title, activate = true) {
        const bot = this.bot(botId);
        if (!bot)
            return null;
        const task = {
            threadId: newId(),
            title: title?.trim() || UNTITLED_TASK,
            createdAt: Date.now(),
            resumeCursors: {},
        };
        bot.tasks = [task, ...(bot.tasks ?? [])];
        if (activate) {
            bot.threadId = task.threadId;
            bot.resumeCursors = {}; // legacy mirror follows the active task
        }
        this.saveBots();
        this.emit({ type: "bot", botId });
        return task;
    }
    switchTask(botId, threadId) {
        const bot = this.bot(botId);
        const task = bot?.tasks?.find((t) => t.threadId === threadId);
        if (!bot || !task)
            return null;
        bot.threadId = task.threadId;
        bot.resumeCursors = { ...task.resumeCursors };
        this.saveBots();
        this.emit({ type: "bot", botId });
        return bot;
    }
    renameTask(botId, threadId, title) {
        const task = this.bot(botId)?.tasks?.find((t) => t.threadId === threadId);
        if (!task)
            return null;
        task.title = title.trim().slice(0, 80) || UNTITLED_TASK;
        this.saveBots();
        this.emit({ type: "bot", botId });
        return task;
    }
    /** Name a task after its first message, once. */
    titleTaskFromFirstMessage(botId, text, threadId) {
        const task = threadId ? this.taskByThread(botId, threadId) : this.activeTask(botId);
        if (!task || task.title !== UNTITLED_TASK)
            return;
        task.title = titleFromMessage(text);
        this.saveBots();
        this.emit({ type: "bot", botId });
    }
    /** Delete a task and its transcript. A bot always keeps one. */
    deleteTask(botId, threadId) {
        const bot = this.bot(botId);
        if (!bot || !bot.tasks || bot.tasks.length < 2)
            return null;
        if (!bot.tasks.some((t) => t.threadId === threadId))
            return null;
        bot.tasks = bot.tasks.filter((t) => t.threadId !== threadId);
        this.deleteThreadRecord(threadId);
        if (bot.threadId === threadId) {
            bot.threadId = bot.tasks[0].threadId;
            bot.resumeCursors = { ...bot.tasks[0].resumeCursors };
        }
        this.saveBots();
        this.emit({ type: "bot", botId });
        return bot;
    }
    /** First-run seed: one bot so the app never opens empty — it gets a
     * random friendly name like every other bot. */
    seedIfEmpty() {
        if (this.bots.length)
            return;
        this.createBot();
    }
}
