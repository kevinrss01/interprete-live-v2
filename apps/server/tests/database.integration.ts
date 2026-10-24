import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { app } from "../src/app";
import { getAuth } from "../src/auth";
import { closeDb, getDb } from "../src/db";
import { session, user, userPreferences } from "../src/db/schema";
import { bootstrapSession } from "../src/lib/session";
import type { ApiClient } from "../src/rpc/router";

test("PostgreSQL migrations, Better Auth sessions and RPC isolate each user's preferences", async () => {
  assert.ok(process.env.TEST_DATABASE_URL, "Set TEST_DATABASE_URL to a dedicated test database.");
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.BETTER_AUTH_SECRET = "test-only-auth-secret-with-at-least-32-characters";
  process.env.BETTER_AUTH_URL = "http://localhost:3035";
  process.env.SESSION_SECRET = "test-only-legacy-session-secret";
  const db = getDb();
  const users = [randomUUID(), randomUUID()];
  const client = (token: string): ApiClient => createORPCClient(new RPCLink({
    url: "http://localhost:3035/rpc",
    headers: { authorization: `Bearer ${token}`, origin: "tauri://localhost" },
    fetch: async (request, init) => app.request(request, init),
  }));
  try {
    const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
    await migrate(db, { migrationsFolder });
    await migrate(db, { migrationsFolder });
    await db.insert(user).values(users.map((id) => ({ id, name: "Test", email: `${id}@example.com` })));
    const adapter = (await getAuth().$context).internalAdapter;
    const firstSession = await adapter.createSession(users[0]);
    const secondSession = await adapter.createSession(users[1]);
    const first = client(firstSession.token);
    const second = client(secondSession.token);

    const profile = await first.account.me();
    assert.equal(profile.id, users[0]);
    assert.deepEqual(Object.keys(profile).sort(), ["email", "emailVerified", "id", "image", "name"]);
    assert.deepEqual(await first.account.updateName({ name: "  Alex  " }), { name: "Alex" });
    assert.equal((await first.account.me()).name, "Alex");
    assert.equal((await second.account.me()).name, "Test");
    for (const input of [{ name: "" }, { name: "   " }, { name: "x".repeat(65) },
      { name: "Alex", email: "other@example.com" }])
      await assert.rejects(() => first.account.updateName(input), { code: "BAD_REQUEST" });
    assert.equal((await first.account.me()).email, `${users[0]}@example.com`);
    assert.equal(await first.preferences.get(), null);
    assert.deepEqual(await first.preferences.update({ sourceLanguage: "fr", targetLanguage: "en" }),
      { sourceLanguage: "fr", targetLanguage: "en" });
    assert.equal(await second.preferences.get(), null);
    await second.preferences.update({ sourceLanguage: "de", targetLanguage: "es" });
    await first.preferences.update({ sourceLanguage: "ja", targetLanguage: "fr" });
    assert.deepEqual(await first.preferences.get(), { sourceLanguage: "ja", targetLanguage: "fr" });
    assert.deepEqual(await second.preferences.get(), { sourceLanguage: "de", targetLanguage: "es" });
    assert.equal((await db.select().from(userPreferences).where(eq(userPreferences.userId, users[0]))).length, 1);

    for (const input of [
      { sourceLanguage: "xx", targetLanguage: "en" },
      { sourceLanguage: "fr", targetLanguage: "fr" },
      { sourceLanguage: "fr", targetLanguage: "en", userId: users[1] },
    ]) await assert.rejects(() => first.preferences.update(input), { code: "BAD_REQUEST" });

    const { token } = bootstrapSession(new Request("http://localhost:3035/api/status"));
    await assert.rejects(() => client(token).account.me(), { code: "UNAUTHORIZED" });
    await db.update(session).set({ expiresAt: new Date(0) }).where(eq(session.id, firstSession.id));
    await assert.rejects(() => first.preferences.get(), { code: "UNAUTHORIZED" });
    await db.delete(session).where(eq(session.id, secondSession.id));
    await assert.rejects(() => second.account.me(), { code: "UNAUTHORIZED" });

    await assert.rejects(() => db.insert(userPreferences).values({
      userId: randomUUID(), sourceLanguage: "fr", targetLanguage: "en",
    }));
    await db.delete(user).where(inArray(user.id, users));
    assert.equal((await db.select().from(userPreferences).where(inArray(userPreferences.userId, users))).length, 0);
  } finally {
    await db.delete(user).where(inArray(user.id, users)).finally(closeDb);
  }
});
