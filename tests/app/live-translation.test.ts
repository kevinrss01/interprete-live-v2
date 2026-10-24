import assert from "node:assert/strict";
import test from "node:test";
import { InterpreterController } from "../../src/lib/client/interpreter";
import {
  nextSegment,
  appendTranslation,
  reconcileConsumed,
  usablePrefix,
} from "../../src/lib/live-segments";
import type { CaptureOptions } from "../../src/lib/client/audio";

const waitFor = async (predicate: () => boolean) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 2000) throw new Error("Timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

function harness(
  reject?: (text: string) => boolean,
  session?: Promise<Response>,
  autoSession = true,
) {
  const originalFetch = globalThis.fetch,
    originalSocket = globalThis.WebSocket;
  const requests: Array<{
    text: string;
    followingText: string;
    isFinal: boolean;
  }> = [];
  let socket: Socket;
  class Socket {
    static OPEN = 1;
    readyState = 1;
    bufferedAmount = 0;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    sentAudio = 0;
    transcript = "";
    item = 0;
    constructor() {
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- expose this fake peer to the test driver
      socket = this;
      if (autoSession)
        queueMicrotask(() => this.emit({ type: "session.created" }));
    }
    emit(event: unknown) {
      this.onmessage?.({ data: JSON.stringify(event) });
    }
    delta(text: string) {
      if (!this.sentAudio) captureOptions.onAudio(new Uint8Array(4800));
      this.transcript += text;
      this.emit({
        type: "conversation.item.input_audio_transcription.delta",
        item_id: `item-${this.item}`,
        delta: text,
      });
    }
    send(value: string) {
      this.bufferedAmount += value.length;
      const event = JSON.parse(value);
      if (event.type === "input_audio_buffer.append") this.sentAudio++;
      if (event.type === "input_audio_buffer.commit") {
        const itemId = `item-${this.item++}`;
        const transcript = this.transcript;
        this.transcript = "";
        queueMicrotask(() => {
          this.emit({ type: "input_audio_buffer.committed", item_id: itemId });
          this.emit({
            type: "conversation.item.input_audio_transcription.completed",
            item_id: itemId,
            transcript,
          });
        });
      }
    }
    close() {
      this.readyState = 3;
      this.onclose?.();
    }
  }
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  globalThis.fetch = async (url, init) => {
    if (String(url) === "/api/status")
      return Response.json({
        services: { transcription: true, voice: true, decision: true },
      });
    if (String(url) === "/api/session")
      return session ?? Response.json({ token: "fake-ephemeral" });
    if (String(url) !== "/api/interpret") throw new Error("Unexpected URL");
    const input = JSON.parse(String(init?.body));
    requests.push(input);
    const spoken = input.isFinal || !reject?.(input.text);
    const events = [
      {
        type: "gate",
        decision: spoken ? "ready" : "wait",
        probability: spoken ? 0.99 : 0.1,
        elapsedMs: 1,
      },
      { type: "text", delta: "translation " + input.text },
      ...(spoken
        ? [{ type: "audio", audio: "ABQAFA==", sampleRate: 24000 }]
        : []),
      { type: "done", spoken, text: "translation " + input.text, metrics: {} },
    ];
    return new Response(
      events.map((e) => "data: " + JSON.stringify(e) + "\n\n").join(""),
      { headers: { "Content-Type": "text/event-stream" } },
    );
  };
  let captureOptions: CaptureOptions;
  const capture = {
    started: false,
    stopped: false,
    outputActive: false,
    async start() {
      this.started = true;
    },
    async stop() {
      this.stopped = true;
      return null;
    },
    setOutputActive(active: boolean) {
      this.outputActive = active;
    },
  };
  let activity: (active: boolean) => void = () => {};
  const player = {
    chunks: 0,
    async unlock() {},
    enqueue() {
      this.chunks++;
      activity(true);
      return performance.now();
    },
    async idle() {
      activity(false);
    },
    stop() {
      activity(false);
    },
    async play() {},
    dispose() {},
    setActivityListener(fn: (active: boolean) => void) {
      activity = fn;
    },
  };
  const controller = new InterpreterController({
    player,
    capture: (options) => {
      captureOptions = options;
      return capture;
    },
  });
  return {
    controller,
    requests,
    capture,
    player,
    get socket() {
      return socket!;
    },
    get options() {
      return captureOptions!;
    },
    cleanup() {
      controller.dispose();
      globalThis.fetch = originalFetch;
      globalThis.WebSocket = originalSocket;
    },
  };
}

test("translation audio is delivered while capture is still running, and finalization never repeats it", async () => {
  const h = harness();
  try {
    await h.controller.start("a");
    h.socket.delta("Bonjour, ");
    await waitFor(() => h.player.chunks === 1);
    assert.equal(h.capture.stopped, false);
    assert.equal(h.controller.getSnapshot().phase, "listening");
    assert.equal(h.controller.getSnapshot().outputActive, true);
    assert.equal(
      h.capture.outputActive,
      true,
      "only the cloning sample is paused during playback",
    );
    h.socket.delta("je voudrais un café.");
    await h.controller.stop();
    assert.deepEqual(
      h.requests.map((x) => x.text),
      ["Bonjour,", "je voudrais un café."],
    );
    assert.equal(h.player.chunks, 2);
    assert.equal(h.controller.getSnapshot().turns[0].status, "done");
    assert.equal(
      h.controller.getSnapshot().turns[0].translation,
      "translation Bonjour, translation je voudrais un café.",
    );
  } finally {
    h.cleanup();
  }
});

test("closing during startup also settles a simultaneous stop and releases capture", async () => {
  const h = harness(undefined, undefined, false);
  try {
    const start = h.controller.start("a");
    await waitFor(() => Boolean(h.socket));
    const stop = h.controller.stop();
    h.socket.close();
    await Promise.all([start, stop]);
    assert.equal(h.capture.stopped, true);
    assert.equal(h.controller.getSnapshot().phase, "idle");
  } finally {
    h.cleanup();
  }
});

test("a pause commits only its ASR item, then translation continues on the same microphone", async () => {
  const h = harness();
  try {
    await h.controller.start("a");
    h.socket.delta("Bonjour, ");
    await waitFor(() => h.player.chunks === 1);
    h.options.onBoundary?.();
    await waitFor(() => h.controller.getSnapshot().turns[0].status === "done");
    assert.equal(h.capture.stopped, false);
    h.options.onAudio(new Uint8Array(4800));
    h.socket.delta("je continue de parler.");
    await waitFor(() => h.player.chunks === 2);
    assert.equal(h.controller.getSnapshot().phase, "listening");
    assert.equal(h.capture.stopped, false);
    await h.controller.stop();
    assert.deepEqual(h.requests.map((request) => request.text), ["Bonjour,", "je continue de parler."]);
    assert.equal(h.controller.getSnapshot().turns.length, 2);
    assert.ok(h.controller.getSnapshot().turns.every((turn) => turn.status === "done"));
  } finally {
    h.cleanup();
  }
});

test("startup PCM queue allows its encoded WebSocket overhead when flushed", async () => {
  let release!: (r: Response) => void;
  const pending = new Promise<Response>((r) => {
    release = r;
  });
  const h = harness(undefined, pending);
  try {
    const start = h.controller.start("a");
    await waitFor(() => h.capture.started);
    for (let i = 0; i < 20; i++) h.options.onAudio(new Uint8Array(20000));
    release(Response.json({ token: "fake-ephemeral" }));
    await start;
    assert.equal(h.socket.sentAudio, 20);
    assert.equal(h.capture.stopped, false);
    assert.equal(h.controller.getSnapshot().phase, "listening");
  } finally {
    h.cleanup();
  }
});

test("rejected prefixes grow with new speech instead of being spoken or blocking forever", async () => {
  const h = harness((text) => text === "Je voudrais");
  try {
    await h.controller.start("a");
    h.socket.delta("Je voudrais réserver");
    await waitFor(() => h.requests.length === 1);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(h.requests[0].followingText, "réserver");
    assert.equal(h.player.chunks, 0);
    h.socket.delta(" une table.");
    await waitFor(() => h.player.chunks === 1);
    assert.equal(h.capture.stopped, false);
    assert.equal(h.requests[1].text, "Je voudrais réserver une table.");
    await h.controller.stop();
    assert.equal(h.requests.length, 2);
  } finally {
    h.cleanup();
  }
});

test("microphone setup runs before session credentials return and retains initial audio", async () => {
  let release!: (r: Response) => void;
  const pending = new Promise<Response>((r) => {
    release = r;
  });
  const h = harness(undefined, pending);
  try {
    const start = h.controller.start("a");
    await waitFor(() => h.capture.started);
    h.options.onAudio(new Uint8Array(480));
    release(Response.json({ token: "fake-ephemeral" }));
    await start;
    assert.equal(h.socket.sentAudio, 1);
  } finally {
    h.cleanup();
  }
});

test("replaying twenty seconds of buffered PCM does not trigger a reconnect loop", async () => {
  let release!: (value: Response) => void;
  const pending = new Promise<Response>((resolve) => { release = resolve; });
  const h = harness(undefined, pending);
  try {
    const start = h.controller.start("a");
    await waitFor(() => h.capture.started);
    for (let frame = 0; frame < 100; frame++) h.options.onAudio(new Uint8Array(9600));
    release(Response.json({ token: "fake-ephemeral" }));
    await start;
    assert.equal(h.socket.sentAudio, 100);
    assert.ok(h.socket.bufferedAmount > 1_048_576);
    assert.equal(h.controller.getSnapshot().connection, "connected");
    assert.equal(h.capture.stopped, false);
  } finally {
    h.cleanup();
  }
});

test("segment cursors survive final punctuation changes and cover languages without spaces", () => {
  assert.equal(
    nextSegment("Bonjour, le monde", 0, false, "fr")?.text,
    "Bonjour,",
  );
  assert.equal(
    nextSegment("Bonjour ! Le monde.", 1, true, "fr")?.text,
    "Le monde.",
  );
  assert.equal(
    nextSegment("Bonjour", 0, false, "fr"),
    null,
    "partial words wait for context",
  );
  assert.equal(
    nextSegment("こんにちは。元気ですか？", 0, false, "ja")?.text,
    "こんにちは。",
  );
  assert.equal(appendTranslation("你好。", "你好吗？", "zh"), "你好。你好吗？");
});

test("final ASR changes to the spoken prefix do not drop or replay its remaining words", () => {
  const consumed = reconcileConsumed(
    "Je voudrais réserver une table",
    "J’aimerais réserver une table pour demain.",
    "fr",
  );
  assert.equal(
    nextSegment(
      "J’aimerais réserver une table pour demain.",
      consumed,
      true,
      "fr",
    )?.text,
    "pour demain.",
  );
  assert.equal(reconcileConsumed("Bonjour,", "Bonjour ! Le monde.", "fr"), 1);
});

test("early output still waits for dangling prepositions, known negation and unfinished amounts", () => {
  assert.equal(usablePrefix("Ceci est", "un échantillon", "fr"), true);
  assert.equal(usablePrefix("un échantillon de", "voix", "fr"), false);
  assert.equal(usablePrefix("Je veux", "pas annuler", "fr"), false);
  assert.equal(usablePrefix("I want", "not now", "en"), false);
  assert.equal(usablePrefix("Le prix est cent", "vingt euros", "fr"), false);
  assert.equal(usablePrefix("Bonjour.", "pas de problème", "fr"), true);
});
