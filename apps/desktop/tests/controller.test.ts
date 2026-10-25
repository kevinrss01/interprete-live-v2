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

test("a long sample keeps collecting past 30 s without cloning, within the upload cap", async () => {
  const original = globalThis.fetch;
  let clones = 0;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/api/voice/clone")) clones++;
    throw new Error("No network in tests");
  };
  const controller = new InterpreterController();
  try {
    await controller.setConsent("a", true);
    const chunk = new Blob([new Uint8Array(700_000)]);
    for (let i = 0; i < 5; i++) await controller.collect("a", chunk, 12, { autoClone: false });
    assert.equal(clones, 0);
    // Four chunks fit the 3.2 MB cap; the fifth is dropped.
    assert.equal(controller.getSnapshot().profiles.a.sampleSeconds, 48);
  } finally {
    controller.dispose();
    globalThis.fetch = original;
  }
});

test("the account voice wins, then the local clone is saved, else the standard voice stays", async () => {
  const original = { fetch: globalThis.fetch, localStorage: globalThis.localStorage, location: globalThis.location };
  const store = new Map([["interprete-auth-token", "auth"], ["interprete-session", "device"]]);
  Object.assign(globalThis, {
    location: { origin: "http://localhost" },
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
  });
  let account: string | null = "account-grant";
  const saved: string[] = [];
  globalThis.fetch = async (input) => {
    const request = input instanceof Request ? input : new Request(String(input));
    const body = await request.clone().json().catch(() => ({}));
    if (request.url.endsWith("/rpc/voice/get"))
      return Response.json({ json: account ? { voice: account } : null });
    if (request.url.endsWith("/rpc/voice/save")) {
      saved.push(body.json.voice);
      return Response.json({ json: { saved: true } });
    }
    throw new Error("Unexpected request " + request.url);
  };
  const controller = new InterpreterController();
  try {
    controller.setProfile("a", { cloneVoice: "local-grant", voice: "local-grant", cloneStatus: "ready", consent: true });
    await controller.syncAccountVoice();
    assert.equal(controller.getSnapshot().profiles.a.cloneVoice, "account-grant");
    assert.deepEqual(saved, []);

    account = null;
    controller.setProfile("a", { cloneVoice: "local-grant", voice: "local-grant", cloneStatus: "ready" });
    await controller.syncAccountVoice();
    assert.equal(controller.getSnapshot().profiles.a.cloneVoice, "local-grant");
    assert.deepEqual(saved, ["local-grant"]);

    controller.forgetAccountVoice();
    await controller.syncAccountVoice();
    assert.equal(controller.getSnapshot().profiles.a.cloneStatus, "off");
    assert.equal(controller.getSnapshot().profiles.a.voice, "sarah");
  } finally {
    controller.dispose();
    Object.assign(globalThis, original);
  }
});
