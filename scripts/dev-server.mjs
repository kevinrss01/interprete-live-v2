import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkAccountConfig } from "./dev-config.mjs";

const cwd = fileURLToPath(new URL("../", import.meta.url));
const compose = ["compose", "-f", "docker-compose.db.yml"];
const windows = process.platform === "win32";
const includeDesktop = process.argv.includes("--desktop");
const children = [];
let shutdownPromise;

function start(command, args, waitForApi = false) {
  const child = spawn(command, args, {
    cwd,
    stdio: waitForApi ? ["inherit", "pipe", "inherit"] : "inherit",
    detached: !windows,
    shell: windows && command === "pnpm",
  });
  const ready = waitForApi ? new Promise((resolve) => {
    let output = "";
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      output = (output + chunk.toString()).slice(-1024);
      if (output.includes("API listening on :")) resolve();
    });
  }) : Promise.resolve();
  const exited = new Promise((resolve) => {
    child.once("error", (error) => {
      console.error(`Impossible de lancer ${command}: ${error.message}`);
      resolve(1);
    });
    child.once("exit", (code) => resolve(code ?? 1));
  });
  const running = { child, exited, ready };
  children.push(running);
  return running;
}

function terminate(child, force = false) {
  if (!child.pid) return;
  if (windows) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    // Stop the entire pnpm/tsx process group, including the watched API process.
    process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") console.error("Impossible d’arrêter un processus enfant.");
  }
}

function shutdown(code) {
  return shutdownPromise ??= (async () => {
    process.exitCode = code;
    const running = [...children];
    for (const { child } of running) terminate(child);
    const timeout = setTimeout(() => {
      for (const { child } of running) terminate(child, true);
    }, 5000);
    await Promise.all(running.map(({ exited }) => exited));
    clearTimeout(timeout);

    // Stop only: the PostgreSQL container and its named volume are preserved.
    const stopped = await start("docker", [...compose, "stop", "db"]).exited;
    if (stopped !== 0) {
      process.exitCode = 1;
      console.error("PostgreSQL n’a pas pu être arrêté ; son volume est conservé.");
    } else {
      console.log("Backend arrêté. Volume PostgreSQL conservé.");
    }
  })();
}

process.on("SIGINT", () => { void shutdown(0); });
process.on("SIGTERM", () => { void shutdown(0); });

async function main() {
  checkAccountConfig(new URL("../", import.meta.url));
  console.log("Démarrage de PostgreSQL…");
  let code = await start("docker", [...compose, "up", "-d", "--wait"]).exited;
  if (shutdownPromise) return;
  if (code !== 0) return shutdown(code);

  console.log("Application des migrations…");
  code = await start("pnpm", ["--filter", "@interprete/server", "db:migrate"]).exited;
  if (shutdownPromise) return;
  if (code !== 0) return shutdown(code);

  const api = start("pnpm", ["--filter", "@interprete/server", "dev"], includeDesktop);
  const studio = start("pnpm", ["--filter", "@interprete/server", "db:studio"]);
  if (includeDesktop) {
    let timer;
    const startup = await Promise.race([
      api.ready.then(() => ({ ready: true, code: 0 })),
      api.exited.then((code) => ({ ready: false, code: code || 1 })),
      studio.exited.then((code) => ({ ready: false, code: code || 1 })),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ ready: false, code: 1 }), 30_000);
      }),
    ]);
    clearTimeout(timer);
    if (shutdownPromise) return;
    if (!startup.ready) return shutdown(startup.code);
  }
  const desktop = includeDesktop
    ? start("pnpm", ["--filter", "@interprete/desktop", "dev"])
    : null;
  console.log(`${includeDesktop ? "App + " : ""}API + Drizzle Studio lancés. Ctrl+C arrête les processus et conserve les données.`);
  const processes = desktop ? [api, studio, desktop] : [api, studio];
  const first = await Promise.race(
    processes.map((running) => running.exited.then((code) => ({ running, code }))),
  );
  if (!shutdownPromise) {
    if (first.running === desktop && first.code === 0) return shutdown(0);
    console.error("Un processus du backend s’est arrêté. Arrêt des autres composants.");
    await shutdown(first.code || 1);
  }
}

void main().catch(async (error) => {
  console.error(error.message);
  if (children.length) await shutdown(1);
  else process.exitCode = 1;
});
