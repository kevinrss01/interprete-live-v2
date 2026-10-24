import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("./dev-server.mjs", import.meta.url));
const fixture = `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { basename } from "node:path";
const args = process.argv.slice(2);
const role = args[0] === "api-child" ? "api-child"
  : basename(process.argv[1]) === "docker" ? (args.includes("up") ? "database" : "stop-database")
  : args.at(-1);
const log = (event) => appendFileSync(process.env.DEV_TEST_LOG, JSON.stringify({ event, args, pid: process.pid }) + "\\n");
log("start:" + role);
if (role === "stop-database") {
  if (args.join(" ") !== "compose -f docker-compose.db.yml stop db") process.exit(9);
  process.exit(0);
}
if (role === "db:migrate") process.exit(process.env.DEV_TEST_MODE === "migration-fails" ? 3 : 0);
if (role === "database" && process.env.DEV_TEST_MODE !== "interrupt-startup") process.exit(0);
process.on("SIGTERM", () => { log("stop:" + role); process.exit(0); });
if (role === "dev") spawn(process.execPath, [process.argv[1], "api-child"], { stdio: "inherit" });
if (role === "db:studio" && process.env.DEV_TEST_MODE === "studio-fails") setTimeout(() => process.exit(4), 200);
setInterval(() => {}, 1000);
`;

test("backend lifecycle preserves the database and cleans up its processes", {
  skip: process.platform === "win32" ? "Executable fixtures use POSIX shebangs." : false,
  timeout: 20_000,
}, async (t) => {
  for (const mode of ["normal", "migration-fails", "interrupt-startup", "studio-fails"]) {
    await t.test(mode, async () => {
      const directory = await mkdtemp(join(tmpdir(), "interprete-dev-test-"));
      const log = join(directory, "events.jsonl");
      await writeFile(log, "");
      for (const name of ["docker", "pnpm"])
        await writeFile(join(directory, name), fixture, { mode: 0o755 });
      const runner = spawn(process.execPath, [script], {
        env: {
          ...process.env,
          PATH: directory + delimiter + process.env.PATH,
          DEV_TEST_LOG: log,
          DEV_TEST_MODE: mode,
        },
        stdio: "ignore",
      });
      const done = new Promise((resolve) => runner.once("exit", resolve));
      const events = async () => (await readFile(log, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
      const waitFor = async (event) => {
        for (let attempt = 0; attempt < 200; attempt++) {
          if ((await events()).some((item) => item.event === event)) return;
          await delay(20);
        }
        assert.fail(`Missing event: ${event}`);
      };
      try {
        if (mode === "normal") {
          await waitFor("start:api-child");
          await waitFor("start:db:studio");
          runner.kill("SIGINT");
        } else if (mode === "interrupt-startup") {
          await waitFor("start:database");
          runner.kill("SIGTERM");
        }
        const code = await Promise.race([done, delay(8000, "timeout", { ref: false })]);
        assert.equal(code, mode === "migration-fails" ? 3 : mode === "studio-fails" ? 4 : 0);
        const records = await events();
        const names = records.map((item) => item.event);
        assert.equal(names.filter((name) => name === "start:stop-database").length, 1);
        assert.equal(names.at(-1), "start:stop-database");
        assert.ok(records.every(({ args }) => !args.includes("down") && !args.includes("--volumes") && !args.includes("-v")));
        if (mode === "normal" || mode === "studio-fails") {
          assert.ok(names.indexOf("start:db:migrate") < names.indexOf("start:dev"));
          assert.ok(names.includes("stop:dev"));
          assert.ok(names.includes("stop:api-child"));
          if (mode === "normal") assert.ok(names.includes("stop:db:studio"));
        } else {
          assert.ok(!names.includes("start:dev"));
          assert.ok(!names.includes("start:db:studio"));
        }
      } finally {
        if (runner.exitCode === null && runner.signalCode === null) {
          runner.kill("SIGTERM");
          await done;
        }
        await rm(directory, { recursive: true, force: true });
      }
    });
  }
});
