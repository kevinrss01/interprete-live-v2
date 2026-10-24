import assert from "node:assert/strict";
import test from "node:test";
import { streamInterpretation } from "../src/lib/api";
import { base64ToBytes, bytesToBase64, makeWav } from "../src/lib/audio";

const body = {
  text: "Bonjour",
  sourceLanguage: "fr",
  targetLanguage: "en",
  speaker: "a" as const,
  voice: "sarah",
  isFinal: true,
  followingText: "",
  context: [],
};

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
    await streamInterpretation(body, new AbortController().signal, (e) =>
      events.push(e.type),
    );
    assert.deepEqual(events, ["text", "done"]);
    globalThis.fetch = async () =>
      sse(['data: {"type":"text","delta":"partial"}\n\n']);
    await assert.rejects(
      () => streamInterpretation(body, new AbortController().signal, () => {}),
      /avant la fin/,
    );
    globalThis.fetch = async () =>
      sse([
        'data: {"type":"error","message":"Provider unavailable","code":"UPSTREAM"}\n\n',
      ]);
    await assert.rejects(
      () => streamInterpretation(body, new AbortController().signal, () => {}),
      /Provider unavailable/,
    );
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
