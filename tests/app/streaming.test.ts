import assert from "node:assert/strict";
import test from "node:test";
import { streamInterpretation } from "../../src/lib/client/api";
import {
  base64ToBytes,
  bytesToBase64,
  makeWav,
} from "../../src/lib/client/audio";
import {
  translateText,
  evaluateReadiness,
  createTranscriptionSession,
} from "../../src/lib/server/openai";

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

test("fragmented text/audio streams require an explicit successful end", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      sse([
        'data: {"type":"text","delta":"Bon',
        'jour"}\n\n',
        'data: {"type":"done","text":"Bonjour","spoken":true,"metrics":{}}\n\n',
      ]);
    const events: string[] = [];
    await streamInterpretation({}, new AbortController().signal, (e) =>
      events.push(e.type),
    );
    assert.deepEqual(events, ["text", "done"]);
    globalThis.fetch = async () =>
      sse(['data: {"type":"text","delta":"partial"}\n\n']);
    await assert.rejects(
      () => streamInterpretation({}, new AbortController().signal, () => {}),
      /avant la fin/,
    );
    globalThis.fetch = async () =>
      sse([
        'data: {"type":"error","message":"Provider unavailable","code":"UPSTREAM"}\n\n',
      ]);
    await assert.rejects(
      () => streamInterpretation({}, new AbortController().signal, () => {}),
      /Provider unavailable/,
    );
  } finally {
    globalThis.fetch = original;
  }
});

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

test("PCM round trip and WAV header preserve odd network chunks", async () => {
  const pcm = new Uint8Array([0, 0, 255, 127, 0, 128]);
  assert.deepEqual(base64ToBytes(bytesToBase64(pcm)), pcm);
  const wav = new DataView(
    await makeWav([pcm.slice(0, 3), pcm.slice(3)]).arrayBuffer(),
  );
  assert.equal(wav.getUint32(24, true), 24000);
  assert.equal(wav.getUint32(40, true), 6);
  assert.equal(wav.getInt16(46, true), 32767);
  assert.equal(wav.getInt16(48, true), -32768);
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
