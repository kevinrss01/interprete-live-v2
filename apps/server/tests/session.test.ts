import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  bootstrapSession,
  session,
  sign,
  verify,
  voiceGrant,
  resolveVoice,
  rateLimit,
} from "../src/lib/session";
import { interpretSchema, bodyJson } from "../src/lib/validation";
import { canPrepare, normalizeSpeech } from "@interprete/shared/text";

process.env.SESSION_SECRET = "test-secret-not-used-in-deployments";

test("session tokens are bearer-only and bound to the app origins", () => {
  const { token, claims } = bootstrapSession(
    new Request("https://interpreter.test/api/status"),
  );
  const headers = { authorization: `Bearer ${token}`, origin: "tauri://localhost" };
  const next = new Request("https://interpreter.test/api/session", { headers });
  assert.equal(session(next).id, claims.id);
  assert.equal(bootstrapSession(next).claims.id, claims.id);
  assert.throws(
    () =>
      session(
        new Request(next, {
          headers: { ...headers, origin: "https://another.test" },
        }),
      ),
    /does not come from the app/,
  );
  assert.throws(
    () =>
      session(
        new Request(next, {
          headers: { cookie: `interprete-session=${token}`, origin: "tauri://localhost" },
        }),
      ),
    /session/,
  );
  assert.equal(verify(sign({ ...claims, expires: Date.now() - 1 })), null);
  assert.equal(verify(sign({ ...claims, expires: NaN })), null);
  const signed = sign(claims);
  assert.equal(verify(signed.slice(0, -4) + "abcd"), null);
});

test("custom voices cannot cross speaker or session boundaries", () => {
  const grant = voiceGrant("session-one", "a", "custom-voice-id");
  assert.equal(resolveVoice(grant, "session-one", "a", "en"), "custom-voice-id");
  assert.equal(
    resolveVoice(grant, "session-one", "a", "fr"),
    "custom-voice-id",
    "a clone keeps its owner's voice in every language",
  );
  assert.throws(() => resolveVoice(grant, "session-two", "a", "en"));
  assert.throws(() => resolveVoice(grant, "session-one", "b", "en"));
  assert.throws(() =>
    resolveVoice("raw-external-voice-id", "session-one", "a", "en"),
  );
  assert.equal(
    resolveVoice("sarah", "any-session", "b", "en"),
    "EXAVITQu4vr4xnSDxMaL",
  );
});

test("rate limits reject repeated work and reset for a different session", () => {
  const id = randomUUID();
  rateLimit(id, "test", 2);
  rateLimit(id, "test", 2);
  assert.throws(() => rateLimit(id, "test", 2), /Too many requests/);
  assert.doesNotThrow(() => rateLimit(randomUUID(), "test", 2));
});

test("translation inputs must use different supported languages and bounded text", async () => {
  const good = {
    text: "Bonjour tout le monde.",
    sourceLanguage: "fr",
    targetLanguage: "en",
    speaker: "a",
    voice: "sarah",
    isFinal: true,
  };
  assert.equal(interpretSchema.safeParse(good).success, true);
  for (const patch of [
    { text: "" },
    { text: "x".repeat(4001) },
    { targetLanguage: "fr" },
    { sourceLanguage: "unknown" },
    { speaker: "c" },
  ])
    assert.equal(
      interpretSchema.safeParse({ ...good, ...patch }).success,
      false,
    );
  await assert.rejects(
    () =>
      bodyJson(
        new Request("https://interpreter.test", {
          method: "POST",
          body: "x".repeat(25001),
        }),
      ),
    /too long/,
  );
});

test("speculation ignores punctuation-only changes and very short fragments", () => {
  assert.equal(normalizeSpeech("BONJOUR, le monde !"), "bonjour le monde");
  assert.equal(
    canPrepare("Bonjour tout le monde.", "Bonjour tout le monde !"),
    false,
  );
  assert.equal(canPrepare("Bonjour", ""), false);
  assert.equal(canPrepare("Je voudrais une table pour deux.", ""), true);
});
