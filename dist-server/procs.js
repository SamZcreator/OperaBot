// Cross-platform process spawning for the agent CLIs. Three Windows
// differences are exposed to drivers through this module:
//   1. CreateProcess can't exec npm .cmd/.bat shims or node-shebang scripts
//      directly. env-path resolves those to their real .exe / `node script`
//      entry without a shell, so quoting-sensitive JSON argv stays intact.
//   2. No process-group kill (kill(-pid) is POSIX) — taskkill /T reaps the
//      whole tree, CLI + its spawned MCP proxies alike.
//   3. Console apps spawned from the GUI shell flash a console window
//      unless windowsHide is set.
import { spawn, execFile, } from "node:child_process";
import { join } from "node:path";
import { resolveCliSpawn } from "./env-path.js";
export function resolveCli(cli, args = []) {
    return resolveCliSpawn(cli, args);
}
export function spawnCli(cli, args, opts) {
    const resolved = resolveCli(cli, args);
    const child = spawn(resolved.command, resolved.args, {
        ...opts,
        // posix: own process group so kill(-pid) reaps child MCP servers;
        // win32: taskkill /T does the reaping instead (see killCliTree)
        ...(process.platform === "win32" ? { windowsHide: true } : { detached: true }),
    }); // callers always pipe all three
    // A write to a dying child's stdin fails differently per platform, and one
    // of the ways is fatal. On POSIX the kill is synchronous, the stream is
    // already destroyed by the time anything writes, and the write throws into
    // the caller's try/catch. On Windows killCliTree goes through taskkill — a
    // subprocess — so there is a window where the child is dead but its pipe is
    // not, and a write during it errors *asynchronously* on the stream. No
    // driver listens for that, an unlistened stream error is an uncaught
    // exception, and the whole harness exits over one dead CLI. The error
    // carries no information the drivers don't already get from `close`, which
    // is where every one of them settles the turn — so it is swallowed, not
    // logged.
    child.stdin?.on("error", () => { });
    return child;
}
export function execCli(cli, args, opts, cb) {
    const resolved = resolveCli(cli, args);
    execFile(resolved.command, resolved.args, { ...opts, windowsHide: true }, (err, stdout) => cb(err, typeof stdout === "string" ? stdout : String(stdout)));
}
export function describeSpawnFailure(err, cli) {
    if (err.code === "ENOENT")
        return { message: `\`${cli}\` isn't installed, or isn't on this app's PATH`, setup: true };
    if (err.code === "EACCES" || err.code === "EPERM")
        return { message: `\`${cli}\` isn't executable — check its file permissions`, setup: true };
    return { message: `spawn failed: ${err.message}`, setup: false };
}
/** Stop a CLI and every process it spawned (MCP proxies included). */
export function killCliTree(child) {
    const pid = child.pid;
    if (!pid || child.exitCode !== null || child.signalCode !== null)
        return;
    if (process.platform === "win32") {
        execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, (err) => {
            if (!err)
                return;
            try {
                // taskkill is unavailable or the tree lookup failed. At least stop
                // the process we own instead of leaving the entire turn running.
                child.kill();
            }
            catch {
                /* already gone */
            }
        });
        return;
    }
    try {
        process.kill(-pid, "SIGTERM");
    }
    catch {
        try {
            child.kill("SIGTERM");
        }
        catch {
            /* already gone */
        }
    }
}
/** Per-turn broker channel: unix socket on POSIX, named pipe on Windows
 * (Node can't listen on a filesystem socket path there — EACCES). */
export function brokerSocketPath(dataDir, tag) {
    return process.platform === "win32"
        // Named pipes share a global namespace; DATA_DIR cannot isolate two
        // concurrent app instances the way a POSIX socket directory does.
        ? `\\\\.\\pipe\\operabot-perm-${process.pid}-${tag}`
        : join(dataDir, `perm-${tag}.sock`);
}
