import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cargoRunnerArgs } from "./dev-macos-config.mjs";

const args = ["tauri", "dev", ...process.argv.slice(2)];
if (process.platform === "darwin") {
  const runner = fileURLToPath(new URL("./dev-macos-runner.mjs", import.meta.url));
  args.push("--", ...cargoRunnerArgs(process.execPath, runner));
}
const child = spawn("pnpm", args, {
  cwd: fileURLToPath(new URL("../apps/desktop/", import.meta.url)),
  stdio: "inherit",
  shell: process.platform === "win32",
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
