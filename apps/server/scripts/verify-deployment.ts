// Explicit live-provider smoke check. Only synthetic text; never capture or play audio.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ApiClient } from "../src/rpc/router";

async function main() {
  const { values } = parseArgs({ options: {
    url: { type: "string" }, origin: { type: "string" }, "account-file": { type: "string" },
    revision: { type: "string" }, "keep-discussion": { type: "boolean", default: false },
  } });
  assert.ok(values.url && values.origin && values["account-file"],
    "Pass --url, --origin and --account-file for a disposable QA account.");
  const base = new URL(values.url);
  assert.ok(base.protocol === "https:" || (base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname)),
    "Use HTTPS or a local loopback API.");
  assert.ok(!base.username && !base.password && !base.search && !base.hash && base.pathname === "/",
    "The API URL must be an origin without credentials or query parameters.");
  assert.ok(!values.revision || /^[a-f0-9]{40}$/i.test(values.revision), "Expected revision must be a full Git SHA.");
  const account = JSON.parse(await readFile(values["account-file"], "utf8")) as { email?: string; password?: string };
  assert.ok(account.email && account.password, "The account file must contain email and password.");
  const headers = { Origin: values.origin, "User-Agent": "agent-local", "Content-Type": "application/json" };
  const request: typeof fetch = (input, init) => fetch(input, {
    ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(30_000)]),
  });
  const status = await request(new URL("/api/status", base), { headers });
  assert.equal(status.status, 200, "API status failed.");
  const device = await status.json() as { session: string; revision?: string | null; services: { transcription: boolean; voice: boolean } };
  assert.ok(device.session && device.services.transcription && device.services.voice, "The speech providers are not configured.");
  if (values.revision) assert.equal(device.revision, values.revision, "The deployed API is not the expected revision.");

  const captions = await request(new URL("/api/interpret", base), {
    method: "POST", headers: { ...headers, Authorization: `Bearer ${device.session}` },
    body: JSON.stringify({ text: "Bonjour, ceci est un test silencieux.", sourceLanguage: "fr", targetLanguage: "en",
      speaker: "b", voice: "sarah", speak: false, isFinal: true }),
  });
  assert.equal(captions.status, 200, "The captions-only request failed.");
  assert.match(captions.headers.get("Content-Type") ?? "", /text\/event-stream/);
  const events = (await captions.text()).split(/\r?\n\r?\n/).flatMap((block) => {
    const data = block.split(/\r?\n/).find((line) => line.startsWith("data:"));
    return data ? [JSON.parse(data.slice(5)) as { type: string; text?: string; spoken?: boolean }] : [];
  });
  assert.equal(events.filter((event) => event.type === "audio").length, 0, "Captions-only mode returned audio.");
  assert.equal(events.filter((event) => event.type === "error").length, 0, "Captions-only mode returned an error.");
  const done = events.at(-1);
  assert.ok(events.some((event) => event.type === "text") && done?.type === "done" && done.text?.trim() && done.spoken === false,
    "Captions-only mode did not finish with translated text and spoken=false.");

  const login = async (): Promise<ApiClient> => {
    const response = await request(new URL("/api/auth/sign-in/email", base), {
      method: "POST", headers, body: JSON.stringify({ email: account.email, password: account.password }),
    });
    assert.equal(response.status, 200, "QA account sign-in failed.");
    const body = await response.json() as { token?: string };
    const token = response.headers.get("set-auth-token") || body.token;
    assert.ok(token, "Sign-in did not return a bearer session.");
    return createORPCClient(new RPCLink({ url: new URL("/rpc", base).href, fetch: request,
      headers: { ...headers, Authorization: `Bearer ${token}` } }));
  };
  const first = await login();
  await first.account.me();
  await first.preferences.get();
  await first.voice.get({ session: device.session });
  await first.discussions.list();
  // Reject a voice without an ownership grant; do not create or replace a voice.
  await assert.rejects(() => first.voice.save({ session: device.session, voice: "invalid-deployment-check-grant" }), { code: "FORBIDDEN" });

  const at = Date.now();
  const discussion = {
    id: `deployment-check-${randomUUID()}`, kind: "conversation" as const, title: "Synthetic deployment check", callId: null,
    startedAt: at, updatedAt: at, closedAt: at,
    messages: [{ id: randomUUID(), role: "you" as const, name: "QA", source: "Synthetic verification.",
      translation: "Vérification synthétique.", sourceLanguage: "en" as const, targetLanguage: "fr" as const,
      status: "done" as const, error: null, demo: true, spokenAt: at, updatedAt: at }],
  };
  try {
    assert.equal((await first.discussions.save(discussion)).id, discussion.id);
    // A fresh login/client has no browser cache and must load the saved database row.
    const second = await login();
    const remote = (await second.discussions.list()).find((item) => item.id === discussion.id);
    assert.ok(remote && remote.messageCount === 1 && remote.startedAt === at, "Saved history was not returned to a fresh login.");
    assert.deepEqual(await second.discussions.messages({ id: discussion.id }), discussion.messages);
    await second.voice.get({ session: device.session });
  } finally {
    // Only remove this run's synthetic row; never touch existing account history.
    if (!values["keep-discussion"]) await first.discussions.remove({ id: discussion.id });
  }
  console.log(JSON.stringify({ api: base.origin, revision: device.revision ?? null,
    captionsOnly: { translated: true, audioEvents: 0, spoken: false },
    account: { signIn: true, voiceRoute: true, invalidVoiceRejected: true, historyReloadedAfterNewLogin: true },
    ...(values["keep-discussion"] ? { syntheticDiscussionId: discussion.id } : {}), audioPlayed: false }, null, 2));
}

void main().catch((error: unknown) => {
  // Do not dump provider responses, account data or bearer tokens into CI logs.
  console.error(error instanceof assert.AssertionError ? error.message :
    `Deployment verification failed (${error && typeof error === "object" && "code" in error ? String(error.code) : "request or configuration error"}).`);
  process.exitCode = 1;
});
