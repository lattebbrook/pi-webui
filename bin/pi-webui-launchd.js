#!/usr/bin/env node
"use strict";

// Run pi-webui as a macOS launchd user agent (starts at login, restarts on crash).
// Adapted from ompweb's bin/omp-web-launchd.js (MIT, kahme247/ompweb).
//
// The service runs its own production build, deployed from this checkout into
// ~/Library/Application Support/pi-webui/app, so `npm run dev` in the checkout
// keeps working (a `next build` in the checkout would break the dev server).
//
// Usage:
//   node bin/pi-webui-launchd.js install     build + deploy this checkout, then (re)load the service
//   node bin/pi-webui-launchd.js update      same as install
//   node bin/pi-webui-launchd.js status|logs|restart|uninstall
//
// Environment read at install time: PORT (default 30140; dev uses 30141), PI_WEB_HOSTNAME (default 127.0.0.1),
// PI_WEB_PASSWORD, PI_CODING_AGENT_DIR, PI_WEBUI_STT_ENDPOINT/KEY/MODEL.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawnSync } = require("node:child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("node:fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const os = require("node:os");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path");

const LABEL = "com.lattebbrook.pi-webui";
const HOME = os.homedir();
const SRC = path.join(__dirname, "..");
const APP_ROOT = path.join(HOME, "Library", "Application Support", "pi-webui");
const APP_DIR = path.join(APP_ROOT, "app");
const PLIST = path.join(HOME, "Library", "LaunchAgents", `${LABEL}.plist`);
const LOG_DIR = path.join(HOME, "Library", "Logs", "pi-webui");
const DOMAIN = `gui/${process.getuid?.() ?? 0}`;
const FORWARDED_ENV = [
  "PI_WEB_PASSWORD",
  "PI_CODING_AGENT_DIR",
  "PI_WEBUI_STT_ENDPOINT",
  "PI_WEBUI_STT_KEY",
  "PI_WEBUI_STT_MODEL",
];

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (result.error) fail(`${cmd} not runnable: ${result.error.message}`);
  if (result.status !== 0) fail(`${cmd} ${args.join(" ")} exited with ${result.status}`);
}

function xmlEscape(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function launchctl(args, { ignoreFailure = false } = {}) {
  const result = spawnSync("launchctl", args, { encoding: "utf8" });
  if (result.error) fail(`launchctl not runnable: ${result.error.message}`);
  if (result.status !== 0 && !ignoreFailure) {
    fail(`launchctl ${args.join(" ")} failed: ${(result.stderr ?? "").trim()}`);
  }
  return result.stdout ?? "";
}

/** Copy the tracked + untracked-but-not-ignored files of the checkout into APP_DIR, then build there. */
function deploy() {
  const files = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: SRC,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (files.status !== 0) fail("git ls-files failed; run this from the pi-webui checkout");
  const list = path.join(os.tmpdir(), `pi-webui-deploy-${process.pid}.txt`);
  fs.writeFileSync(list, files.stdout);
  fs.mkdirSync(APP_DIR, { recursive: true });
  console.log(`deploying ${SRC} -> ${APP_DIR}`);
  run("rsync", ["-a", "--delete-excluded", "--from0", `--files-from=${list}`, `${SRC}/`, `${APP_DIR}/`]);
  fs.rmSync(list, { force: true });
  console.log("installing dependencies (npm ci)…");
  run("npm", ["ci", "--no-audit", "--no-fund"], { cwd: APP_DIR });
  console.log("building (npm run build)…");
  run("npm", ["run", "build"], { cwd: APP_DIR });
}

function writePlist() {
  const nodeBin = process.execPath;
  const port = process.env.PORT ?? "30140";
  const hostname = process.env.PI_WEB_HOSTNAME ?? "127.0.0.1";
  const piBin = spawnSync("/usr/bin/which", ["pi"], { encoding: "utf8" }).stdout?.trim();
  const svcPath = [
    path.dirname(nodeBin),
    ...(piBin ? [path.dirname(piBin)] : []),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ].filter((dir, i, all) => all.indexOf(dir) === i).join(path.delimiter);

  const env = { PATH: svcPath, PORT: port, PI_WEB_HOSTNAME: hostname, PI_WEB_NO_OPEN: "1", HOME };
  for (const key of FORWARDED_ENV) {
    if (process.env[key]) env[key] = key === "PI_CODING_AGENT_DIR" ? process.env[key].replace(/^~(?=\/|$)/, HOME) : process.env[key];
  }
  const envXml = Object.entries(env)
    .map(([key, value]) => `    <key>${xmlEscape(key)}</key><string>${xmlEscape(value)}</string>`)
    .join("\n");

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(nodeBin)}</string>
    <string>${xmlEscape(path.join(APP_DIR, "bin", "pi-web.js"))}</string>
    <string>--no-open</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${envXml}
  </dict>
  <key>WorkingDirectory</key><string>${xmlEscape(HOME)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xmlEscape(path.join(LOG_DIR, "pi-webui.log"))}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(path.join(LOG_DIR, "pi-webui.err.log"))}</string>
</dict>
</plist>
`;
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(PLIST), { recursive: true });
  fs.writeFileSync(PLIST, plist, { mode: 0o600 });
  fs.chmodSync(PLIST, 0o600);
  return { port, hostname, password: Boolean(env.PI_WEB_PASSWORD) };
}

function install() {
  deploy();
  const { port, hostname, password } = writePlist();
  launchctl(["bootout", `${DOMAIN}/${LABEL}`], { ignoreFailure: true });
  launchctl(["bootstrap", DOMAIN, PLIST]);
  console.log(`installed: ${PLIST}`);
  console.log(`app:       ${APP_DIR}`);
  console.log(`url:       http://${hostname}:${port}`);
  console.log(`logs:      ${path.join(LOG_DIR, "pi-webui.log")}`);
  if (password) console.log("note:      the password is stored in plain text in the plist (mode 600)");
}

function uninstall() {
  launchctl(["bootout", `${DOMAIN}/${LABEL}`], { ignoreFailure: true });
  fs.rmSync(PLIST, { force: true });
  console.log(`uninstalled: ${LABEL} (deployed app left at ${APP_DIR}; delete it manually if unwanted)`);
}

function status() {
  const result = spawnSync("launchctl", ["print", `${DOMAIN}/${LABEL}`], { encoding: "utf8" });
  if (result.status === 0) {
    const lines = (result.stdout ?? "").split("\n").filter((line) => /\b(state|pid|last exit)\b/.test(line));
    console.log(lines.join("\n") || (result.stdout ?? "").trim());
    return;
  }
  console.log(`not loaded: ${LABEL}`);
  process.exit(1);
}

function logs() {
  run("tail", ["-n", "60", path.join(LOG_DIR, "pi-webui.log"), path.join(LOG_DIR, "pi-webui.err.log")]);
}

if (process.platform !== "darwin") fail("launchd services are macOS-only");

const command = process.argv[2] ?? "status";
if (command === "install" || command === "update") install();
else if (command === "uninstall") uninstall();
else if (command === "status") status();
else if (command === "logs") logs();
else if (command === "restart") launchctl(["kickstart", "-k", `${DOMAIN}/${LABEL}`]);
else {
  console.error("usage: pi-webui-launchd [install|update|status|logs|restart|uninstall]");
  process.exit(2);
}
