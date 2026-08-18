// server/container-mcp.ts
import { spawn } from "node:child_process";

// server/env-path.ts
import { execFile } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, extname, join } from "node:path";
function nvmBinDirs() {
  try {
    const base = join(homedir(), ".nvm", "versions", "node");
    return readdirSync(base).filter((v) => v.startsWith("v")).sort((a, b) => b.localeCompare(a, void 0, { numeric: true })).map((v) => join(base, v, "bin"));
  } catch {
    return [];
  }
}
function knownDirs() {
  const home = homedir();
  return [
    join(home, ".local", "bin"),
    // claude installer default
    join(home, ".npm-global", "bin"),
    // npm prefix ~/.npm-global (claude, opencode)
    join(home, ".kimi-code", "bin"),
    // kimi-code installer
    join(home, ".grok", "bin"),
    // x.ai installer
    join(home, ".opencode", "bin"),
    // opencode installer
    join(home, ".claude", "local"),
    // claude "local install"
    "/opt/homebrew/bin",
    // brew, Apple silicon
    "/usr/local/bin",
    // brew Intel / classic installs
    join(home, ".volta", "bin"),
    join(home, ".bun", "bin"),
    join(home, ".asdf", "shims"),
    join(home, ".deno", "bin"),
    join(home, "bin"),
    ...nvmBinDirs()
  ];
}
function windowsKnownDirs() {
  const home = homedir();
  const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
  const localAppData = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
  return [
    join(appData, "npm"),
    // npm -g shims: claude, codex
    join(home, ".grok", "bin"),
    // x.ai installer
    join(localAppData, "agy", "bin"),
    // Antigravity installer
    join(home, ".local", "bin"),
    // claude native installer
    join(home, ".claude", "local"),
    join(home, "bin"),
    // Factory droid installer (%USERPROFILE%\bin)
    join(home, ".bun", "bin"),
    join(home, ".deno", "bin"),
    join(home, "go", "bin")
  ];
}
var cached = null;
var probed = false;
var loginShellPath = null;
function augmentedPath() {
  if (cached === null) {
    cached = mergePaths([
      ...process.env.OMB_EXTRA_PATH ? process.env.OMB_EXTRA_PATH.split(delimiter) : [],
      ...process.env.PATH ? process.env.PATH.split(delimiter) : [],
      // Keep the last successful login-shell result while a rescan starts a
      // fresh asynchronous probe. Otherwise resetPathCache() would make
      // rc-only CLIs disappear again for the response that triggered it.
      ...loginShellPath ? loginShellPath.split(delimiter) : [],
      // Both platforms scan their standard install locations; only the
      // login-shell probe below stays unix-only, since Windows has no
      // equivalent rc file to source.
      ...(process.platform === "win32" ? windowsKnownDirs() : knownDirs()).filter((d) => existsSync(d))
    ]);
  }
  if (!probed && !process.env.VITEST && process.platform !== "win32") {
    probed = true;
    probeLoginShellPath();
  }
  return cached;
}
function mergePaths(parts) {
  return [...new Set(parts.filter(Boolean))].join(delimiter);
}
function probeLoginShellPath() {
  const shell = process.env.SHELL || "/bin/zsh";
  execFile(
    shell,
    ["-l", "-i", "-c", 'printf "__OMB_PATH__%s" "$PATH"'],
    { timeout: 5e3 },
    (err, stdout) => {
      if (err || !stdout) return;
      const m = /__OMB_PATH__([^\n]*)/.exec(stdout);
      if (!m || !m[1]) return;
      loginShellPath = m[1];
      cached = mergePaths([...(cached ?? "").split(delimiter), ...m[1].split(delimiter)]);
    }
  );
}

// server/container-mcp.ts
var [runtime, container, socket] = process.argv.slice(2);
if (!runtime || !["docker", "podman", "container"].includes(runtime)) {
  process.stderr.write("invalid Local VM runtime\n");
  process.exit(2);
}
if (!container || !/^[a-zA-Z0-9_.-]+$/.test(container) || !socket?.startsWith("/run/user/1000/")) {
  process.stderr.write("invalid Local VM connection\n");
  process.exit(2);
}
var child = spawn(
  runtime,
  [
    "exec",
    "-i",
    "-u",
    "cua",
    "-e",
    "HOME=/home/cua",
    "-e",
    "DISPLAY=:1",
    "-e",
    "CUA_DRIVER_INSTALL_CHANNEL=python_package",
    "-e",
    "CUA_DRIVER_RS_TELEMETRY_ENABLED=0",
    container,
    "/usr/local/libexec/operabot/cua-driver",
    "mcp",
    "--socket",
    socket
  ],
  {
    env: { ...process.env, PATH: augmentedPath() },
    stdio: ["pipe", "pipe", "pipe"]
  }
);
process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.on("error", (error) => {
  process.stderr.write(`could not connect to Cua Driver: ${error.message}
`);
  process.exit(1);
});
child.on("close", (code, signal) => {
  if (signal) process.stderr.write(`Cua Driver connection ended with ${signal}
`);
  process.exit(code ?? 1);
});
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => child.kill(signal));
}
