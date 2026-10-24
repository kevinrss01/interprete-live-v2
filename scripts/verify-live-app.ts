// Silent end-to-end check: PCM input and returned audio bytes, no speakers or microphone.
import fs from "node:fs/promises";
import WebSocket from "ws";
import { InterpreterController } from "../apps/desktop/src/lib/interpreter";
import type { CaptureOptions } from "../apps/desktop/src/lib/audio";

async function main() {
  const base = process.env.APP_TEST_URL || "http://localhost:3035";
  const fixture = process.argv[2];
  if (!fixture) throw new Error("Pass a synthetic 24kHz mono PCM WAV file.");
  const wav = await fs.readFile(fixture);
  let cursor = 12,
    pcm: Uint8Array | undefined;
  while (cursor + 8 <= wav.length) {
    const size = wav.readUInt32LE(cursor + 4);
    if (wav.toString("ascii", cursor, cursor + 4) === "data") {
      pcm = wav.subarray(cursor + 8, cursor + 8 + size);
      break;
    }
    cursor += 8 + size + (size % 2);
  }
  if (!pcm?.length || wav.readUInt32LE(24) !== 24000)
    throw new Error("Expected a nonempty 24kHz WAV.");
  if (process.env.APP_TEST_SECONDS)
    pcm = pcm.subarray(
      0,
      Math.floor((Number(process.env.APP_TEST_SECONDS) * 48000) / 2) * 2,
    );
  const originalFetch = globalThis.fetch;
  const originalSocket = globalThis.WebSocket;
  globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;
  let cookie = "";
  const requests: Array<{
    text: string;
    atMs: number;
    final: boolean;
    gate?: unknown;
  }> = [];
  const observations: Promise<void>[] = [];
  let began = 0,
    firstTranscriptMs: number | null = null,
    firstAudioMs: number | null = null;
  let sentBytes = 0,
    bytesReceived = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), base);
    const headers = new Headers(init?.headers);
    if (url.origin === new URL(base).origin) {
      headers.set("Origin", url.origin);
      if (cookie) headers.set("Cookie", cookie);
    }
    if (url.pathname === "/api/interpret") {
      const body = JSON.parse(String(init?.body));
      requests.push({
        text: body.text,
        atMs: Math.round(performance.now() - began),
        final: body.isFinal,
      });
    }
    const response = await originalFetch(url, { ...init, headers });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie && url.origin === new URL(base).origin)
      cookie = setCookie.split(";")[0];
    if (url.pathname === "/api/interpret") {
      const record = requests.at(-1)!;
      observations.push(
        response
          .clone()
          .text()
          .then((text) => {
            const block = text
              .split("\n\n")
              .find(
                (block) =>
                  block.startsWith("data:") && block.includes('"gate"'),
              );
            if (block) record.gate = JSON.parse(block.slice(5));
          })
          .catch(() => {}),
      );
    }
    return response;
  };

  let inputEndAt: number | null = null;
  class Input {
    stopped = false;
    constructor(private options: CaptureOptions) {}
    async start() {
      void this.feed();
    }
    async feed() {
      for (let at = 0; at < pcm!.length && !this.stopped; at += 960) {
        const chunk = pcm!.subarray(at, at + 960);
        sentBytes += chunk.length;
        this.options.onAudio(chunk);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      inputEndAt = performance.now();
      if (!this.stopped) this.options.onEnded();
    }
    async stop() {
      this.stopped = true;
      return null;
    }
    setOutputActive() {
      /* The synthetic reference excludes output by construction. */
    }
  }
  class SilentPlayer {
    private listener: (active: boolean) => void = () => {};
    private pendingUntil = 0;
    private carry: Uint8Array | null = null;
    async unlock() {}
    enqueue(bytes: Uint8Array) {
      const now = performance.now();
      bytesReceived += bytes.length;
      if (this.carry) {
        const joined = new Uint8Array(bytes.length + 1);
        joined.set(this.carry);
        joined.set(bytes, 1);
        bytes = joined;
        this.carry = null;
      }
      if (bytes.length % 2) {
        this.carry = bytes.slice(-1);
        bytes = bytes.slice(0, -1);
      }
      const start = Math.max(now + 25, this.pendingUntil);
      let first: number | null = null;
      const samples = new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      );
      for (let at = 0; at < bytes.length; at += 2)
        if (Math.abs(samples.getInt16(at, true)) > 491) {
          first = start + at / 48;
          break;
        }
      if (firstAudioMs === null && first !== null) {
        firstAudioMs = Math.round(first - began);
        console.log(
          JSON.stringify({ firstAudioMs, inputStillOpen: inputEndAt === null }),
        );
      }
      this.pendingUntil = start + bytes.length / 48;
      this.listener(true);
      return first;
    }
    async idle(signal?: AbortSignal) {
      while (performance.now() < this.pendingUntil && !signal?.aborted)
        await new Promise((r) => setTimeout(r, 30));
      this.listener(false);
    }
    stop() {
      this.pendingUntil = 0;
      this.listener(false);
    }
    async play() {
      throw new Error("Playback disabled in this test");
    }
    dispose() {
      this.stop();
    }
    setActivityListener(fn: (active: boolean) => void) {
      this.listener = fn;
    }
  }

  const controller = new InterpreterController({
    timing: {
      ...(process.env.APP_TEST_RENEW_MS ? { renewMs: Number(process.env.APP_TEST_RENEW_MS) } : {}),
      ...(process.env.APP_TEST_CHECKPOINT_MS ? { checkpointMs: Number(process.env.APP_TEST_CHECKPOINT_MS) } : {}),
    },
    player: new SilentPlayer(),
    capture: (options) => new Input(options),
  });
  let unsub = () => {};
  try {
    await controller.init();
    began = performance.now();
    unsub = controller.subscribe(() => {
      if (
        firstTranscriptMs === null &&
        controller.getSnapshot().turns.at(-1)?.source
      )
        firstTranscriptMs = Math.round(performance.now() - began);
    });
    await controller.start(process.env.APP_TEST_SPEAKER === "b" ? "b" : "a");
    const deadline = performance.now() + pcm.length / 48 + 60000;
    while (
      controller.getSnapshot().phase !== "idle" &&
      performance.now() < deadline
    )
      await new Promise((r) => setTimeout(r, 100));
    const state = controller.getSnapshot(),
      turn = state.turns.at(-1);
    await Promise.allSettled(observations);
    const result = {
      sampleDurationMs: Math.round(pcm.length / 48),
      firstTranscriptMs,
      firstAudioMs,
      audioBeforeInputEnd:
        firstAudioMs !== null &&
        inputEndAt !== null &&
        began + firstAudioMs < inputEndAt,
      bytesSent: sentBytes,
      bytesReceived,
      segments: requests,
      source: state.turns.map((entry) => entry.source).join(" "),
      translation: state.turns.map((entry) => entry.translation).join(" "),
      error: state.error,
      audioPlayed: false,
    };
    await fs.mkdir("test-results", { recursive: true });
    await fs.writeFile(
      "test-results/continuous-local.json",
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result, null, 2));
    if (state.error) throw new Error(state.error);
    if (turn?.status !== "done") throw new Error("Turn did not finish");
    if (!result.audioBeforeInputEnd)
      throw new Error("Regression: audio arrived only after the input ended");
  } finally {
    unsub();
    controller.dispose();
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalSocket;
  }
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Verification failed");
  process.exitCode = 1;
});
