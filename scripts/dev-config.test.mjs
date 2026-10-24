import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { checkAccountConfig } from "./dev-config.mjs";

test("invalid account configuration exits before starting or stopping services", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./dev-server.mjs", import.meta.url))], {
    // A regression must never launch the developer's real Docker or pnpm.
    env: { ...process.env, PATH: "", BETTER_AUTH_SECRET: "" },
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /BETTER_AUTH_SECRET/);
  assert.equal(result.stdout, "");
});

test("local account configuration is required without disclosing secrets", () => {
  const directory = mkdtempSync(join(tmpdir(), "interprete-config-"));
  const root = pathToFileURL(directory + "/");
  const config = {
    DATABASE_URL: "postgresql://test:test@localhost:5436/test",
    BETTER_AUTH_URL: "http://localhost:3035",
    BETTER_AUTH_SECRET: "test-only-secret-with-at-least-32-characters",
  };
  try {
    assert.doesNotThrow(() => checkAccountConfig(root, config));
    assert.throws(() => checkAccountConfig(root, {}), /DATABASE_URL, BETTER_AUTH_URL, BETTER_AUTH_SECRET/);
    for (const [key, value] of Object.entries({
      DATABASE_URL: "https://not-a-database.example",
      BETTER_AUTH_URL: "file:///tmp/auth",
      BETTER_AUTH_SECRET: "private-short-secret",
    })) {
      assert.throws(() => checkAccountConfig(root, { ...config, [key]: value }), (error) => {
        assert.ok(error.message.includes(key));
        assert.ok(!error.message.includes(value));
        return true;
      });
    }
    mkdirSync(join(directory, "apps/server"), { recursive: true });
    const file = join(directory, "apps/server/.env.local");
    const content = Object.entries(config).map(([key, value]) => `${key}=${value}`).join("\n");
    writeFileSync(file, content);
    assert.doesNotThrow(() => checkAccountConfig(root, {}));
    // Node --env-file gives the inherited environment precedence over the file.
    assert.throws(() => checkAccountConfig(root, { BETTER_AUTH_SECRET: "" }), /BETTER_AUTH_SECRET/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
