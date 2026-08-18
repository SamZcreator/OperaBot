// Async peer handoff (delegate_bot).
//
// A bot that finishes one task can hand the NEXT task to a peer without
// blocking its own turn — the source bot's turn.completed fires after it
// settles, and the queued delegation runs then. The peer gets a fresh
// depth-1 turn (depth cap still blocks A→B→C chains, see index.ts).
//
// Visiblity rides on the same comms-visibility helpers ask_bot uses
// (channel mirror + 1:1 chips) so a delegated exchange looks like an
// exchanged one. The optional approval gate (A2) is checked at drain
// time, never at queue time, because the user might have just turned
// approvePeerComms on between queueing and draining.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic.js";
import { getOrCreateChannel, mirrorExchange } from "./comms-visibility.js";
import { DATA_DIR } from "./config.js";
import { newId } from "./contracts.js";
import { requestPeerApproval } from "./peer-approval.js";
/** Per source-thread queue. Persisted to delegations.json on every change
 * and reloaded at boot: a handoff queued right before a restart runs after
 * it. (Provider PERMISSIONS still die with the process — nobody can answer
 * for an unattended bot — but queued work is not a permission; the target
 * and approvePeerComms are re-checked at drain time as always.) */
const pendingDelegations = new Map();
const drainingThreads = new Set();
const DELEGATIONS_FILE = join(DATA_DIR, "delegations.json");
function savePending() {
    try {
        writeFileAtomic(DELEGATIONS_FILE, JSON.stringify(Object.fromEntries(pendingDelegations), null, 2), { mode: 0o600 });
    }
    catch (error) {
        console.error("delegations: could not persist queue", error);
    }
}
/** Load what a previous process left queued. Missing or corrupt → empty. */
export function _loadPending() {
    pendingDelegations.clear();
    try {
        const raw = JSON.parse(readFileSync(DELEGATIONS_FILE, "utf8"));
        for (const [threadId, list] of Object.entries(raw)) {
            if (!Array.isArray(list))
                continue;
            const items = list.flatMap((value) => {
                if (!value || typeof value !== "object")
                    return [];
                const item = value;
                if (typeof item.toBotId !== "string" ||
                    typeof item.message !== "string" ||
                    !Number.isFinite(item.depth))
                    return [];
                return [{
                        id: typeof item.id === "string" && item.id ? item.id : newId(),
                        toBotId: item.toBotId,
                        message: item.message,
                        ...(typeof item.reason === "string" ? { reason: item.reason } : {}),
                        depth: Math.max(0, Math.trunc(item.depth)),
                    }];
            });
            if (items.length)
                pendingDelegations.set(threadId, items);
        }
    }
    catch {
        /* fresh install, or unreadable — start empty */
    }
}
/** Source threads with something queued — what a boot drain iterates. */
export function pendingThreads() {
    return [...pendingDelegations.keys()];
}
/** How many handoffs one turn may queue. Small on purpose: this is the only
 * thing standing between a confused bot and a fan-out of real turns. */
const MAX_QUEUED_PER_THREAD = 4;
/** Validate and enqueue a delegation. Pushes a "Delegated to @B: reason"
 * chip to the source thread so the user can see what was queued. */
export function queueDelegation(bus, from, item, maxDepth, sourceThreadId = from.threadId) {
    if (item.toBotId === from.id)
        return "self";
    if (item.depth >= maxDepth)
        return "too_deep";
    const target = bus.store.bot(item.toBotId);
    if (!target)
        return "no_target";
    const list = pendingDelegations.get(sourceThreadId) ?? [];
    // Async handoff removes the backpressure that ask_bot got for free by
    // making the caller wait. Without a cap, one turn can queue unboundedly
    // and fan out into as many real turns on the next settle.
    if (list.length >= MAX_QUEUED_PER_THREAD)
        return "too_many";
    list.push({ ...item, id: newId() });
    pendingDelegations.set(sourceThreadId, list);
    savePending();
    const label = `Delegated to @${target.name}${item.reason ? `: ${item.reason}` : ""}`;
    bus.store.appendMessage(sourceThreadId, {
        role: "bot",
        kind: "activity",
        tool: { name: label },
    });
    return "ok";
}
/** Drain queued delegations for a source thread (called on its
 * turn.completed). Each item is processed independently: a deny, a busy
 * target, or an error in one does not stop the rest. The actual start
 * of the target turn is delegated to `runTarget` so delegations.ts
 * stays free of harness-level concerns (commsDepth is the only thing
 * the caller needs). */
export function drainDelegations(bus, approvalBus, threadId, runTarget) {
    if (drainingThreads.has(threadId))
        return;
    const list = pendingDelegations.get(threadId);
    if (!list?.length)
        return;
    const from = bus.store.botByThread(threadId);
    if (!from) {
        pendingDelegations.delete(threadId);
        savePending();
        return;
    }
    const snapshot = [...list];
    drainingThreads.add(threadId);
    void (async () => {
        for (const item of snapshot) {
            try {
                await processOne(bus, approvalBus, from, threadId, item, runTarget);
            }
            catch (error) {
                const why = error instanceof Error ? error.message : String(error);
                try {
                    bus.store.appendMessage(threadId, {
                        role: "bot",
                        kind: "activity",
                        tool: { name: `error: delegation failed — ${why.slice(0, 120)}`, ok: false },
                    });
                }
                catch (reportError) {
                    console.error("delegation failed and could not be reported", reportError);
                }
            }
            finally {
                acknowledgeDelegation(threadId, item.id);
            }
        }
    })().finally(() => {
        drainingThreads.delete(threadId);
        // A later turn may have queued and settled while this thread was
        // waiting for approval. Its items were not in our snapshot, so start a
        // fresh drain instead of leaving them parked until another restart.
        if (pendingDelegations.get(threadId)?.length) {
            drainDelegations(bus, approvalBus, threadId, runTarget);
        }
    });
}
/** Remove one terminal handoff only after approval/dispatch has settled. */
function acknowledgeDelegation(threadId, itemId) {
    const current = pendingDelegations.get(threadId);
    if (!current)
        return;
    const remaining = current.filter((item) => item.id !== itemId);
    if (remaining.length)
        pendingDelegations.set(threadId, remaining);
    else
        pendingDelegations.delete(threadId);
    savePending();
}
/** Drop a thread's queued handoffs without running them, telling the user
 * they were dropped. Used when the queueing turn failed or was interrupted. */
export function discardDelegations(bus, threadId) {
    const list = pendingDelegations.get(threadId);
    if (!list?.length)
        return;
    pendingDelegations.delete(threadId);
    savePending();
    const from = bus.store.botByThread(threadId);
    if (!from)
        return;
    bus.store.appendMessage(threadId, {
        role: "bot",
        kind: "activity",
        tool: { name: `${list.length} queued delegation${list.length > 1 ? "s" : ""} dropped — the turn did not finish`, ok: false },
    });
}
async function processOne(bus, approvalBus, from, sourceThreadId, item, runTarget) {
    let sender = from;
    let target = bus.store.bot(item.toBotId);
    if (!target) {
        bus.store.appendMessage(sourceThreadId, {
            role: "bot",
            kind: "activity",
            tool: { name: `error: delegation to ${item.toBotId} failed — no such bot`, ok: false },
        });
        return;
    }
    if (target.busy) {
        bus.store.appendMessage(sourceThreadId, {
            role: "bot",
            kind: "activity",
            tool: { name: `Delegation to @${target.name} canceled — @${target.name} is busy`, ok: false },
        });
        return;
    }
    if (sender.approvePeerComms) {
        const verdict = await requestPeerApproval(approvalBus, sender, target, item.message, "delegate_bot", sourceThreadId);
        if (verdict !== "allow") {
            bus.store.appendMessage(sourceThreadId, {
                role: "bot",
                kind: "activity",
                tool: { name: `Delegation to @${target.name} denied by user`, ok: false },
            });
            return;
        }
        // The approval could have been sitting for up to 15 minutes. Everything
        // checked above is a stale snapshot now: re-read both bots and re-check
        // busy, or an allow can start a second turn on a bot that is mid-turn —
        // and mirror a "Messaged @X" chip for an exchange that never happens.
        const current = bus.store.bot(item.toBotId);
        const currentSender = bus.store.bot(from.id);
        if (!current || !currentSender || !bus.store.taskByThread(currentSender.id, sourceThreadId))
            return;
        if (current.busy) {
            bus.store.appendMessage(sourceThreadId, {
                role: "bot",
                kind: "activity",
                tool: { name: `Delegation to @${current.name} canceled — @${current.name} is busy`, ok: false },
            });
            return;
        }
        sender = currentSender;
        target = current;
    }
    const channel = getOrCreateChannel(bus.store, sender, target);
    mirrorExchange(bus, sender, target, item.message, channel, sourceThreadId);
    const reasonLine = item.reason ? `\n\n[Reason: ${item.reason}]` : "";
    const prefixed = `[Delegated by @${sender.name}, another bot in this OperaBot workspace. Do the work and reply directly.]\n\n${item.message}${reasonLine}`;
    await runTarget(item.toBotId, prefixed, item.depth + 1, sourceThreadId, channel);
}
/** Test helper: how many items remain queued for a thread. */
export function _pendingCount(threadId) {
    return pendingDelegations.get(threadId)?.length ?? 0;
}
/** Test helper: forget the in-memory queue (a simulated restart). */
export function _resetPending() {
    pendingDelegations.clear();
    drainingThreads.clear();
}
