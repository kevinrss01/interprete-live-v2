import assert from "node:assert/strict";
import test from "node:test";
import { signIn, signUp } from "../src/lib/account";

test("authentication reports missing server configuration instead of a retry error", async (t) => {
  for (const code of ["AUTH_NOT_CONFIGURED", "DATABASE_NOT_CONFIGURED"]) {
    t.mock.method(globalThis, "fetch", async () => Response.json({ code }, { status: 503 }));
    const expected = code === "AUTH_NOT_CONFIGURED" ? /authentication is not configured/ : /database is not configured/;
    await assert.rejects(signUp({ name: "Test", email: "test@example.invalid", password: "test-password" }), expected);
    await assert.rejects(signIn({ email: "test@example.invalid", password: "test-password" }), expected);
    t.mock.restoreAll();
  }
});
