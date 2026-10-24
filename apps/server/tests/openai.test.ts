import assert from "node:assert/strict";
import test from "node:test";
import {
  translateText,
  evaluateReadiness,
  createTranscriptionSession,
} from "../src/lib/openai";

process.env.INTERPRETER_OPENAI_API_KEY = "test-openai";
process.env.AI_GATEWAY_API_KEY = "test-gateway";

function sse(parts: string[]) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const part of parts)
          controller.enqueue(new TextEncoder().encode(part));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

test("translation deltas survive network chunk boundaries", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "gpt-5.4-nano");
      assert.equal(body.reasoning_effort, "none");
      return sse([
        'data: {"choices":[{"delta":{"content":"Hello "}}]}\n',
        'data: {"choices":[{"delta":{"content":',
        '"world."}}]}\n\ndata: [DONE]\n\n',
      ]);
    };
    let text = "";
    for await (const delta of translateText(
      "Bonjour le monde",
      "fr",
      "en",
      [],
      new AbortController().signal,
    ))
      text += delta;
    assert.equal(text, "Hello world.");
  } finally {
    globalThis.fetch = original;
  }
});

test("Jev unavailable never authorizes speculative speech", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response("rate limited", { status: 429 });
    const result = await evaluateReadiness(
      "An unfinished thought",
      new AbortController().signal,
    );
    assert.equal(result.unavailable, true);
    assert.equal(result.probability, null);
    globalThis.fetch = async () =>
      Response.json({ answers: { ready: { probability: 0.98 } } });
    const ready = await evaluateReadiness(
      "A complete sentence.",
      new AbortController().signal,
    );
    assert.equal(ready.probability, 0.98);
  } finally {
    globalThis.fetch = original;
  }
});

test("continuous capture requests the minimal transcription delay", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(
        body.session.audio.input.transcription.model,
        "gpt-live-transcribe",
      );
      assert.equal(body.session.audio.input.transcription.delay, "minimal");
      assert.equal(body.session.audio.input.turn_detection, null);
      return Response.json({ value: "ephemeral-test-only", expires_at: 123 });
    };
    assert.equal(
      (await createTranscriptionSession("fr")).token,
      "ephemeral-test-only",
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("translated prefix is passed explicitly to continue, rather than translating it again", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const newest = JSON.parse(body.messages.at(-1).content);
      assert.deepEqual(newest.translatedPrefix, {
        source: "Aucune personne réelle",
        translation: "No real person",
      });
      assert.equal(newest.speech, "ne parle.");
      return sse([
        'data: {"choices":[{"delta":{"content":"speaks."}}]}\n\ndata: [DONE]\n\n',
      ]);
    };
    let text = "";
    for await (const delta of translateText(
      "ne parle.",
      "fr",
      "en",
      [
        {
          source: "Aucune personne réelle",
          translation: "No real person",
          sourceLanguage: "fr",
          targetLanguage: "en",
          continuation: true,
        },
      ],
      new AbortController().signal,
    ))
      text += delta;
    assert.equal(text, "speaks.");
  } finally {
    globalThis.fetch = original;
  }
});
