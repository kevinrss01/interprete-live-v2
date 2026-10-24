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
} from "../../src/lib/server/session";
import { interpretSchema, bodyJson } from "../../src/lib/server/validation";
import { canPrepare, normalizeSpeech } from "../../src/lib/text";

process.env.SESSION_SECRET = "test-secret-not-used-in-deployments";

test("session cookies are private, scoped and authenticated", () => {
  const request = new Request("https://interpreter.test/api/status");
  const { cookie, claims } = bootstrapSession(request);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
  const next = new Request("https://interpreter.test/api/session", {
    headers: { cookie, origin: "https://interpreter.test" },
  });
  assert.equal(session(next).id, claims.id);
  assert.throws(
    () =>
      session(
        new Request(next, {
          headers: { cookie, origin: "https://another.test" },
        }),
      ),
    /application/,
  );
  assert.equal(verify(sign({ ...claims, expires: Date.now() - 1 })), null);
  assert.equal(verify(sign({ ...claims, expires: NaN })), null);
  const token = sign(claims);
  assert.equal(verify(token.slice(0, -4) + "abcd"), null);
});

test("custom voices cannot cross speaker or session boundaries", () => {
  const grant = voiceGrant("session-one", "a", "custom-voice-id");
  assert.equal(resolveVoice(grant, "session-one", "a"), "custom-voice-id");
  assert.throws(() => resolveVoice(grant, "session-two", "a"));
  assert.throws(() => resolveVoice(grant, "session-one", "b"));
  assert.throws(() =>
    resolveVoice("raw-external-voice-id", "session-one", "a"),
  );
  assert.equal(
    resolveVoice("sarah", "any-session", "b"),
    "EXAVITQu4vr4xnSDxMaL",
  );
});

test("rate limits reject repeated work and reset for a different session", () => {
  const id = randomUUID();
  rateLimit(id, "test", 2);
  rateLimit(id, "test", 2);
  assert.throws(() => rateLimit(id, "test", 2), /Trop de demandes/);
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
    /longue/,
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
