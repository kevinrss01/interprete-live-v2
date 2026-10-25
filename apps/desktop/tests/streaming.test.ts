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
    await streamInterpretation(body, new AbortController().signal, (e) => {
      events.push(e.type);
    });
    assert.deepEqual(events, ["text", "done"]);
    globalThis.fetch = async () =>
      sse(['data: {"type":"text","delta":"partial"}\n\n']);
    await assert.rejects(
      () => streamInterpretation(body, new AbortController().signal, () => {}),
      /before the translation finished/,
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

test("SSE waits for asynchronous audio delivery before advancing the stream", async () => {
  const original = globalThis.fetch;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const seen: string[] = [];
  globalThis.fetch = async () =>
    sse([
      'data: {"type":"audio","audio":"AAE="}\n\ndata: {"type":"done","spoken":true,"text":"Hello","metrics":{}}\n\n',
    ]);
  try {
    const streaming = streamInterpretation(
      body,
      new AbortController().signal,
      async (event) => {
        seen.push(event.type);
        if (event.type === "audio") await blocked;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(seen, ["audio"]);
    release();
    await streaming;
    assert.deepEqual(seen, ["audio", "done"]);
  } finally {
    release();
    globalThis.fetch = original;
  }
});

test("done releases a stream that never closes, even when cancellation never settles", async (t) => {
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('data: {"type":"done","text":"Hello","spoken":false,"metrics":{}}\n\n')); },
    cancel() { cancelled = true; return new Promise(() => {}); },
  }), { headers: { "Content-Type": "text/event-stream" } }));
  await streamInterpretation(body, new AbortController().signal, () => {}, { firstEventMs: 100, idleMs: 100, requestMs: 200 });
  assert.equal(cancelled, true);
});

test("an unresponsive fetch, silent body, and blocked audio delivery all have deadlines", async (t) => {
  for (const mode of ["fetch", "body", "playback"] as const) {
    let requestSignal!: AbortSignal;
    t.mock.method(globalThis, "fetch", async (_url: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init!.signal as AbortSignal;
      if (mode === "fetch") return new Promise<Response>(() => {});
      return new Response(new ReadableStream({ start(controller) {
        if (mode === "playback") controller.enqueue(new TextEncoder().encode('data: {"type":"audio","audio":"AAE=","sampleRate":24000}\n\n'));
      } }), { headers: { "Content-Type": "text/event-stream" } });
    });
    await assert.rejects(streamInterpretation(body, new AbortController().signal,
      () => mode === "playback" ? new Promise<void>(() => {}) : undefined,
      { firstEventMs: 15, idleMs: 15, requestMs: 50 }), { code: "TRANSLATION_TIMEOUT" });
    assert.equal(requestSignal.aborted, true, mode);
    t.mock.restoreAll();
  }
});

test("caller cancellation releases a blocked stream and preserves structured provider failures", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream(), { headers: { "Content-Type": "text/event-stream" } }));
  const abort = new AbortController();
  const pending = streamInterpretation(body, abort.signal, () => {});
  abort.abort(new Error("Cancelled by the user"));
  await assert.rejects(pending, /Cancelled by the user/);
  t.mock.method(globalThis, "fetch", async () => Response.json({ code: "PROVIDER_ACCESS", error: "Access unavailable" }, { status: 503 }));
  await assert.rejects(streamInterpretation(body, new AbortController().signal, () => {}), { code: "PROVIDER_ACCESS", status: 503 });
});
