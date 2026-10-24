import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { POST as clone } from "../../src/app/api/voice/clone/route";
import { POST as remove } from "../../src/app/api/voice/delete/route";
import {
  bootstrapSession,
  verify,
  voiceGrant,
} from "../../src/lib/server/session";

process.env.SESSION_SECRET = "clone-tests-only";
process.env.ELEVENLABS_API_KEY = "mock-key";
function request(form: FormData, cookie: string) {
  return new Request("https://interpreter.test/api/voice/clone", {
    method: "POST",
    body: form,
    headers: { cookie, origin: "https://interpreter.test" },
  });
}
function sample(
  consent = "true",
  consentId = "00000000-0000-4000-8000-000000000001",
) {
  const form = new FormData();
  form.set("speaker", "a");
  form.set("consent", consent);
  form.set("consentId", consentId);
  form.set("seconds", "30");
  form.append(
    "files",
    new Blob([new Uint8Array(100)], { type: "audio/webm" }),
    "sample.webm",
  );
  return form;
}

test("voice cloning needs consent and returns a session-scoped grant, never a raw ID", async () => {
  const original = globalThis.fetch;
  const { cookie, claims } = bootstrapSession(
    new Request("https://interpreter.test"),
  );
  let calls = 0;
  let creations = 0;
  let saved: {
    voice_id: string;
    name: string;
    labels: Record<string, string>;
  } | null = null;
  try {
    globalThis.fetch = async (url, init) => {
      calls++;
      if (String(url).includes("/v2/voices?"))
        return Response.json({ voices: saved ? [saved] : [] });
      assert.match(String(url), /voices\/add$/);
      assert.equal((init?.body as FormData).getAll("files").length, 1);
      creations++;
      const form = init!.body as FormData;
      saved = {
        voice_id: "created-voice",
        name: String(form.get("name")),
        labels: JSON.parse(String(form.get("labels"))),
      };
      return Response.json({
        voice_id: "created-voice",
        requires_verification: false,
      });
    };
    assert.equal((await clone(request(sample("false"), cookie))).status, 400);
    assert.equal(calls, 0);
    const result = await clone(request(sample(), cookie));
    assert.equal(result.status, 200);
    const body = await result.json();
    assert.notEqual(body.voice, "created-voice");
    assert.equal(verify(body.voice)?.id, claims.id);
    assert.equal(verify(body.voice)?.speaker, "a");
    assert.equal(body.requiresVerification, false);
    const recovered = await clone(request(sample(), cookie));
    assert.equal(
      verify((await recovered.json()).voice)?.voiceId,
      "created-voice",
    );
    assert.equal(creations, 1, "a retry recovers the existing clone");
    const newPerson = await clone(
      request(sample("true", randomUUID()), cookie),
    );
    assert.equal(newPerson.status, 200);
    assert.equal(
      creations,
      2,
      "a new consent cannot reuse the previous person’s clone",
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("deletion cannot target another speaker’s clone or any account voice", async () => {
  const original = globalThis.fetch;
  const { cookie, claims } = bootstrapSession(
    new Request("https://interpreter.test"),
  );
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ status: "ok" });
  };
  try {
    const voice = voiceGrant(claims.id, "a", "created-voice");
    const make = (speaker: string, token: string) =>
      new Request("https://interpreter.test/api/voice/delete", {
        method: "POST",
        headers: {
          cookie,
          origin: "https://interpreter.test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ speaker, voice: token }),
      });
    assert.equal((await remove(make("b", voice))).status, 403);
    assert.equal((await remove(make("a", "account-voice-id"))).status, 403);
    assert.equal(calls, 0);
    assert.equal((await remove(make("a", voice))).status, 200);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
