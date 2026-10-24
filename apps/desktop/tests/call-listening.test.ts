import assert from "node:assert/strict";
import test from "node:test";
import type { Turn, VoiceFeatures } from "@interprete/shared/contracts";
import {
  CaptionsPublisher,
  captionLines,
  captionTail,
  emptyCaptionText,
  nextCaptionText,
  previewFrames,
  type CaptionsUpdate,
} from "../src/lib/call-captions";
import { CallListening } from "../src/lib/call-listening";
import type { CaptureOptions } from "../src/lib/audio";
import type { SpeechChoice } from "../src/lib/interpreter";
import { loadCallOptions, saveCallOptions } from "../src/lib/calls";
import {
  SystemAudioCapture,
  VoiceProfiler,
  estimatePitch,
} from "../src/lib/system-audio";

const store = new Map<string, string>();
globalThis.localStorage ??= {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;

// 20 ms PCM frames of a voiced, harmonic signal at the given pitch.
function voiced(pitch: number, frames: number, amplitude = 0.3) {
  const out: Uint8Array[] = [];
  for (let frame = 0; frame < frames; frame++) {
    const bytes = new Uint8Array(960);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < 480; i++) {
      const t = (frame * 480 + i) / 24000;
      const value =
        amplitude *
        (0.6 * Math.sin(2 * Math.PI * pitch * t) +
          0.3 * Math.sin(4 * Math.PI * pitch * t) +
          0.1 * Math.sin(6 * Math.PI * pitch * t));
      view.setInt16(i * 2, Math.round(value * 32767), true);
    }
    out.push(bytes);
  }
  return out;
}
const turn = (id: string, translation: string, status: Turn["status"]): Turn => ({
  id,
  speaker: "b",
  sourceLanguage: "en",
  targetLanguage: "fr",
  source: "",
  translation,
  status,
  metrics: {},
});

test("captions show the two latest translated passages and animate only appended text", () => {
  const lines = captionLines([
    turn("1", "Première phrase.", "done"),
    turn("2", "", "draft"),
    turn("3", "Deuxième phrase.", "done"),
    turn("4", "Troisième, en cours", "working"),
  ]);
  assert.deepEqual(lines, [
    { id: "3", text: "Deuxième phrase.", live: false },
    { id: "4", text: "Troisième, en cours", live: true },
  ]);
  let text = nextCaptionText(emptyCaptionText, "Bonjour");
  text = nextCaptionText(text, "Bonjour à tous");
  assert.deepEqual(text.fresh.map((part) => part.text), ["Bonjour", " à tous"]);
  const keys = text.fresh.map((part) => part.key);
  assert.equal(nextCaptionText(text, "Bonjour à tous"), text, "an unchanged caption keeps its spans");
  for (let i = 0; i < 10; i++) text = nextCaptionText(text, text.settled + text.fresh.map((p) => p.text).join("") + ` ${i}`);
  assert.equal(text.fresh.length, 8, "older fragments settle into one static span");
  assert.ok(text.settled.startsWith("Bonjour à tous"));
  assert.ok(!text.fresh.some((part) => keys.includes(part.key)));
  const revised = nextCaptionText(text, "Bonsoir");
  assert.equal(revised.version, text.version + 1);
  assert.deepEqual(revised.fresh.map((part) => part.text), ["Bonsoir"]);
  assert.equal(revised.settled, "");
  const long = captionTail("mot ".repeat(600));
  assert.ok(long.startsWith("…mot") && long.length <= 1501);
  const frames = previewFrames("fr");
  assert.equal(frames[0][0].text, "Bonjour");
  assert.equal(frames.at(-1)!.length, 2);
  assert.ok(frames.at(-1)!.every((line) => !line.live));
});

test("caption updates collapse to the newest state while the native window is busy", async () => {
  const sent: CaptionsUpdate[] = [];
  let release!: () => void;
  const publisher = new CaptionsPublisher(
    () => {},
    async <T>(_name: string, args: Record<string, unknown>) => {
      sent.push(args.update as CaptionsUpdate);
      if (sent.length === 1) await new Promise<void>((resolve) => (release = resolve));
      return undefined as T;
    },
  );
  const update = (text: string): CaptionsUpdate => ({
    sessionId: "s",
    status: "listening",
    source: "en",
    target: "fr",
    lines: [{ id: "1", text, live: true }],
  });
  publisher.publish(update("Bon"));
  publisher.publish(update("Bonjour"));
  publisher.publish(update("Bonjour à"));
  publisher.publish(update("Bonjour à tous"));
  release();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(
    sent.map((item) => item.lines[0].text),
    ["Bon", "Bonjour à tous"],
  );
  publisher.publish(null);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(sent.at(-1)!.status, "idle");
});

test("the call's audio frames feed transcription, pauses and stalls like a microphone", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const channel = { onmessage: (_message: unknown) => {} };
  const audio: number[] = [];
  const errors: string[] = [];
  let boundaries = 0;
  let scope = "";
  const capture = new SystemAudioCapture(
    {
      onAudio: (bytes) => audio.push(bytes.length),
      onLevel: () => {},
      onBoundary: () => boundaries++,
      onEnded: () => {},
      onError: (message) => errors.push(message),
      recordSample: false,
      source: "Zoom",
      onStarted: (started) => (scope = started.scope),
    },
    async <T>(name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return (name === "system_audio_start" ? { scope: "app", processes: 1 } : undefined) as T;
    },
    () => channel,
  );
  await capture.start();
  assert.equal(scope, "app");
  assert.equal(calls[0].args.source, "Zoom");
  assert.equal(calls[0].args.onAudio, channel);
  const [speech] = voiced(140, 1);
  channel.onmessage(speech.buffer);
  const silence = new Uint8Array(960).buffer;
  const started = performance.now();
  while (performance.now() - started < 470) await new Promise((resolve) => setTimeout(resolve, 20));
  channel.onmessage(silence);
  assert.equal(boundaries, 1);
  channel.onmessage(silence);
  assert.equal(boundaries, 1, "one boundary per pause");
  channel.onmessage({ type: "stalled" });
  assert.match(errors[0], /stopped arriving/);
  assert.deepEqual(audio, [960, 960, 960]);
  await capture.stop();
  channel.onmessage(speech.buffer);
  assert.equal(audio.length, 3, "frames after stop are ignored");
  assert.deepEqual(calls.at(-1), {
    name: "system_audio_stop",
    args: { id: calls[0].args.id },
  });
});

test("a capture stopped while the tap is starting releases that tap", async () => {
  let finish!: (value: unknown) => void;
  const calls: string[] = [];
  const capture = new SystemAudioCapture(
    {
      onAudio: () => {},
      onLevel: () => {},
      onEnded: () => {},
      onError: () => {},
      recordSample: false,
      source: null,
    },
    async <T>(name: string) => {
      calls.push(name);
      if (name === "system_audio_start")
        return (await new Promise<unknown>((resolve) => (finish = resolve))) as T;
      return undefined as T;
    },
    () => ({ onmessage: () => {} }),
  );
  const starting = capture.start();
  await capture.stop();
  finish({ scope: "system", processes: 0 });
  await starting;
  assert.deepEqual(calls, ["system_audio_start", "system_audio_stop", "system_audio_stop"]);
});

test("voice measurements track pitch and ignore silence", () => {
  for (const pitch of [100, 120, 180, 230]) {
    const profiler = new VoiceProfiler();
    for (const frame of voiced(pitch, 60)) profiler.push(frame);
    const features = profiler.features();
    assert.ok(features, `${pitch} Hz is voiced`);
    assert.ok(Math.abs(features.medianPitchHz - pitch) <= pitch * 0.04, `${pitch} → ${features.medianPitchHz}`);
    assert.ok(features.pitchRangeSemitones < 1);
    assert.ok(features.brightness > 0 && features.brightness <= 1);
  }
  const quiet = new VoiceProfiler();
  for (const frame of voiced(120, 60, 0.005)) quiet.push(frame);
  assert.equal(quiet.features(0.25), null);
  assert.equal(estimatePitch(new Float32Array(480)), null);
});

test("toast choices default to captions and are remembered between calls", () => {
  store.clear();
  assert.deepEqual(loadCallOptions(), { captions: true, voice: false, microphone: false });
  store.set("interprete-call-input-label", "MacBook Pro Microphone");
  assert.equal(loadCallOptions().microphone, true, "a configured microphone route stays on");
  saveCallOptions({ captions: false, voice: true, microphone: false });
  assert.deepEqual(loadCallOptions(), { captions: false, voice: true, microphone: false });
  store.set("interprete-call-options-v1", "{broken");
  assert.equal(loadCallOptions().captions, true);
});

function fakeListening({
  match,
  voiceWaitMs = 400,
}: {
  match: (features: VoiceFeatures, language: string) => Promise<{ voice: string; name: string; source: "jev" | "pitch" }>;
  voiceWaitMs?: number;
}) {
  let speech!: () => Promise<SpeechChoice>;
  let capture!: (options: CaptureOptions) => unknown;
  let phase: "idle" | "listening" = "idle";
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((fn) => fn());
  const captured: Record<string, unknown>[] = [];
  const listening = new CallListening({
    native: true,
    voiceWaitMs,
    matchVoice: match,
    systemCapture: (options) => {
      captured.push(options as unknown as Record<string, unknown>);
      return { start: async () => {}, stop: async () => null, setOutputActive: () => {} };
    },
    controller: (adapters) => {
      speech = adapters.speech as () => Promise<SpeechChoice>;
      capture = adapters.capture;
      return {
        subscribe: (fn: () => void) => {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
        getSnapshot: () => ({ phase, error: null }),
        init: async () => {},
        clearConversation: () => {},
        setProfile: () => {},
        start: async () => {
          phase = "listening";
          notify();
        },
        cancel: () => {
          phase = "idle";
          notify();
        },
        dispose: () => {},
        dismissError: () => {},
      } as never;
    },
  });
  const options: CaptureOptions = {
    onAudio: () => {},
    onLevel: () => {},
    onEnded: () => {},
    onError: () => {},
    recordSample: true,
  };
  return {
    listening,
    captured,
    speech: () => speech(),
    feed: (frames: Uint8Array[]) => {
      const created = capture(options) as unknown;
      void created;
      const settings = captured.at(-1)!;
      for (const frame of frames) (settings.onAudio as (bytes: Uint8Array) => void)(frame);
    },
  };
}
const profiles = {
  a: { id: "a", name: "You", language: "fr", voice: "sarah", consent: false, cloneStatus: "off", sampleSeconds: 0 },
  b: { id: "b", name: "Eux", language: "en", voice: "george", consent: true, cloneStatus: "ready", sampleSeconds: 0 },
} as const;

test("captions-only sessions never synthesize, and their audio is never a cloning sample", async () => {
  const h = fakeListening({ match: async () => assert.fail("no voice is matched for captions") });
  await h.listening.start({ profiles, options: { captions: true, voice: false }, app: "Zoom", callId: "call-1" });
  assert.deepEqual(await h.speech(), { speak: false });
  h.feed(voiced(120, 5));
  assert.equal(h.captured[0].recordSample, false);
  assert.equal(h.captured[0].source, "Zoom");
  assert.equal(h.listening.getSnapshot().callId, "call-1");
  h.listening.stop();
  assert.equal(h.listening.getSnapshot().sessionId, null);
});

test("Jev's voice is requested early from on-device measurements and kept for the session", async () => {
  const requests: { features: VoiceFeatures; language: string }[] = [];
  const h = fakeListening({
    match: async (features, language) => {
      requests.push({ features, language });
      return { voice: "chris", name: "Chris", source: "jev" };
    },
  });
  await h.listening.start({ profiles, options: { captions: true, voice: true } });
  h.feed(voiced(118, 60));
  assert.equal(requests.length, 1, "matched as soon as one second of speech was measured");
  assert.equal(requests[0].language, "fr");
  assert.ok(Math.abs(requests[0].features.medianPitchHz - 118) < 6);
  assert.deepEqual(await h.speech(), { speak: true, voice: "chris" });
  assert.deepEqual(await h.speech(), { speak: true, voice: "chris" });
  assert.deepEqual(h.listening.getSnapshot().voice, { voice: "chris", name: "Chris", source: "jev" });
  assert.equal(requests.length, 1);
});

test("a slow Jev answer falls back to the nearest pitch band without holding speech", async () => {
  const h = fakeListening({
    match: () => new Promise(() => {}),
    voiceWaitMs: 300,
  });
  await h.listening.start({ profiles, options: { captions: false, voice: true } });
  h.feed(voiced(232, 60));
  const started = performance.now();
  assert.deepEqual(await h.speech(), { speak: true, voice: "jessica" });
  assert.ok(performance.now() - started < 600);
  assert.equal(h.listening.getSnapshot().voice?.source, "pitch");
});

test("without any voiced audio yet, speech starts with the neutral default voice", async () => {
  const h = fakeListening({ match: async () => assert.fail("nothing to match"), voiceWaitMs: 200 });
  await h.listening.start({ profiles, options: { captions: false, voice: true } });
  assert.deepEqual(await h.speech(), { speak: true, voice: "river" });
  assert.equal(h.listening.getSnapshot().voice?.source, "default");
});

const services = { services: { transcription: true, voice: true, decision: true }, session: "test-session" };
const idleCapture = () => ({ start: async () => {}, stop: async () => null, setOutputActive: () => {} });

test("stopping while the real controller is still preparing output cancels its pending capture", { timeout: 5000 }, async () => {
  const original = globalThis.fetch;
  let release!: () => void;
  let unlocking = false;
  let captures = 0;
  globalThis.fetch = async (url) => {
    if (String(url) === "/api/status") return Response.json(services);
    throw new Error("No session is requested after stop");
  };
  const listening = new CallListening({
    native: true,
    systemCapture: () => {
      captures++;
      return idleCapture();
    },
  });
  Object.assign(listening.controller, {
    player: {
      unlock: () => {
        unlocking = true;
        return new Promise<void>((resolve) => (release = resolve));
      },
      stop: () => {},
      dispose: () => {},
      setActivityListener: () => {},
    },
  });
  try {
    const starting = listening.start({ profiles, options: { captions: true, voice: false } });
    while (!unlocking) await new Promise((resolve) => setTimeout(resolve, 1));
    listening.stop();
    release();
    await starting;
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(captures, 0);
    assert.equal(listening.controller.getSnapshot().phase, "idle");
    assert.equal(listening.getSnapshot().sessionId, null);
    assert.equal(listening.getSnapshot().ended, "stopped");
  } finally {
    listening.dispose();
    globalThis.fetch = original;
  }
});

test("a capture failure ends the session with its error instead of a silent finish", { timeout: 5000 }, async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url) === "/api/status") return Response.json(services);
    // Credentials never arrive: the capture failure must still end the session.
    return new Promise<Response>(() => {});
  };
  const listening = new CallListening({
    native: true,
    systemCapture: () => ({
      start: async () => {
        throw new Error("Capture denied by macOS.");
      },
      stop: async () => null,
      setOutputActive: () => {},
    }),
  });
  Object.assign(listening.controller, {
    player: { unlock: async () => {}, stop: () => {}, dispose: () => {}, setActivityListener: () => {} },
  });
  try {
    await listening.start({ profiles, options: { captions: true, voice: false }, app: "Zoom" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const state = listening.getSnapshot();
    assert.equal(state.sessionId, null);
    assert.equal(state.ended, "failed");
    assert.match(state.error ?? "", /Capture denied/);
  } finally {
    listening.dispose();
    globalThis.fetch = original;
  }
});
