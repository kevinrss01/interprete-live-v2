import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { app } from "../src/app";
import { closeDb } from "../src/db";
import type { ApiClient } from "../src/rpc/router";

after(closeDb);

test("account routes report missing configuration without breaking the audio API", async () => {
  delete process.env.BETTER_AUTH_SECRET;
  process.env.SESSION_SECRET = "legacy-session-test-secret";
  assert.equal((await app.request("/api/auth/ok")).status, 503);
  const status = await app.request("/api/status");
  assert.equal(status.status, 200);
  assert.equal(typeof (await status.json()).session, "string");
});

test("RPC requires authentication and exposes the configured browser headers", async () => {
  process.env.BETTER_AUTH_SECRET = "test-only-auth-secret-with-at-least-32-characters";
  process.env.BETTER_AUTH_URL = "http://localhost:3035";
  process.env.DATABASE_URL = "postgresql://unused:unused@localhost:1/unused";
  const client: ApiClient = createORPCClient(new RPCLink({
    url: "http://localhost:3035/rpc",
    fetch: async (request, init) => app.request(request, init),
  }));
  for (const request of [() => client.account.me(), () => client.account.updateName({ name: "Alex" }),
    () => client.preferences.get(),
    () => client.preferences.update({ sourceLanguage: "fr", targetLanguage: "en" }),
    () => client.discussions.list(),
    () => client.discussions.messages({ id: "discussion" }),
    () => client.discussions.remove({ id: "discussion" }),
    () => client.discussions.save({
      id: "discussion", kind: "conversation", title: "Hello", callId: null,
      startedAt: 1, updatedAt: 1, closedAt: null, messages: [],
    })])
    await assert.rejects(request, { code: "UNAUTHORIZED" });
  assert.equal((await app.request("/api/auth/ok")).status, 200);

  for (const path of ["/rpc/preferences/update", "/api/auth/get-session"]) {
    const response = await app.request(path, {
      method: "OPTIONS",
      headers: { origin: "tauri://localhost", "access-control-request-method": "POST" },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "tauri://localhost");
    assert.equal(response.headers.get("access-control-allow-credentials"), "true");
    assert.match(response.headers.get("access-control-allow-headers") || "", /Authorization/);
  }
  const denied = await app.request("/rpc/account/me", {
    method: "POST", headers: { origin: "https://untrusted.example" },
  });
  assert.equal(denied.status, 403);
  const oversized = await app.request("/rpc/preferences/update", {
    method: "POST", body: "x".repeat(25_001),
  });
  assert.equal(oversized.status, 413);
});
