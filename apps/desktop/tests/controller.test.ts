import assert from "node:assert/strict";
import test from "node:test";
import { InterpreterController } from "../src/lib/interpreter";
import { MicrophoneCapture } from "../src/lib/audio";

test("two rapid start commands keep only the latest speaker during session bootstrap", async () => {
  const original = globalThis.fetch;
  let resolveStatus!: (value: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    resolveStatus = resolve;
  });
  const languages: string[] = [];
  globalThis.fetch = async (url, init) => {
    if (String(url) === "/api/status") return pending;
    if (String(url) === "/api/session") {
      languages.push(JSON.parse(String(init?.body)).language);
      throw new Error(
        "End test before opening a microphone or provider connection",
      );
    }
    throw new Error("Unexpected request");
  };
  const controller = new InterpreterController();
  Object.assign(controller, {
    player: { unlock: async () => {}, stop: () => {}, dispose: () => {} },
  });
  try {
    const a = controller.start("a");
    const b = controller.start("b");
    resolveStatus(
      Response.json({
        services: { transcription: true, voice: true, decision: true },
      }),
    );
    await Promise.all([a, b]);
    assert.deepEqual(languages, ["en"]);
    assert.equal(controller.getSnapshot().phase, "idle");
  } finally {
    controller.dispose();
    globalThis.fetch = original;
  }
});

test("cancel during bootstrap prevents a delayed microphone/session start", async () => {
  const original = globalThis.fetch;
  let resolveStatus!: (value: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    resolveStatus = resolve;
  });
  let sessionCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url) === "/api/status") return pending;
    sessionCalls++;
    throw new Error("Unexpected session request");
  };
  const controller = new InterpreterController();
  Object.assign(controller, {
    player: { unlock: async () => {}, stop: () => {}, dispose: () => {} },
  });
  try {
    const start = controller.start("a");
    controller.cancel();
    resolveStatus(
      Response.json({
        services: { transcription: true, voice: true, decision: true },
      }),
    );
    await start;
    assert.equal(sessionCalls, 0);
    assert.equal(controller.getSnapshot().phase, "idle");
  } finally {
    controller.dispose();
    globalThis.fetch = original;
  }
});

test("playback waits for the previous microphone to finish closing", async () => {
  const controller = new InterpreterController();
  let closeCapture!: (value: null) => void;
  let plays = 0;
  const pending = new Promise<null>((resolve) => {
    closeCapture = resolve;
  });
  const original = controller.getSnapshot();
  Object.assign(controller, {
    state: {
      ...original,
      turns: [
        {
          id: "last",
          speaker: "a",
          audioUrl: "blob:test",
          status: "done",
          source: "Bonjour",
          translation: "Hello",
          sourceLanguage: "fr",
          targetLanguage: "en",
          metrics: {},
        },
      ],
    },
    runtime: {
      id: "active",
      text: "",
      abort: new AbortController(),
      capture: { stop: () => pending },
      socket: null,
      prepAbort: null,
      prepTimer: null,
      finalResolve: null,
      blocks: [{ id: "active" }],
    },
    player: {
      stop: () => {},
      dispose: () => {},
      play: async () => {
        plays++;
      },
    },
  });
  const replay = controller.replay("last");
  await Promise.resolve();
  assert.equal(plays, 0);
  closeCapture(null);
  await replay;
  assert.equal(plays, 1);
  controller.dispose();
});

test("a silent recording contributes zero seconds toward voice cloning", async () => {
  const capture = new MicrophoneCapture({
    onAudio: () => {},
    onLevel: () => {},
    onEnded: () => {},
    onError: () => {},
    recordSample: true,
  });
  Object.assign(capture, {
    sampleChunks: [new Uint8Array(960)],
  });
  const sample = await capture.stop();
  assert.equal(sample?.seconds, 0);
});
