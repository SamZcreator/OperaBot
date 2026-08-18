// server/computer-observation.ts
import { createHash } from "node:crypto";
var emptyObservationMetrics = () => ({
  screenshotsCaptured: 0,
  screenshotsSentToModel: 0,
  fullScreenObservations: 0,
  croppedObservations: 0,
  structuredBrowserObservations: 0,
  computerActions: 0,
  retries: 0,
  verificationSuccesses: 0,
  verificationFailures: 0
});
function normalizeCrop(raw, maxWidth, maxHeight) {
  if (!raw || typeof raw !== "object") return null;
  const value = raw;
  const x = Math.round(Number(value.x));
  const y = Math.round(Number(value.y));
  const width = Math.round(Number(value.width));
  const height = Math.round(Number(value.height));
  if (![x, y, width, height, maxWidth, maxHeight].every(Number.isFinite) || maxWidth <= 0 || maxHeight <= 0 || x < 0 || y < 0 || width < 32 || height < 32) {
    return null;
  }
  if (x + width > maxWidth || y + height > maxHeight) return null;
  return { x, y, width, height };
}
function normalizeBrowserUrl(value) {
  if (typeof value !== "string" || !value || value.length > 8192) return null;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return null;
  }
}
function safeBrowserUrl(value) {
  const normalized = normalizeBrowserUrl(value);
  if (!normalized) return null;
  const url = new URL(normalized);
  url.search = "";
  url.hash = "";
  const safe = url.toString();
  return safe.length <= 2048 ? safe : null;
}
function parseBrowserTargets(raw) {
  if (raw.length > 1e6) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 20).flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const value = item;
      const comparisonUrl = normalizeBrowserUrl(value.url);
      const url = safeBrowserUrl(value.url);
      if (value.type !== "page" || !url || !comparisonUrl || typeof value.id !== "string") return [];
      const title = typeof value.title === "string" ? value.title.replace(/\s+/g, " ").trim().slice(0, 200) : "";
      return [{ id: value.id.slice(0, 100), title, url, comparisonUrl }];
    });
  } catch {
    return [];
  }
}
var ObservationCoordinator = class {
  metrics = emptyObservationMetrics();
  lastObservation = null;
  noteAction(count = 1) {
    this.metrics.computerActions += Math.max(0, Math.trunc(count));
  }
  noteRetry() {
    this.metrics.retries += 1;
  }
  /** canonicalFrame must describe the full screenshot, even when the image
   * returned to the model is cropped. A box-provided full-frame hash works. */
  observeFrame(canonicalFrame, crop) {
    this.metrics.screenshotsCaptured += 1;
    const hash = canonicalFrame ? createHash("sha256").update(canonicalFrame).digest("hex") : null;
    const view = crop ? `${crop.x},${crop.y},${crop.width},${crop.height}` : "full";
    const signature = hash ? `${hash}:${view}` : null;
    const changed = signature === null || signature !== this.lastObservation;
    if (signature) this.lastObservation = signature;
    if (changed) {
      this.metrics.screenshotsSentToModel += 1;
      if (crop) this.metrics.croppedObservations += 1;
      else this.metrics.fullScreenObservations += 1;
    }
    return { changed, hash };
  }
  noteStructuredObservation() {
    this.metrics.structuredBrowserObservations += 1;
  }
  noteVerification(ok) {
    if (ok) this.metrics.verificationSuccesses += 1;
    else this.metrics.verificationFailures += 1;
  }
};

// server/remote-computer.ts
var REMOTE_CUA_VERSION = "0.20.0";
var REMOTE_CUA_EXECUTABLE = "/opt/ogb/cua-driver";
var REMOTE_CUA_SOCKET = "/opt/ogb/run/cua.sock";
var REMOTE_CUA_SESSION = "operabot";
var REMOTE_CDP_HELPER = "/opt/ogb/operabot-cdp.mjs";
var CDP_HELPER_SOURCE = String.raw`const [action, encoded = ""] = process.argv.slice(2);
const input = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8") || "{}");
const pages = await fetch("http://127.0.0.1:9222/json/list").then((r) => r.json());
const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
if (!page) throw new Error("no debuggable browser page");
if (input.url && page.url !== input.url) throw new Error("page changed; take a new browser snapshot");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", () => reject(new Error("DevTools connection failed")), { once: true });
});
let nextId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (!message.id) return;
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message));
  else waiter.resolve(message.result ?? {});
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const refId = (value) => {
  const match = /^b(\d+)$/.exec(String(value ?? ""));
  if (!match) throw new Error("invalid or stale browser ref; take a new snapshot");
  return Number(match[1]);
};
if (action === "snapshot") {
  await send("Accessibility.enable");
  const { nodes = [] } = await send("Accessibility.getFullAXTree", { depth: 14 });
  const useful = new Set(["button", "checkbox", "combobox", "heading", "link", "menuitem", "radio", "searchbox", "slider", "spinbutton", "switch", "tab", "textbox"]);
  const elements = [];
  for (const node of nodes) {
    const role = String(node.role?.value ?? "").toLowerCase();
    const name = String(node.name?.value ?? "").replace(/\s+/g, " ").trim().slice(0, 180);
    const backend = Number(node.backendDOMNodeId ?? 0);
    if (!backend || !useful.has(role) || (!name && role !== "textbox" && role !== "searchbox")) continue;
    const disabled = node.properties?.some((property) => property.name === "disabled" && property.value?.value === true) ?? false;
    elements.push({ ref: "b" + backend, role, name: name || "unnamed", disabled });
    if (elements.length >= 250) break;
  }
  process.stdout.write(JSON.stringify({ title: String(page.title ?? "").slice(0, 200), url: page.url, elements }));
} else if (action === "click") {
  const backendNodeId = refId(input.ref);
  const { model } = await send("DOM.getBoxModel", { backendNodeId });
  const quad = model?.border ?? model?.content;
  if (!Array.isArray(quad) || quad.length < 8) throw new Error("element is not visible; take a new snapshot");
  const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
  const y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  process.stdout.write(JSON.stringify({ ok: true, ref: input.ref }));
} else if (action === "fill") {
  const backendNodeId = refId(input.ref);
  await send("DOM.focus", { backendNodeId });
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2 });
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace" });
  await send("Input.insertText", { text: String(input.text ?? "") });
  process.stdout.write(JSON.stringify({ ok: true, ref: input.ref }));
} else {
  throw new Error("unknown browser action");
}
socket.close();`;
var shellQuote = (value) => `'${value.replace(/'/g, "'\\''")}'`;
function ensureRemoteCuaCommand() {
  return [
    `if [ -x ${REMOTE_CUA_EXECUTABLE} ]; then`,
    `  mkdir -p ${REMOTE_CUA_SOCKET.slice(0, REMOTE_CUA_SOCKET.lastIndexOf("/"))}`,
    `  if ! ${REMOTE_CUA_EXECUTABLE} status --socket ${REMOTE_CUA_SOCKET} >/dev/null 2>&1; then`,
    `    rm -f ${REMOTE_CUA_SOCKET}`,
    '    display=${DISPLAY:-$(find /tmp/.X11-unix -maxdepth 1 -name "X*" -printf ":%f\\n" 2>/dev/null | sed "s/:X/:/" | head -1)}',
    "    display=${display:-:0}",
    `    nohup env HOME="$HOME" DISPLAY="$display" CUA_DRIVER_INSTALL_CHANNEL=python_package CUA_DRIVER_RS_TELEMETRY_ENABLED=0 ${REMOTE_CUA_EXECUTABLE} serve --socket ${REMOTE_CUA_SOCKET} --permission-mode standard > /tmp/ogb-cua-driver.log 2>&1 &`,
    `    for i in 1 2 3 4 5 6 7 8 9 10; do ${REMOTE_CUA_EXECUTABLE} status --socket ${REMOTE_CUA_SOCKET} >/dev/null 2>&1 && break; sleep 0.2; done`,
    "  fi",
    "fi"
  ].join("\n");
}
function semanticBrowserCommand(action, input) {
  const encoded = Buffer.from(JSON.stringify(input ?? {})).toString("base64url");
  return `node ${REMOTE_CDP_HELPER} ${action} ${shellQuote(encoded)}`;
}

// server/computer-proxy.ts
var BOX_API = process.env.OGB_BOX_API ?? "https://ascii.dev/api/box/v1";
var boxId = process.env.OGB_BOX_ID ?? "";
var token = process.env.OGB_BOX_TOKEN ?? "";
var SHOT_WIDTH = 1280;
var JPEG_QUALITY = 75;
var SHOT_PATH = "/tmp/ogb-shot.jpg";
var SETTLE_MS = 350;
var ACTION_GAP_MS = 120;
var CHROME_PROFILE = "$HOME/.operabot/chrome-profile";
var CHROME_DEBUG_FLAGS = `--user-data-dir="${CHROME_PROFILE}" --password-store=basic --disable-session-crashed-bubble --no-first-run --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222`;
var CHROME_PROFILE_SETUP = [
  `profile="${CHROME_PROFILE}"`,
  'mkdir -p "$profile" "$HOME/.config"',
  'chmod 700 "$profile"',
  'for browser_dir in "$HOME/.config/google-chrome" "$HOME/.config/chromium"; do',
  '  if [ -e "$browser_dir" ] && [ ! -L "$browser_dir" ]; then',
  '    if [ -d "$browser_dir" ] && ! cp -a -n "$browser_dir"/. "$profile"/; then',
  '      echo "failed to copy browser profile: $browser_dir" >&2',
  "      exit 1",
  "    fi",
  '    mv "$browser_dir" "$browser_dir.pre-operabot-$(date +%s)-$$"',
  "  fi",
  '  if [ -L "$browser_dir" ]; then rm -f "$browser_dir"; fi',
  '  ln -s "$profile" "$browser_dir"',
  "done"
].join("\n");
var INLINE_MAX_BYTES = 4e5;
async function resumeBox() {
  const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  await fetch(`${BOX_API}/boxes/${boxId}/resume`, { method: "POST", headers: auth }).catch(() => null);
  const deadline = Date.now() + 9e4;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2e3));
    const res = await fetch(`${BOX_API}/boxes/${boxId}`, { headers: auth }).catch(() => null);
    const body = await res?.json().catch(() => null);
    const state = body?.box?.state;
    if (state && ["idle", "ready", "running"].includes(state)) return true;
    if (state === "error") return false;
  }
  return false;
}
async function runOnBox(command, timeoutMs = 6e4, allowWake = true) {
  const isolatedCommand = [
    "exec env -i",
    'HOME="$HOME"',
    'USER="${USER:-$(id -un)}"',
    'LOGNAME="${LOGNAME:-${USER:-$(id -un)}}"',
    'PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"',
    'DISPLAY="${DISPLAY:-:0}"',
    'XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"',
    'XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"',
    'DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-}"',
    "/bin/bash -c",
    shellQuote2(command)
  ].join(" ");
  const res = await fetch(`${BOX_API}/boxes/${boxId}/commands`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ command: isolatedCommand }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const body = await res.json().catch(() => null);
  if (res.status === 409 && allowWake) {
    const code = body?.code ?? body?.error?.code ?? "";
    if (/machine_not_running|box_starting|not_running|starting/i.test(String(code))) {
      const woke = await resumeBox();
      if (woke) return runOnBox(command, timeoutMs, false);
      return { ok: false, exitCode: null, stdout: "", stderr: "the computer is asleep and did not wake in time" };
    }
  }
  return {
    ok: res.ok && body?.exitCode === 0,
    exitCode: body?.exitCode ?? null,
    stdout: body?.stdout ?? "",
    stderr: body?.stderr ?? String(body?.message ?? (res.ok ? "" : `HTTP ${res.status}`))
  };
}
var observations = new ObservationCoordinator();
function metricsText() {
  return JSON.stringify(observations.metrics);
}
async function browserTargets(countObservation = true) {
  const out = await runOnBox("curl -sf --max-time 2 http://127.0.0.1:9222/json/list", 5e3);
  const targets = out.ok ? parseBrowserTargets(out.stdout) : [];
  if (countObservation && targets.length) observations.noteStructuredObservation();
  return targets;
}
async function waitForNavigation(value, attempts = 3) {
  const expected = normalizeBrowserUrl(value);
  if (!expected) {
    observations.noteVerification(false);
    return { ok: false, targets: [] };
  }
  let targets = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      observations.noteRetry();
      await new Promise((resolve) => setTimeout(resolve, 1e3));
    }
    targets = await browserTargets(false);
    if (targets.some((target) => target.comparisonUrl === expected)) {
      observations.noteVerification(true);
      return { ok: true, targets };
    }
  }
  observations.noteVerification(false);
  return { ok: false, targets };
}
var ENV = "export DISPLAY=${DISPLAY:-:0}";
var CUA_ENV = "CUA_DRIVER_INSTALL_CHANNEL=python_package CUA_DRIVER_RS_TELEMETRY_ENABLED=0";
var GEOMETRY = [
  "g=$(xdotool getdisplaygeometry 2>/dev/null)",
  "W=${g%% *}",
  "H=${g##* }",
  `case "$W" in ''|*[!0-9]*) W=${SHOT_WIDTH}; H=0;; esac`
].join("; ");
function scaled(varName, value) {
  const v = Math.round(value);
  return `if [ "$W" -gt ${SHOT_WIDTH} ] 2>/dev/null; then ${varName}=$(( ${v} * W / ${SHOT_WIDTH} )); else ${varName}=${v}; fi`;
}
function cuaOrX11(tool, argumentsShell, fallback) {
  return [
    `if [ -x ${REMOTE_CUA_EXECUTABLE} ] && ${REMOTE_CUA_EXECUTABLE} status --socket ${REMOTE_CUA_SOCKET} >/dev/null 2>&1;`,
    `then if CUA_OUT=$(env ${CUA_ENV} ${REMOTE_CUA_EXECUTABLE} call ${tool} ${argumentsShell} --socket ${REMOTE_CUA_SOCKET} 2>/tmp/ogb-cua-call.error);`,
    `then echo "BACKEND CUA"; echo "CUA_RESULT $(printf %s "$CUA_OUT" | base64 -w0 2>/dev/null || printf %s "$CUA_OUT" | base64 | tr -d '\\n')"`,
    `else ${fallback}; X11_RC=$?; echo "BACKEND X11"; [ "$X11_RC" -eq 0 ]; fi`,
    `else ${fallback}; X11_RC=$?; echo "BACKEND X11"; [ "$X11_RC" -eq 0 ]; fi`
  ].join(" ");
}
function captureBlock(settleMs = SETTLE_MS, crop = null) {
  const downscale = crop ? `if [ "$W" -gt ${SHOT_WIDTH} ] 2>/dev/null; then if ! command -v convert >/dev/null 2>&1 || ! convert "$f" -thumbnail ${SHOT_WIDTH}x -quality ${JPEG_QUALITY} "$f" 2>/dev/null; then echo CROP_FAILED; exit 0; fi; fi` : `if [ "$W" -gt ${SHOT_WIDTH} ] 2>/dev/null && command -v convert >/dev/null 2>&1; then convert "$f" -thumbnail ${SHOT_WIDTH}x -quality ${JPEG_QUALITY} "$f" 2>/dev/null || true; fi`;
  const cropSteps = crop ? [
    `if ! command -v convert >/dev/null 2>&1 || ! convert "$f" -crop ${crop.width}x${crop.height}+${crop.x}+${crop.y} +repage "$f" 2>/dev/null; then echo CROP_FAILED; exit 0; fi`,
    `if [ ! -s "$f" ]; then echo CROP_FAILED; exit 0; fi`
  ] : [];
  return [
    settleMs > 0 ? `sleep ${(settleMs / 1e3).toFixed(2)}` : "true",
    `f=${SHOT_PATH}`,
    "raw=/tmp/ogb-shot.png",
    `rm -f "$f" 2>/dev/null || true`,
    `rm -f "$raw" 2>/dev/null || true`,
    `if [ -x ${REMOTE_CUA_EXECUTABLE} ] && ${REMOTE_CUA_EXECUTABLE} status --socket ${REMOTE_CUA_SOCKET} >/dev/null 2>&1 && env ${CUA_ENV} ${REMOTE_CUA_EXECUTABLE} call get_desktop_state ${shellQuote2(JSON.stringify({ scope: "desktop", session: REMOTE_CUA_SESSION }))} --socket ${REMOTE_CUA_SOCKET} --screenshot-out-file "$raw" >/dev/null 2>&1 && command -v convert >/dev/null 2>&1 && convert "$raw" -quality ${JPEG_QUALITY} "$f" 2>/dev/null; then echo "CAPTURE CUA"; else scrot -o -q ${JPEG_QUALITY} "$f" 2>/dev/null || import -window root -quality ${JPEG_QUALITY} "$f" 2>/dev/null || ffmpeg -y -f x11grab -i "$DISPLAY" -frames:v 1 -q:v 6 "$f" >/dev/null 2>&1; echo "CAPTURE X11"; fi`,
    // only re-encode when the display is bigger than the model's space —
    // ImageMagick startup is the most expensive step in the old pipeline
    downscale,
    `if [ ! -s "$f" ]; then echo SHOT_FAILED; exit 0; fi`,
    'echo "GEOM $W $H"',
    `echo "HASH $(md5sum "$f" 2>/dev/null | cut -d' ' -f1)"`,
    ...cropSteps,
    's=$(stat -c%s "$f" 2>/dev/null || echo 0)',
    // SIZE is what makes the inline path safe: the frame is only trusted
    // when the bytes we decoded match the bytes the box says it wrote
    'echo "SIZE $s"',
    `if [ "$s" -gt 0 ] && [ "$s" -le ${INLINE_MAX_BYTES} ]; then echo "B64 $(base64 -w0 "$f" 2>/dev/null || base64 "$f" | tr -d '\\n')"; fi`
  ].join("; ");
}
function wholeImage(bytes, expectedBytes) {
  if (bytes.length < 512) return false;
  if (expectedBytes && bytes.length !== expectedBytes) return false;
  const jpeg = bytes[0] === 255 && bytes[1] === 216;
  const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
  if (jpeg) {
    const tail = bytes.subarray(Math.max(0, bytes.length - 32));
    return tail.includes(Buffer.from([255, 217]));
  }
  if (png) {
    const tail = bytes.subarray(Math.max(0, bytes.length - 12));
    return tail.includes(Buffer.from("IEND", "ascii"));
  }
  return false;
}
async function fetchFrame(expectedBytes) {
  const auth = { authorization: `Bearer ${token}` };
  try {
    const res = await fetch(
      `${BOX_API}/boxes/${boxId}/artifacts?path=${encodeURIComponent(SHOT_PATH)}`,
      { headers: auth, signal: AbortSignal.timeout(3e4) }
    );
    if (res.ok) {
      const bytes = Buffer.from(await res.arrayBuffer());
      if (wholeImage(bytes, expectedBytes)) return bytes.toString("base64");
    }
  } catch {
  }
  try {
    const res = await fetch(
      `${BOX_API}/boxes/${boxId}/files?path=${encodeURIComponent(SHOT_PATH)}&encoding=base64`,
      { headers: auth, signal: AbortSignal.timeout(3e4) }
    );
    const body = await res.json().catch(() => null);
    const content = body?.content;
    if (!res.ok || typeof content !== "string" || !content) return null;
    return wholeImage(Buffer.from(content, "base64"), expectedBytes) ? content : null;
  } catch {
    return null;
  }
}
var inlineWorks = true;
var lastDisplayGeometry = null;
var semanticBrowserUrl = null;
var semanticBrowserRefs = /* @__PURE__ */ new Set();
function geometryFrom(stdout) {
  const match = stdout.match(/^GEOM\s+(\d+)\s+(\d+)$/m);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}
function automationSummary(stdout) {
  if (/^BACKEND CUA$/m.test(stdout)) {
    const encoded = stdout.match(/^CUA_RESULT\s+([^\s]+)$/m)?.[1];
    if (!encoded) return `Cua Driver ${REMOTE_CUA_VERSION}`;
    try {
      const result = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
      const details = [result.effect, result.route, result.escalation].filter((value) => typeof value === "string" && Boolean(value)).slice(0, 3);
      return [`Cua Driver ${REMOTE_CUA_VERSION}`, ...details].join(" \xB7 ");
    } catch {
      return `Cua Driver ${REMOTE_CUA_VERSION}`;
    }
  }
  return /^BACKEND X11$/m.test(stdout) ? "X11 fallback" : "automation backend unavailable";
}
async function observationBounds() {
  let geometry = lastDisplayGeometry;
  if (!geometry) {
    const out = await runOnBox([ENV, GEOMETRY, 'echo "GEOM $W $H"'].join("; "), 15e3);
    geometry = geometryFrom(out.stdout);
    if (geometry) lastDisplayGeometry = geometry;
  }
  if (!geometry) return null;
  const scale = geometry.width > SHOT_WIDTH ? SHOT_WIDTH / geometry.width : 1;
  return {
    width: Math.round(geometry.width * scale),
    height: Math.round(geometry.height * scale)
  };
}
async function frameFrom(out) {
  if (/SHOT_FAILED|CROP_FAILED/.test(out.stdout)) return null;
  let hash = null;
  let geometry = null;
  let inline = "";
  let size = 0;
  for (const line of out.stdout.split("\n")) {
    if (line.startsWith("HASH ")) hash = line.slice(5).trim() || null;
    else if (line.startsWith("SIZE ")) size = Number(line.slice(5).trim()) || 0;
    else if (line.startsWith("GEOM ")) {
      const [w, h] = line.slice(5).trim().split(/\s+/).map(Number);
      if (Number.isFinite(w) && w > 0) geometry = { width: w, height: Number.isFinite(h) ? h : 0 };
    } else if (line.startsWith("B64 ")) inline = line.slice(4).trim();
  }
  if (geometry?.height) lastDisplayGeometry = geometry;
  if (inline && inlineWorks) {
    const bytes = Buffer.from(inline, "base64");
    if (wholeImage(bytes, size || void 0)) return { data: inline, mime: "image/jpeg", hash, geometry };
    inlineWorks = false;
  }
  const fetched = await fetchFrame(size || void 0);
  if (!fetched) return null;
  return { data: fetched, mime: "image/jpeg", hash, geometry };
}
var send = (obj) => {
  process.stdout.write(JSON.stringify(obj) + "\n");
};
var text = (id, t, isError = false) => send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: t }], isError: isError || void 0 } });
function observed(id, note, frame, crop = null, followsAction = true) {
  if (!frame) {
    return text(id, `${note}
(couldn't capture the screen \u2014 call screenshot to retry)`);
  }
  const observation = observations.observeFrame(frame.hash ?? (crop ? null : frame.data), crop);
  if (!observation.changed) {
    const guidance = followsAction ? " Don't repeat the action \u2014 it may already have succeeded. If you expected a change, call screenshot again after it has had time to render." : " No new image is attached.";
    return text(id, `${note}
(the screen is identical to the frame you already have.${guidance})`);
  }
  send({
    jsonrpc: "2.0",
    id,
    result: {
      content: [
        { type: "text", text: note },
        { type: "image", data: frame.data, mimeType: frame.mime }
      ]
    }
  });
}
var OBSERVE_PROPS = {
  observe: {
    type: "boolean",
    description: "default true \u2014 return a fresh screenshot with the result. Set false only when chaining mechanical steps you don't need to see."
  },
  settle_ms: { type: "number", description: "wait before the screenshot, default 350, max 3000" }
};
var TOOLS = [
  {
    name: "screenshot",
    description: "See the bot's cloud computer screen when visual state is needed. First prefer browser_state for Chrome title/URL checks. The frame is captured fresh; byte-identical pixels are not resent.",
    inputSchema: {
      type: "object",
      properties: {
        region: {
          type: "object",
          description: "Optional crop in the coordinates of the last screenshot.",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            width: { type: "number" },
            height: { type: "number" }
          },
          required: ["x", "y", "width", "height"]
        }
      }
    }
  },
  {
    name: "browser_state",
    description: "Read structured Chrome page titles and safe URLs. Credentials, query strings, and fragments are removed before output.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "browser_snapshot",
    description: "Read Chrome's semantic accessibility tree and return fresh element refs. Prefer this over screenshots for links, buttons, and form fields.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "browser_click",
    description: "Click one element ref from the most recent browser_snapshot and return the resulting screen.",
    inputSchema: {
      type: "object",
      properties: { ref: { type: "string" }, ...OBSERVE_PROPS },
      required: ["ref"]
    }
  },
  {
    name: "browser_fill",
    description: "Replace the text in one field ref from the most recent browser_snapshot and return the resulting screen.",
    inputSchema: {
      type: "object",
      properties: { ref: { type: "string" }, text: { type: "string" }, ...OBSERVE_PROPS },
      required: ["ref", "text"]
    }
  },
  {
    name: "wait_for_navigation",
    description: "Verify that Chrome reached one exact http(s) URL, including its query and fragment, with at most three bounded checks.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"]
    }
  },
  {
    name: "observation_metrics",
    description: "Return this turn's observation, action, retry, and verification counters.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "computer_status",
    description: "Report whether the cloud computer is using Cua Driver or the degraded X11 fallback.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "click",
    description: "Click on the computer's screen and return the resulting screen. Use pixel coordinates exactly as they appear in the last frame you were given \u2014 any scaling to the real display is handled for you.",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        button: { type: "string", enum: ["left", "right"], description: "default left" },
        double: { type: "boolean", description: "double-click" },
        ...OBSERVE_PROPS
      },
      required: ["x", "y"]
    }
  },
  {
    name: "type_text",
    description: "Type text at the current focus and return the resulting screen.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" }, ...OBSERVE_PROPS },
      required: ["text"]
    }
  },
  {
    name: "press_key",
    description: 'Press a key or chord and return the resulting screen. xdotool syntax: "Return", "Tab", "ctrl+c", "alt+F4", "ctrl+shift+t".',
    inputSchema: {
      type: "object",
      properties: { keys: { type: "string" }, ...OBSERVE_PROPS },
      required: ["keys"]
    }
  },
  {
    name: "scroll",
    description: "Scroll the screen up or down by N clicks and return the resulting screen.",
    inputSchema: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down"] },
        clicks: { type: "number", description: "default 3" },
        ...OBSERVE_PROPS
      },
      required: ["direction"]
    }
  },
  {
    name: "computer_batch",
    description: "Run several UI actions in ONE go and return the screen at the end \u2014 much faster than separate calls (one round trip, one screenshot). Use it for mechanical sequences you can predict without looking in between, e.g. click a field, type, Tab, type, press Return. Stop the batch before anything whose outcome you need to see first.",
    inputSchema: {
      type: "object",
      properties: {
        actions: {
          type: "array",
          description: "in order; each is {action: click|type_text|press_key|scroll|wait, ...its params}",
          items: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["click", "type_text", "press_key", "scroll", "wait"] },
              x: { type: "number" },
              y: { type: "number" },
              button: { type: "string", enum: ["left", "right"] },
              double: { type: "boolean" },
              text: { type: "string" },
              keys: { type: "string" },
              direction: { type: "string", enum: ["up", "down"] },
              clicks: { type: "number" },
              ms: { type: "number", description: "wait: milliseconds, max 5000" }
            },
            required: ["action"]
          }
        },
        ...OBSERVE_PROPS
      },
      required: ["actions"]
    }
  },
  {
    name: "computer_exec",
    description: "Run a shell command on the bot's cloud computer (Linux, passwordless sudo, X11 desktop). Returns stdout/stderr/exit code \u2014 and, unlike the UI tools, no screenshot unless you ask for one.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        observe: {
          type: "boolean",
          description: "default false \u2014 set true to also return a screenshot (e.g. after launching a GUI app)"
        }
      },
      required: ["command"]
    }
  },
  {
    name: "open_url",
    description: "Open a URL in the computer's own Chrome, verify the exact destination when DevTools is available, and return the resulting screen.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" }, ...OBSERVE_PROPS },
      required: ["url"]
    }
  }
];
var shellQuote2 = (s) => `'${s.replace(/'/g, "'\\''")}'`;
var settleOf = (args) => Math.min(Math.max(Number(args?.settle_ms) || SETTLE_MS, 0), 3e3);
var wantsFrame = (args) => args?.observe !== false;
function actionShell(a) {
  const kind = String(a?.action ?? "");
  if (kind === "click") {
    const x = Math.round(Number(a.x));
    const y = Math.round(Number(a.y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { error: "click needs numeric x,y" };
    const btn = a.button === "right" ? 3 : 1;
    const rep = a.double ? "--repeat 2 --delay 60 " : "";
    const button = a.button === "right" ? "right" : "left";
    const count = a.double ? 2 : 1;
    const fallback = `xdotool mousemove $CX $CY click ${rep}${btn}`;
    const args = `$(printf '{"x":%s,"y":%s,"button":"${button}","count":${count},"scope":"desktop","session":"${REMOTE_CUA_SESSION}"}' "$CX" "$CY")`;
    return `${scaled("CX", x)}; ${scaled("CY", y)}; CUA_ARGS=${args}; ${cuaOrX11("click", '"$CUA_ARGS"', fallback)}`;
  }
  if (kind === "type_text") {
    const t = String(a.text ?? "");
    if (!t) return { error: "type_text needs text" };
    const cuaArgs = shellQuote2(JSON.stringify({ text: t, scope: "desktop", session: REMOTE_CUA_SESSION }));
    return cuaOrX11("type_text", cuaArgs, `xdotool type --clearmodifiers --delay 8 -- ${shellQuote2(t)}`);
  }
  if (kind === "press_key") {
    const keys = String(a.keys ?? "").replace(/[^\w+]/g, "");
    if (!keys) return { error: "press_key needs keys" };
    const parts = keys.split("+").filter(Boolean);
    const tool = parts.length > 1 ? "hotkey" : "press_key";
    const cuaArgs = shellQuote2(
      JSON.stringify(
        parts.length > 1 ? { keys: parts, scope: "desktop", session: REMOTE_CUA_SESSION } : { key: parts[0]?.toLowerCase(), scope: "desktop", session: REMOTE_CUA_SESSION }
      )
    );
    return cuaOrX11(tool, cuaArgs, `xdotool key ${keys}`);
  }
  if (kind === "scroll") {
    const clicks = Math.min(Math.max(Math.round(Number(a.clicks) || 3), 1), 20);
    const btn = a.direction === "up" ? 4 : 5;
    const direction = a.direction === "up" ? "up" : "down";
    const fallback = `xdotool click --repeat ${clicks} ${btn}`;
    const args = `$(printf '{"x":%s,"y":%s,"direction":"${direction}","amount":${clicks},"by":"line","scope":"desktop","session":"${REMOTE_CUA_SESSION}"}' "$((W / 2))" "$((H / 2))")`;
    return `CUA_ARGS=${args}; ${cuaOrX11("scroll", '"$CUA_ARGS"', fallback)}`;
  }
  if (kind === "wait") {
    const ms = Math.min(Math.max(Number(a.ms) || 500, 0), 5e3);
    return `sleep ${(ms / 1e3).toFixed(2)}`;
  }
  return { error: `unknown action ${kind || "(missing)"}` };
}
async function actAndObserve(id, actions, note, args, timeoutMs = 6e4) {
  const parts = [];
  for (const a of actions) {
    const shell = actionShell(a);
    if (typeof shell !== "string") return text(id, shell.error, true);
    if (parts.length) parts.push(`sleep ${(ACTION_GAP_MS / 1e3).toFixed(2)}`);
    parts.push(shell);
  }
  observations.noteAction(actions.filter((action) => action?.action !== "wait").length);
  const observe = wantsFrame(args);
  const guarded = `if { ${parts.join("; ")}; }; then ACT=ok; else ACT=failed; fi`;
  const command = [
    ENV,
    GEOMETRY,
    ensureRemoteCuaCommand(),
    guarded,
    observe ? captureBlock(settleOf(args)) : "true",
    'echo "ACT $ACT"'
  ].join("; ");
  const out = await runOnBox(command, timeoutMs);
  const acted = /^ACT ok$/m.test(out.stdout);
  if (!acted && !out.stdout.includes("GEOM")) {
    return text(
      id,
      `${note.replace(/^./, (c) => c.toLowerCase())} failed: ${out.stderr.slice(0, 200) || `exit ${out.exitCode}`}`,
      true
    );
  }
  const backend = automationSummary(out.stdout);
  const full = acted ? `${note}
(${backend})` : `${note}
(the action reported an error: ${out.stderr.slice(0, 160) || "no detail"}; ${backend})`;
  if (!observe) return text(id, full, !acted);
  return observed(id, full, await frameFrom(out));
}
async function semanticActAndObserve(id, action, ref, value, args) {
  if (!semanticBrowserUrl || !semanticBrowserRefs.has(ref)) {
    return text(id, "that browser ref is stale or unknown \u2014 take a new browser_snapshot", true);
  }
  const observe = wantsFrame(args);
  const semantic = semanticBrowserCommand(action, {
    ref,
    ...action === "fill" ? { text: value ?? "" } : {},
    url: semanticBrowserUrl
  });
  const guarded = `if ${semantic}; then SEM=ok; else SEM=failed; fi`;
  const command = [
    ENV,
    GEOMETRY,
    guarded,
    ensureRemoteCuaCommand(),
    observe ? captureBlock(settleOf(args)) : "true",
    'echo "SEM $SEM"'
  ].join("; ");
  observations.noteAction();
  const out = await runOnBox(command, action === "fill" ? 12e4 : 6e4);
  const acted = /^SEM ok$/m.test(out.stdout);
  semanticBrowserRefs.clear();
  const note = acted ? action === "fill" ? `filled ${ref} with ${value?.length ?? 0} chars (trusted Chrome DevTools input)` : `clicked ${ref} (trusted Chrome DevTools input)` : `${action} ${ref} failed: ${out.stderr.slice(0, 200) || "the page changed; take a new browser_snapshot"}`;
  if (!observe) return text(id, note, !acted);
  return observed(id, note, await frameFrom(out));
}
async function call(id, name, args) {
  if (name === "screenshot") {
    let crop = null;
    if (args.region !== void 0) {
      const bounds = await observationBounds();
      if (!bounds) return text(id, "crop unavailable: could not determine the screenshot dimensions", true);
      crop = normalizeCrop(args.region, bounds.width, bounds.height);
      if (!crop) {
        return text(
          id,
          `region must be at least 32\xD732 and stay within the ${bounds.width}\xD7${bounds.height} screenshot`,
          true
        );
      }
    }
    const out = await runOnBox([ENV, GEOMETRY, ensureRemoteCuaCommand(), captureBlock(0, crop)].join("; "), 6e4);
    if (/CROP_FAILED/.test(out.stdout)) {
      return text(id, `crop failed: ${out.stderr.slice(0, 200) || "ImageMagick could not create the requested region"}`, true);
    }
    const frame = await frameFrom(out);
    if (!frame) {
      return text(id, `screenshot failed: ${out.stderr.slice(0, 200) || "capture produced no frame"}`, true);
    }
    return observed(id, crop ? "cropped screen captured" : "screen captured", frame, crop, false);
  }
  if (name === "browser_state") {
    const targets = await browserTargets();
    return text(
      id,
      targets.length ? `Structured browser state:
${targets.map((target) => `- ${target.title || "Untitled"}: ${target.url}`).join("\n")}` : "Structured browser state unavailable. Use screenshot only if visual state is necessary."
    );
  }
  if (name === "browser_snapshot") {
    const out = await runOnBox(semanticBrowserCommand("snapshot", {}), 2e4);
    if (!out.ok) {
      semanticBrowserUrl = null;
      semanticBrowserRefs.clear();
      return text(id, "Semantic browser state is unavailable. Open Chrome with open_url, or use screenshot.", true);
    }
    try {
      const snapshot = JSON.parse(out.stdout);
      if (!Array.isArray(snapshot.elements) || typeof snapshot.url !== "string") throw new Error("invalid snapshot");
      semanticBrowserUrl = snapshot.url;
      semanticBrowserRefs = new Set(snapshot.elements.map((element) => element.ref));
      observations.noteStructuredObservation();
      const publicUrl = safeBrowserUrl(snapshot.url) ?? "URL unavailable";
      const lines = snapshot.elements.map(
        (element) => `- [${element.ref}] ${element.role}${element.disabled ? " disabled" : ""}: ${element.name.replace(/\s+/g, " ").slice(0, 180)}`
      );
      return text(
        id,
        `Semantic browser snapshot \u2014 ${snapshot.title || "Untitled"}: ${publicUrl}
${lines.join("\n") || "No interactive elements found."}`
      );
    } catch {
      semanticBrowserUrl = null;
      semanticBrowserRefs.clear();
      return text(id, "Chrome returned an invalid semantic snapshot; use screenshot.", true);
    }
  }
  if (name === "browser_click") {
    const ref = String(args.ref ?? "");
    return semanticActAndObserve(id, "click", ref, void 0, args);
  }
  if (name === "browser_fill") {
    const ref = String(args.ref ?? "");
    return semanticActAndObserve(id, "fill", ref, String(args.text ?? ""), args);
  }
  if (name === "wait_for_navigation") {
    const url = String(args.url ?? "");
    const publicUrl = safeBrowserUrl(url);
    if (!normalizeBrowserUrl(url) || !publicUrl) {
      observations.noteVerification(false);
      return text(id, "wait_for_navigation needs a valid http(s) URL", true);
    }
    const result = await waitForNavigation(url);
    return text(
      id,
      result.ok ? `navigation verified: ${publicUrl}` : `navigation not verified after 3 checks. Current structured state: ${result.targets.map((target) => target.url).join(", ") || "unavailable"}. Use screenshot only if needed.`,
      !result.ok
    );
  }
  if (name === "observation_metrics") return text(id, metricsText());
  if (name === "computer_status") {
    const command = [
      ENV,
      ensureRemoteCuaCommand(),
      `if [ -x ${REMOTE_CUA_EXECUTABLE} ] && ${REMOTE_CUA_EXECUTABLE} status --socket ${REMOTE_CUA_SOCKET} >/dev/null 2>&1; then`,
      `  echo "CUA $(${REMOTE_CUA_EXECUTABLE} --version)"`,
      `  env ${CUA_ENV} ${REMOTE_CUA_EXECUTABLE} call health_report '{}' --socket ${REMOTE_CUA_SOCKET} 2>/dev/null || true`,
      "else echo 'X11 fallback'; fi"
    ].join("\n");
    const out = await runOnBox(command, 2e4);
    if (!/^CUA /m.test(out.stdout)) {
      return text(id, "Cloud computer automation: X11 fallback (Cua Driver is still installing or needs repair).", true);
    }
    const overall = out.stdout.match(/"overall"\s*:\s*"(ok|degraded|failed)"/)?.[1] ?? "unknown";
    return text(id, `Cloud computer automation: Cua Driver ${REMOTE_CUA_VERSION} (${overall}).`);
  }
  if (name === "click") {
    const x = Math.round(Number(args.x));
    const y = Math.round(Number(args.y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return text(id, "click needs numeric x,y", true);
    const what = `${args.double ? "double-clicked" : args.button === "right" ? "right-clicked" : "clicked"} ${x},${y}`;
    return actAndObserve(id, [{ ...args, action: "click" }], what, args);
  }
  if (name === "type_text") {
    const t = String(args.text ?? "");
    if (!t) return text(id, "nothing to type", true);
    return actAndObserve(id, [{ action: "type_text", text: t }], `typed ${t.length} chars`, args, 12e4);
  }
  if (name === "press_key") {
    const keys = String(args.keys ?? "").replace(/[^\w+]/g, "");
    if (!keys) return text(id, "press_key needs keys", true);
    return actAndObserve(id, [{ action: "press_key", keys }], `pressed ${keys}`, args);
  }
  if (name === "scroll") {
    const clicks = Math.min(Math.max(Math.round(Number(args.clicks) || 3), 1), 20);
    const direction = args.direction === "up" ? "up" : "down";
    return actAndObserve(id, [{ action: "scroll", direction, clicks }], `scrolled ${direction} ${clicks}`, args);
  }
  if (name === "computer_batch") {
    const actions = Array.isArray(args.actions) ? args.actions.slice(0, 24) : [];
    if (!actions.length) return text(id, "computer_batch needs a non-empty actions array", true);
    const summary = actions.map(
      (a) => a.action === "click" ? `click ${Math.round(Number(a.x))},${Math.round(Number(a.y))}` : a.action === "type_text" ? `type ${String(a.text ?? "").length} chars` : a.action === "press_key" ? `key ${a.keys}` : a.action === "scroll" ? `scroll ${a.direction ?? "down"}` : `wait ${Math.min(Number(a.ms) || 500, 5e3)}ms`
    ).join(" \u2192 ");
    return actAndObserve(id, actions, `ran ${actions.length} actions: ${summary}`, args, 18e4);
  }
  if (name === "computer_exec") {
    const command = String(args.command ?? "").slice(0, 4e3);
    observations.noteAction();
    const out = await runOnBox(command, 12e4);
    const note = `exit ${out.exitCode}
${out.stdout.slice(-6e3)}${out.stderr ? `
[stderr]
${out.stderr.slice(-2e3)}` : ""}`;
    if (args.observe !== true) return text(id, note);
    const shot = await runOnBox([ENV, GEOMETRY, ensureRemoteCuaCommand(), captureBlock()].join("; "), 6e4);
    return observed(id, note, await frameFrom(shot));
  }
  if (name === "open_url") {
    const url = String(args.url ?? "");
    const normalized = normalizeBrowserUrl(url);
    const publicUrl = safeBrowserUrl(url);
    if (!normalized || !publicUrl) return text(id, "only valid http(s) URLs", true);
    const q = shellQuote2(normalized);
    const observe = wantsFrame(args);
    const command = [
      ENV,
      GEOMETRY,
      CHROME_PROFILE_SETUP,
      `(google-chrome ${CHROME_DEBUG_FLAGS} ${q} || chromium ${CHROME_DEBUG_FLAGS} ${q} || chromium-browser ${CHROME_DEBUG_FLAGS} ${q} || xdg-open ${q}) >/dev/null 2>&1 &`,
      'for i in 1 2 3 4 5 6 7 8 9 10 11 12; do xdotool search --onlyvisible --class "chrom" >/dev/null 2>&1 && break; sleep 0.25; done',
      ensureRemoteCuaCommand(),
      observe ? captureBlock(600) : "true"
    ].join("; ");
    observations.noteAction();
    const out = await runOnBox(command, 6e4);
    const verification = await waitForNavigation(normalized, 1);
    const current = verification.targets.map((target) => target.url).join(", ") || "unavailable";
    const note = verification.ok ? `opened and navigation verified: ${publicUrl}` : `opened ${publicUrl}, but the exact destination was not verified. Current structured state: ${current}`;
    if (!observe) return text(id, note);
    return observed(id, note, await frameFrom(out));
  }
  return text(id, `unknown tool ${name}`, true);
}
async function handle(msg) {
  if (msg.method === "initialize") {
    return send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "operabot-computer", version: "3" }
      }
    });
  }
  if (msg.method === "tools/list") return send({ jsonrpc: "2.0", id: msg.id, result: { tools: TOOLS } });
  if (msg.method === "tools/call") {
    try {
      return await call(msg.id, msg.params?.name, msg.params?.arguments ?? {});
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      const timedOut = error.name === "TimeoutError" || /timed?\s*out|timeout/i.test(error.message);
      return text(
        msg.id,
        timedOut ? "computer tool timed out. The action may or may not have completed; take a screenshot to inspect the current state before retrying it." : `computer tool failed: ${error.message}`,
        true
      );
    }
  }
  if (String(msg.method ?? "").startsWith("notifications/")) return;
  if (msg.id != null) {
    send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } });
  }
}
var buf = "";
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    try {
      void handle(JSON.parse(line));
    } catch {
    }
  }
});
process.stdin.on("end", () => process.exit(0));
