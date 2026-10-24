import assert from "node:assert/strict";
import test from "node:test";
import { MATCH_VOICES, nearestMatchVoice } from "@interprete/shared/languages";
import type { InterpretationEvent } from "@interprete/shared/contracts";
import { interpretResponse } from "../src/lib/interpret";
import { resolveVoice } from "../src/lib/session";
import { interpretSchema, voiceMatchSchema } from "../src/lib/validation";
import { matchVoice } from "../src/lib/voice-match";
import { translateText } from "../src/lib/openai";

process.env.INTERPRETER_OPENAI_API_KEY = "test-openai";
process.env.AI_GATEWAY_API_KEY = "test-gateway";
process.env.SESSION_SECRET = "test-secret-not-used-in-deployments";
delete process.env.ELEVENLABS_API_KEY;

const features = {
  medianPitchHz: 118,
  pitchRangeSemitones: 5,
  brightness: 0.3,
  voicedSeconds: 2,
};
async function events(response: Response) {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter((block) => block.startsWith("data:"))
    .map((block) => JSON.parse(block.slice(5)) as InterpretationEvent);
}

test("captions stream translated text without opening a voice synthesis", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (String(url).includes("ai-gateway"))
        return Response.json({ answers: { ready: { probability: 0.9 } } });
      return new Response(
        'data: {"choices":[{"delta":{"content":"Hello there"}}]}\n\ndata: [DONE]\n\n',
        { headers: { "Content-Type": "text/event-stream" } },
      );
    };
    const data = interpretSchema.parse({
      text: "Bonjour à tous",
      sourceLanguage: "fr",
      targetLanguage: "en",
      speaker: "b",
      voice: "george",
      isFinal: false,
      speak: false,
    });
    // ElevenLabs is not configured here: any synthesis attempt would end in an error event.
    const received = await events(
      interpretResponse(data, null, new AbortController().signal),
    );
    assert.deepEqual(
      received.map((event) => event.type),
      ["gate", "text", "done"],
    );
    const done = received.at(-1);
    assert.equal(done?.type === "done" && done.spoken, false);
    assert.equal(done?.type === "done" && done.text, "Hello there");
  } finally {
    globalThis.fetch = original;
  }
});

test("speech stays the default and matched voices resolve to premade voices only", () => {
  const data = interpretSchema.parse({
    text: "Bonjour",
    sourceLanguage: "fr",
    targetLanguage: "en",
    speaker: "a",
    voice: "sarah",
    isFinal: true,
  });
  assert.equal(data.speak, undefined);
  for (const voice of MATCH_VOICES)
    assert.equal(resolveVoice(voice.key, "any-session", "b"), voice.id);
  assert.throws(() => resolveVoice(MATCH_VOICES[0].id, "any-session", "b"));
});

test("Jev chooses among the premade voices from on-device measurements", async () => {
  const original = globalThis.fetch;
  try {
    let body = {} as {
      model?: string;
      state?: { speaker?: { medianPitchHz?: number } };
      questions?: { voice?: { criteria?: Record<string, string> } };
    };
    globalThis.fetch = async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({
        answers: { voice: { type: "choice", choice: "chris" } },
      });
    };
    const match = await matchVoice(
      features,
      "fr",
      new AbortController().signal,
    );
    assert.deepEqual(match, { voice: "chris", name: "Chris", source: "jev" });
    assert.equal(body.model, "typesafe-ai/jev-1.14.0");
    assert.equal(body.state?.speaker?.medianPitchHz, 118);
    assert.deepEqual(
      Object.keys(body.questions?.voice?.criteria ?? {}),
      MATCH_VOICES.map((voice) => voice.key),
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("an unavailable or invalid Jev answer falls back to the nearest pitch band", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("busy", { status: 429 });
    const high = await matchVoice(
      { ...features, medianPitchHz: 238 },
      "en",
      new AbortController().signal,
    );
    assert.deepEqual(high, { voice: "jessica", name: "Jessica", source: "pitch" });
    globalThis.fetch = async () =>
      Response.json({ answers: { voice: { choice: "EXAVITQu4vr4xnSDxMaL" } } });
    const low = await matchVoice(
      { ...features, medianPitchHz: 92 },
      "en",
      new AbortController().signal,
    );
    assert.deepEqual(low, { voice: "brian", name: "Brian", source: "pitch" });
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(nearestMatchVoice(160).key, "river");
  assert.equal(
    voiceMatchSchema.safeParse({ language: "en", features: { ...features, medianPitchHz: 9000 } }).success,
    false,
  );
});

test("a translation stream cut off before [DONE] fails instead of looking complete", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response('data: {"choices":[{"delta":{"content":"Bon"}}]}\n\n', {
        headers: { "Content-Type": "text/event-stream" },
      });
    const received: string[] = [];
    await assert.rejects(async () => {
      for await (const delta of translateText("Bonjour", "fr", "en", [], new AbortController().signal))
        received.push(delta);
    }, /TRANSLATION_STREAM/);
    assert.deepEqual(received, ["Bon"]);
  } finally {
    globalThis.fetch = original;
  }
});
