import assert from "node:assert/strict";
import test from "node:test";
import type { InterpretationEvent } from "@interprete/shared/contracts";
import { catchUpPace, interpretResponse } from "../src/lib/interpret";
import { SilenceTrimmer } from "../src/lib/pcm";
import { interpretSchema } from "../src/lib/validation";

process.env.INTERPRETER_OPENAI_API_KEY = "test-openai";
process.env.AI_GATEWAY_API_KEY = "test-gateway";
process.env.SESSION_SECRET = "test-secret-not-used-in-deployments";

async function events(response: Response) {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter((block) => block.startsWith("data:"))
    .map((block) => JSON.parse(block.slice(5)) as InterpretationEvent);
}
const request = (text: string, extra: Record<string, unknown> = {}) =>
  interpretSchema.parse({
    text,
    sourceLanguage: "fr",
    targetLanguage: "en",
    speaker: "b",
    voice: "george",
    isFinal: false,
    speak: false,
    ...extra,
  });

test("a held-back fragment ends right after the gate instead of finishing its translation", async () => {
  const original = globalThis.fetch;
  let translationAborted = false;
  try {
    globalThis.fetch = async (url, init) => {
      if (String(url).includes("ai-gateway"))
        return Response.json({ answers: { ready: { probability: 0.1 } } });
      // A translation that would stream for a long time if it were not cancelled.
      init?.signal?.addEventListener("abort", () => (translationAborted = true));
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"I would"}}]}\n\n'));
            init?.signal?.addEventListener("abort", () => controller.error(init.signal!.reason));
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    };
    const started = performance.now();
    const received = await events(
      interpretResponse(request("Je voudrais"), null, new AbortController().signal),
    );
    assert.ok(performance.now() - started < 2000);
    assert.equal(translationAborted, true);
    const gate = received.find((event) => event.type === "gate");
    assert.equal(gate?.type === "gate" && gate.decision, "wait");
    const done = received.at(-1);
    assert.equal(done?.type, "done");
    assert.equal(done?.type === "done" && done.text, "");
    assert.equal(done?.type === "done" && done.spoken, false);
  } finally {
    globalThis.fetch = original;
  }
});

test("Jev is not asked when punctuation, a final remainder or a dangling word decides", async () => {
  const original = globalThis.fetch;
  const asked: string[] = [];
  try {
    globalThis.fetch = async (url) => {
      asked.push(String(url));
      return new Response('data: {"choices":[{"delta":{"content":"Hello."}}]}\n\ndata: [DONE]\n\n', {
        headers: { "Content-Type": "text/event-stream" },
      });
    };
    const sentence = await events(interpretResponse(request("Bonjour à tous."), null, new AbortController().signal));
    const remainder = await events(interpretResponse(request("à tous", { isFinal: true }), null, new AbortController().signal));
    const dangling = await events(interpretResponse(request("Je voudrais un"), null, new AbortController().signal));
    assert.equal(asked.some((url) => url.includes("ai-gateway")), false);
    const decision = (list: InterpretationEvent[]) => {
      const gate = list.find((event) => event.type === "gate");
      return gate?.type === "gate" ? gate.decision : null;
    };
    assert.equal(decision(sentence), "ready");
    assert.equal(decision(remainder), "final");
    assert.equal(decision(dangling), "wait");
    // A dangling prefix is held back before any translation is requested.
    assert.equal(asked.length, 2);
    assert.deepEqual(dangling.map((event) => event.type), ["gate", "done"]);
  } finally {
    globalThis.fetch = original;
  }
});

const pcm = (...samples: number[]) => {
  const bytes = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => bytes.writeInt16LE(sample, index * 2));
  return bytes;
};
const silence = (count: number) => pcm(...Array<number>(count).fill(0));

test("synthesized fragments lose their padding but keep inner pauses and a short tail", () => {
  const trimmer = new SilenceTrimmer({ leadMs: 1, tailMs: 1, sampleRate: 24000 });
  // 1 ms is 24 samples at 24 kHz.
  assert.equal(trimmer.push(silence(200), 0).length, 0);
  const first = trimmer.push(Buffer.concat([silence(10), pcm(4000, -4000), silence(30)]), 0);
  // 24 samples of lead-in (14 held back plus 10 in this packet) then the speech.
  assert.equal(first.length, (24 + 2) * 2);
  assert.equal(first.readInt16LE(24 * 2), 4000);
  // The pause after the speech waits for more audio, then plays in full.
  const second = trimmer.push(pcm(3000), 0);
  assert.equal(second.length, (30 + 1) * 2);
  trimmer.push(silence(500), 0);
  assert.equal(trimmer.end().length, 24 * 2);
});

test("a pause the voice provider delivers late is not played again after the gap", () => {
  const trimmer = new SilenceTrimmer({ leadMs: 0, tailMs: 0 });
  // 100 ms of speech then 200 ms of quiet; the next words arrive 300 ms later. The
  // listener already heard that pause as a gap, so the words play at once.
  trimmer.push(Buffer.concat([pcm(...Array<number>(2400).fill(4000)), silence(4800)]), 0);
  assert.deepEqual([...trimmer.push(pcm(5000), 300)], [...pcm(5000)]);
  // Delivered quickly, a pause keeps the part that has not elapsed yet (150 of 200 ms).
  trimmer.push(Buffer.concat([pcm(...Array<number>(2400).fill(4000)), silence(4800)]), 1000);
  assert.equal(trimmer.push(pcm(5000), 1150).length, (3600 + 1) * 2);
  // A pause sent on its own after a delivery gap is measured from the end of playback too.
  trimmer.push(silence(4800), 1500);
  assert.deepEqual([...trimmer.push(pcm(5000), 1600)], [...pcm(5000)]);
});

test("a pause is kept whole while the speech before it is still playing", () => {
  const trimmer = new SilenceTrimmer({ leadMs: 0, tailMs: 0 });
  // 500 ms of speech then 200 ms of quiet, and the next words 100 ms later: the listener
  // is still hearing the first words, so the pause has not started yet.
  trimmer.push(Buffer.concat([pcm(...Array<number>(12000).fill(4000)), silence(4800)]), 0);
  assert.equal(trimmer.push(pcm(5000), 100).length, (4800 + 1) * 2);
  // Translated speech already queued on the listener's side delays the pause just as much.
  const queued = new SilenceTrimmer({ leadMs: 0, tailMs: 0, playhead: 1000 });
  queued.push(Buffer.concat([pcm(...Array<number>(2400).fill(4000)), silence(4800)]), 0);
  assert.equal(queued.push(pcm(5000), 300).length, (4800 + 1) * 2);
});

test("the rest of a late pause arriving with the next words is not played either", () => {
  const trimmer = new SilenceTrimmer({ leadMs: 0, tailMs: 0 });
  // 100 ms of speech and 100 ms of quiet, then 300 ms later another 200 ms of quiet with
  // the next words: the 300 ms gap already was the whole pause.
  trimmer.push(Buffer.concat([pcm(...Array<number>(2400).fill(4000)), silence(2400)]), 0);
  assert.deepEqual([...trimmer.push(Buffer.concat([silence(4800), pcm(5000)]), 400)], [...pcm(5000)]);
});

test("translated speech queued behind the speaker is voiced faster, within the voice's range", () => {
  assert.deepEqual([0, 0.5, 1.5, 2.5, 5].map(catchUpPace), [1, 1, 1.1, 1.2, 1.2]);
});

test("odd provider packet boundaries keep samples aligned", () => {
  const trimmer = new SilenceTrimmer({ leadMs: 0, tailMs: 0 });
  const speech = pcm(5000, 6000, 7000);
  const out = Buffer.concat([trimmer.push(speech.subarray(0, 3), 0), trimmer.push(speech.subarray(3), 0)]);
  assert.deepEqual([...out], [...speech]);
});
