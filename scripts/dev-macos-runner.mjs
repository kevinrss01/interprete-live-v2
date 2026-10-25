import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync, cpSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { developmentIdentity } from "./dev-macos-config.mjs";

// Cargo runs this after each successful dev build. Keep macOS's identity stable
// across rebuilds using a real local signing certificate, never an ad-hoc hash.
const native = fileURLToPath(new URL("../apps/desktop/src-tauri/", import.meta.url));
const executable = resolve(process.argv[2]);
const bundle = join(dirname(executable), "local", "Interprete Local.app");
const contents = join(bundle, "Contents");
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.error?.message || result.status}`);
  return result.stdout;
}
try {
  const identities = run("/usr/bin/security", ["find-identity", "-v", "-p", "codesigning"]);
  const identity = developmentIdentity(identities, process.env.INTERPRETE_DEV_SIGNING_IDENTITY);
  mkdirSync(join(contents, "MacOS"), { recursive: true });
  mkdirSync(join(contents, "Resources"), { recursive: true });
  const target = join(contents, "MacOS", "interprete");
  copyFileSync(executable, target);
  copyFileSync(join(native, "icons", "icon.icns"), join(contents, "Resources", "icon.icns"));
  const usage = readFileSync(join(native, "Info.plist"), "utf8").match(/<dict>([\s\S]*)<\/dict>/)[1];
  writeFileSync(join(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>interprete</string>
<key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
<key>CFBundleDevelopmentRegion</key><string>English</string>
<key>CFBundleIdentifier</key><string>ai.impulselab.interprete.local</string>
<key>CFBundleName</key><string>Interprete Local</string>
<key>CFBundleDisplayName</key><string>Interprete Local</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>0.1.1</string>
<key>CFBundleIconFile</key><string>icon.icns</string>
<key>LSMinimumSystemVersion</key><string>14.2</string>
<key>NSHighResolutionCapable</key><true/>
${usage}</dict></plist>`);
  run("/usr/bin/codesign", ["--force", "--sign", identity, "--timestamp=none", "--entitlements", join(native, "Entitlements.plist"), bundle]);
  run("/usr/bin/codesign", ["--verify", "--strict", bundle]);
  // Retain this checkout's existing browser preferences when moving from the
  // unbundled executable. Never overwrite an established local app data store.
  const previousData = join(homedir(), "Library", "WebKit", "interprete");
  const localData = join(homedir(), "Library", "WebKit", "ai.impulselab.interprete.local");
  if (!existsSync(localData) && existsSync(previousData)) cpSync(previousData, localData, { recursive: true });
  console.error("Launching signed Interprete Local (persistent Mac permission identity).");
  // LaunchServices makes this app responsible for its own TCC requests. Direct
  // execution inherits Terminal/Cursor's permissions even inside a signed bundle.
  const child = spawn("/usr/bin/open", ["-n", "-W", "--env", `INTERPRETE_DEV_RUNNER_PID=${process.pid}`, bundle, "--args", ...process.argv.slice(3)], { stdio: "inherit" });
  // The debug shell watches this PID and exits gracefully even if Cargo kills
  // this runner during a rebuild (LaunchServices apps are not Cargo children).
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(0));
  child.on("error", error => { console.error(error.message); process.exitCode = 1; });
  child.on("exit", code => { process.exitCode = code ?? 1; });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
