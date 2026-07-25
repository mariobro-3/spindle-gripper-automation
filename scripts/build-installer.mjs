// Builds the Windows installer. electron-builder writes to a staging folder in
// %LOCALAPPDATA% because building inside a synced/watched Documents folder
// causes intermittent EPERM rename failures (antivirus/indexer file locks).
// The finished Setup exe is then copied into ./release.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const staging = path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), "spindle-gripper-release");
const releaseDir = path.join(process.cwd(), "release");

const result = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["electron-builder", `-c.directories.output=${staging}`],
  { stdio: "inherit", shell: true }
);
if (result.status !== 0) process.exit(result.status ?? 1);

fs.mkdirSync(releaseDir, { recursive: true });
let copied = 0;
for (const f of fs.readdirSync(staging)) {
  if (f.toLowerCase().endsWith(".exe") && !f.includes("__uninstaller")) {
    fs.copyFileSync(path.join(staging, f), path.join(releaseDir, f));
    console.log(`Installer ready: ${path.join(releaseDir, f)}`);
    copied++;
  }
}
if (!copied) {
  console.error(`No installer exe found in ${staging}`);
  process.exit(1);
}
