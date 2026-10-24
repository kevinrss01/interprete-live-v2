import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("../", import.meta.url));
const compose = ["compose", "-f", "docker-compose.db.yml"];
const windows = process.platform === "win32";
const children = [];
let shutdownPromise;

function start(command, args) {
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
    detached: !windows,
    shell: windows && command === "pnpm",
  });
  const exited = new Promise((resolve) => {
    child.once("error", (error) => {
      console.error(`Impossible de lancer ${command}: ${error.message}`);
      resolve(1);
    });
    child.once("exit", (code) => resolve(code ?? 1));
  });
  const running = { child, exited };
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
  console.log("Démarrage de PostgreSQL…");
  let code = await start("docker", [...compose, "up", "-d", "--wait"]).exited;
  if (shutdownPromise) return;
  if (code !== 0) return shutdown(code);

  console.log("Application des migrations…");
  code = await start("pnpm", ["--filter", "@interprete/server", "db:migrate"]).exited;
  if (shutdownPromise) return;
  if (code !== 0) return shutdown(code);

  const api = start("pnpm", ["--filter", "@interprete/server", "dev"]);
  const studio = start("pnpm", ["--filter", "@interprete/server", "db:studio"]);
  console.log("API + Drizzle Studio lancés. Ctrl+C arrête le backend et conserve les données.");
  code = await Promise.race([api.exited, studio.exited]);
  if (!shutdownPromise) {
    console.error("Un processus du backend s’est arrêté. Arrêt des autres composants.");
    await shutdown(code || 1);
  }
}

void main().catch(async (error) => {
  console.error(error.message);
  await shutdown(1);
});
