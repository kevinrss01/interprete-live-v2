import assert from "node:assert/strict";
import test from "node:test";
import { NativePcmPlayer } from "../src/lib/calls";
import { InterpreterController, type SpeechChoice } from "../src/lib/interpreter";
import {
  nextSegment,
  appendTranslation,
  prefixEnd,
  reconcileConsumed,
  usablePrefix,
} from "@interprete/shared/live-segments";
import type { CaptureOptions } from "../src/lib/audio";

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
  nativePlayer?: NativePcmPlayer,
  audio = "ABQAFA==",
  speech?: () => SpeechChoice | Promise<SpeechChoice>,
  translate: (text: string) => string = (text) => "translation " + text,
) {
  const originalFetch = globalThis.fetch,
    originalSocket = globalThis.WebSocket;
  const gate: Partial<Extract<import("@interprete/shared/contracts").InterpretationEvent, { type: "gate" }>> = {};
  const requests: Array<{
    text: string;
    followingText: string;
    isFinal: boolean;
    speak?: boolean;
    voice: string;
    queued?: number;
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
    const ready = input.isFinal || !reject?.(input.text);
    const spoken = ready && input.speak !== false;
    const events = [
      {
        type: "gate",
        decision: ready ? "ready" : "wait",
        probability: ready ? 0.99 : 0.1,
        elapsedMs: 1,
        unavailable: false,
        ...gate,
      },
      ...(translate(input.text) ? [{ type: "text", delta: translate(input.text) }] : []),
      ...(spoken
        ? [{ type: "audio", audio, sampleRate: 24000 }]
        : []),
      { type: "done", spoken, text: translate(input.text), metrics: {} },
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
    player: nativePlayer ?? player,
    capture: (options) => {
      captureOptions = options;
      return capture;
    },
    speech,
  });
  return {
    gate,
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
    assert.ok(h.controller.getSnapshot().sessionId, "the floating overlay follows this active session");
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
    assert.equal(h.controller.getSnapshot().sessionId, null, "the floating overlay hides after playback completes");
    assert.equal(
      h.controller.getSnapshot().turns[0].translation,
      "translation Bonjour, translation je voudrais un café.",
    );
  } finally {
    h.cleanup();
  }
});

test("microphone status follows the current capture after a demo, even when a silent turn is removed", async () => {
  const h = harness();
  try {
    await h.controller.start("a", true);
    assert.equal(h.controller.getSnapshot().input, "demo");
    h.socket.delta("Bonjour, je voudrais un café.");
    await h.controller.stop();
    assert.equal(h.controller.getSnapshot().input, null);
    assert.equal(h.controller.getSnapshot().turns.at(-1)?.demo, true);

    await h.controller.start("b");
    h.options.onAudio(new Uint8Array(4800));
    h.options.onBoundary?.();
    await waitFor(() => h.controller.getSnapshot().turns.at(-1)?.demo === true);
    assert.equal(h.controller.getSnapshot().phase, "listening");
    assert.equal(h.controller.getSnapshot().input, "microphone");

    const demoTurn = h.controller.getSnapshot().turns[0];
    assert.ok(demoTurn.audioUrl);
    let finishPlayback!: () => void;
    h.player.play = () => new Promise<void>((resolve) => { finishPlayback = resolve; });
    const replay = h.controller.replay(demoTurn.id);
    assert.equal(h.controller.getSnapshot().phase, "playing");
    assert.equal(h.controller.getSnapshot().input, null);
    await waitFor(() => Boolean(finishPlayback));
    finishPlayback();
    await replay;
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

test("a pause completes the last word without waiting for the next one", async () => {
  const h = harness();
  try {
    await h.controller.start("a");
    const spokeAt = performance.now();
    h.socket.delta("Bonjour tout le monde");
    await waitFor(() => h.player.chunks === 1);
    assert.ok(performance.now() - spokeAt >= 240, "fluent speech keeps the last word as look-ahead");
    assert.deepEqual(h.requests.map((r) => [r.text, r.followingText]), [["Bonjour tout le monde", ""]]);
    await h.controller.stop();
  } finally {
    h.cleanup();
  }
});

// Keeps the translation of matching fragments in progress, with nothing spoken, until the
// controller withdraws it.
function holdInterpretation(h: ReturnType<typeof harness>, held: (text: string) => boolean) {
  const answer = globalThis.fetch;
  const withdrawn: string[] = [];
  globalThis.fetch = async (url, init) => {
    const body = String(url) === "/api/interpret" ? JSON.parse(String(init?.body)) : null;
    if (!body || !held(body.text)) return answer(url, init);
    h.requests.push(body);
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          'data: {"type":"gate","decision":"ready","probability":0.9,"elapsedMs":1}\n\n'));
        init?.signal?.addEventListener("abort", () => {
          withdrawn.push(body.text);
          controller.error(init.signal!.reason);
        });
      },
    }), { headers: { "Content-Type": "text/event-stream" } });
  };
  return withdrawn;
}

test("a fragment cut inside a word is withdrawn before it is spoken", async () => {
  const h = harness();
  const withdrawn = holdInterpretation(h, (text) => text.endsWith(" cham"));
  try {
    await h.controller.start("a");
    // The ASR paused inside "chambre" long enough for "cham" to look complete.
    h.socket.delta("Je réserve une cham");
    await waitFor(() => h.requests.length === 1);
    h.socket.delta("bre");
    await waitFor(() => h.player.chunks === 1);
    assert.deepEqual(withdrawn, ["Je réserve une cham"]);
    assert.deepEqual(h.requests.map((r) => r.text), ["Je réserve une cham", "Je réserve une chambre"]);
    assert.equal(h.controller.getSnapshot().warning, null);
    await h.controller.stop();
    assert.equal(h.controller.getSnapshot().turns[0].translation, "translation Je réserve une chambre");
  } finally {
    h.cleanup();
  }
});

test("an unspoken fragment is withdrawn when the next words negate it", async () => {
  const h = harness();
  const withdrawn = holdInterpretation(h, (text) => text === "Je veux");
  try {
    await h.controller.start("a");
    h.socket.delta("Je veux");
    await waitFor(() => h.requests.length === 1);
    h.socket.delta(" pas annuler");
    await waitFor(() => h.player.chunks === 1);
    assert.deepEqual(withdrawn, ["Je veux"]);
    assert.deepEqual(h.requests.map((r) => [r.text, r.followingText]), [["Je veux", ""], ["Je veux pas", "annuler"]]);
    await h.controller.stop();
  } finally {
    h.cleanup();
  }
});

test("an unspoken fragment is withdrawn when the next words continue its amount", async () => {
  const h = harness((text) => text === "Ça coûte");
  const withdrawn = holdInterpretation(h, (text) => text === "Ça coûte soixante");
  try {
    await h.controller.start("a");
    h.socket.delta("Ça coûte soixante");
    await waitFor(() => h.requests.length === 2);
    // The rest of the amount arrives in pieces, the first one a bare hyphen.
    h.socket.delta("-d");
    await waitFor(() => withdrawn.length === 1);
    h.socket.delta("ix euros");
    await waitFor(() => h.player.chunks === 1);
    assert.deepEqual(withdrawn, ["Ça coûte soixante"]);
    assert.deepEqual(h.requests.map((r) => r.text), ["Ça coûte", "Ça coûte soixante", "Ça coûte soixante-dix"]);
    await h.controller.stop();
  } finally {
    h.cleanup();
  }
});

test("an unspoken fragment is withdrawn when the final transcript revises its words", async () => {
  const h = harness();
  const withdrawn = holdInterpretation(h, (text) => text === "Je veux");
  try {
    await h.controller.start("a");
    h.socket.delta("Je veux");
    await waitFor(() => h.requests.length === 1);
    h.socket.emit({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item-0",
      transcript: "Je ne veux pas annuler.",
    });
    await waitFor(() => h.player.chunks === 1);
    assert.deepEqual(withdrawn, ["Je veux"]);
    assert.deepEqual(h.requests.map((r) => r.text), ["Je veux", "Je ne veux pas annuler."]);
    await h.controller.stop();
  } finally {
    h.cleanup();
  }
});

test("a fragment that cannot be spoken yet does not hide a later one that can", async () => {
  const h = harness();
  try {
    await h.controller.start("a");
    const spokeAt = performance.now();
    h.socket.delta("Il reste vingt, deux places.");
    await waitFor(() => h.player.chunks === 1);
    assert.ok(performance.now() - spokeAt < 200, "no pause needed to reach the sentence");
    assert.deepEqual(h.requests.map((r) => r.text), ["Il reste vingt, deux places."]);
    await h.controller.stop();
  } finally {
    h.cleanup();
  }
});

test("a last word held back after a pause is spoken once punctuation ends its sentence", async () => {
  const h = harness((text) => text === "Je voudrais une table");
  try {
    await h.controller.start("a");
    h.socket.delta("Je voudrais une table");
    await waitFor(() => h.requests.length === 1);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(h.player.chunks, 0);
    // The ASR adds the period late, after the pause.
    h.socket.delta(".");
    await waitFor(() => h.player.chunks === 1);
    assert.deepEqual(h.requests.map((r) => r.text), ["Je voudrais une table", "Je voudrais une table."]);
    await h.controller.stop();
    assert.equal(h.requests.length, 2);
  } finally {
    h.cleanup();
  }
});

test("translated speech still waiting to play is reported so the voice can catch up", async () => {
  const h = harness();
  let queued = 0;
  Object.defineProperty(h.player, "pendingSeconds", { get: () => queued });
  try {
    await h.controller.start("a");
    h.socket.delta("Bonjour à tous. ");
    await waitFor(() => h.requests.length === 1);
    queued = 1.5;
    h.socket.delta("Merci d’être là. ");
    await waitFor(() => h.requests.length === 2);
    queued = 5;
    h.socket.delta("On commence ?");
    await waitFor(() => h.requests.length === 3);
    assert.deepEqual(h.requests.map((r) => r.queued), [0, 1.5, 5]);
    queued = 0;
    await h.controller.stop();
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

test("an unspoken fragment is found again in a later transcript only if its words still stand", () => {
  // Case and spacing may change; its words and closing punctuation may not.
  assert.equal(prefixEnd("je veux,", "Je veux, pas maintenant", "fr"), "Je veux,".length);
  assert.equal(prefixEnd("Je veux.", "Je veux pas annuler.", "fr"), null);
  assert.equal(prefixEnd("Je veux", "Je ne veux pas", "fr"), null);
  assert.equal(prefixEnd("Je réserve une cham", "Je réserve une chambre", "fr"), null);
  // Without spaces between words, the next word does not extend the last one.
  assert.equal(prefixEnd("今日はいい", "今日はいい天気", "ja"), "今日はいい".length);
  assert.equal(prefixEnd("我喜欢北京", "我喜欢北京大学", "zh"), "我喜欢北京".length);
});

test("early output still waits for dangling prepositions, known negation and unfinished amounts", () => {
  assert.equal(usablePrefix("Ceci est", "un échantillon", "fr"), true);
  assert.equal(usablePrefix("un échantillon de", "voix", "fr"), false);
  assert.equal(usablePrefix("Je veux", "pas annuler", "fr"), false);
  assert.equal(usablePrefix("I want", "not now", "en"), false);
  assert.equal(usablePrefix("Le prix est cent", "vingt euros", "fr"), false);
  assert.equal(usablePrefix("The price is two", "hundred and fifty", "en"), false);
  assert.equal(usablePrefix("The price is two hundred", "and fifty thousand euros", "en"), false);
  assert.equal(usablePrefix("Il reste vingt", "-deux places", "fr"), false);
  assert.equal(usablePrefix("I have two", "tents", "en"), true);
  assert.equal(usablePrefix("Le prix est de 250", "euros", "fr"), true);
  assert.equal(usablePrefix("Ça coûte soixante", "-dix euros", "fr"), false);
  assert.equal(usablePrefix("Est", "-ce que vous", "fr"), false);
  // Counting in separate sentences is not one unfinished amount, nor a dash after a sentence a compound.
  assert.equal(usablePrefix("One.", "Two. Three.", "en"), true);
  assert.equal(usablePrefix("All done.", "-Next item.", "en"), true);
  assert.equal(usablePrefix("Bonjour.", "pas de problème", "fr"), true);
});

test("virtual-mic translation of the next segment overlaps five seconds already queued", async () => {
  let queued = 0;
  const player = new NativePcmPlayer("BlackHole 2ch", () => {}, async <T>(name: string, args: Record<string, unknown>) => {
    if (name === "audio_route_push") queued += Buffer.from(String(args.audio), "base64").length / 48000;
    return (name === "audio_route_status" ? { pendingSeconds: queued, failed: false } : undefined) as T;
  });
  const h = harness(undefined, undefined, true, player, Buffer.alloc(5 * 48000).toString("base64"));
  try {
    await h.controller.start("a");
    h.socket.delta("Bonjour, ");
    await waitFor(() => queued >= 5);
    h.socket.delta("je voudrais un café.");
    await waitFor(() => h.requests.length >= 2);
    assert.ok(player.pendingSeconds > 3, "the next request must begin while the first segment is still queued");
    assert.equal(h.controller.getSnapshot().phase, "listening");
  } finally { h.cleanup(); }
});

test("a delayed overlay stop cannot cancel a replacement interpreter session", async () => {
  const h = harness();
  try {
    await h.controller.start("a");
    const first = h.controller.getSnapshot().sessionId!;
    await h.controller.start("b");
    const second = h.controller.getSnapshot().sessionId!;
    assert.notEqual(first, second);
    assert.equal(h.controller.cancelSession(first), false);
    assert.equal(h.controller.getSnapshot().sessionId, second);
    assert.equal(h.controller.getSnapshot().phase, "listening");
    assert.equal(h.controller.cancelSession(second), true);
    assert.equal(h.controller.getSnapshot().sessionId, null);
    assert.equal(h.controller.getSnapshot().phase, "idle");
  } finally { h.cleanup(); }
});

test("captions commit approved text without audio and continue after the shown prefix", async () => {
  const h = harness(
    (text) => text.endsWith("à"),
    undefined,
    true,
    undefined,
    "ABQAFA==",
    () => ({ speak: false }),
  );
  try {
    await h.controller.start("b");
    h.socket.delta("Bonjour à ");
    await waitFor(() => h.requests.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(
      h.controller.getSnapshot().turns[0].translation,
      "",
      "a fragment the gate holds back is never shown",
    );
    h.socket.delta("tous. On commence ?");
    await waitFor(() => h.controller.getSnapshot().turns[0].translation.includes("tous"));
    assert.equal(h.player.chunks, 0);
    assert.ok(h.requests.every((request) => request.speak === false));
    assert.ok(h.requests.every((request) => request.queued === undefined), "captions request no voice");
    h.options.onBoundary?.();
    await waitFor(() => h.controller.getSnapshot().turns[0].status === "done");
    const turn = h.controller.getSnapshot().turns[0];
    assert.equal(turn.error, undefined);
    assert.equal(h.controller.getSnapshot().error, null);
    // Each source word is translated once: approved text is a commitment, like spoken audio.
    const translated = h.requests
      .filter((request) => !request.text.endsWith("à"))
      .map((request) => request.text)
      .join(" ");
    assert.equal(translated.match(/Bonjour/g)?.length, 1);
    assert.equal(translated.match(/commence/g)?.length, 1);
  } finally {
    h.cleanup();
  }
});

test("a matched voice is used for speech without changing the saved profile voice", async () => {
  const h = harness(undefined, undefined, true, undefined, "ABQAFA==", async () => ({
    speak: true,
    voice: "brian",
  }));
  try {
    await h.controller.start("b");
    h.socket.delta("Bonjour à tous. ");
    await waitFor(() => h.player.chunks === 1);
    assert.equal(h.requests[0].voice, "brian");
    assert.equal(h.requests[0].speak, true);
    assert.equal(h.controller.getSnapshot().profiles.b.voice, "george");
  } finally {
    h.cleanup();
  }
});

test("an empty caption is retried once, then a filler is skipped without blocking the turn", async () => {
  const h = harness(
    undefined,
    undefined,
    true,
    undefined,
    "ABQAFA==",
    () => ({ speak: false }),
    (text) => (/^hum/i.test(text) ? "" : "translation " + text),
  );
  try {
    await h.controller.start("b");
    h.socket.delta("Hum. ");
    h.options.onBoundary?.();
    await waitFor(() => h.controller.getSnapshot().turns[0]?.status === "done");
    assert.equal(h.requests.filter((request) => /^hum/i.test(request.text)).length, 2);
    h.options.onAudio(new Uint8Array(4800));
    h.socket.delta("Bonjour à tous.");
    await waitFor(() => h.controller.getSnapshot().turns.some((turn) => turn.translation === "translation Bonjour à tous."));
    assert.equal(h.controller.getSnapshot().error, null);
  } finally {
    h.cleanup();
  }
});

test("optional benchmark observers trace real capture and playback without changing the stream", async () => {
  const h = harness();
  const events: import("../src/lib/benchmark").DiagnosticEvent[] = [];
  h.controller.observeDiagnostics(() => { throw new Error("Observer failure must be isolated"); });
  const unsubscribe = h.controller.observeDiagnostics(event => events.push(event));
  try {
    await h.controller.start("a", true);
    h.socket.delta("Bonjour, ");
    await waitFor(() => events.some(e => e.type === "segment" && e.segment.finishedAt !== undefined));
    const input = events.find(e => e.type === "input");
    const last = events.filter(e => e.type === "segment").at(-1);
    assert.ok(input?.type === "input" && input.seconds === .1);
    assert.ok(last?.type === "segment");
    const s = last.segment;
    assert.ok(s.requestedAt! <= s.textAt!);
    assert.ok(s.audioAt! <= s.playbackAt!);
    assert.equal(s.outcome, "done");
    assert.equal(s.gateProbability, .99);
    assert.equal(s.gateUnavailable, false);
    assert.equal(h.player.chunks, 1);
    h.options.onEnded();
    await waitFor(() => events.some(e => e.type === "end"));
    assert.ok(events.some(e => e.type === "input-end"));
    assert.ok(events.some(e => e.type === "end" && e.outcome === "done"));
    unsubscribe();
  } finally { h.cleanup(); }
});

for (const gate of [
  { probability: .1, unavailable: false, elapsedMs: 200 },
  { probability: null, unavailable: true, elapsedMs: 3000 },
  { probability: null, unavailable: false, elapsedMs: 0 },
]) test(`benchmark preserves a held gate (${JSON.stringify(gate)}) without displaying or playing it`, async () => {
  const h = harness(() => true);
  Object.assign(h.gate, gate);
  const events: import("../src/lib/benchmark").DiagnosticEvent[] = [];
  h.controller.observeDiagnostics(event => events.push(event));
  try {
    await h.controller.start("a", true);
    h.socket.delta("Bonjour, ");
    await waitFor(() => events.some(e => e.type === "segment" && e.segment.finishedAt !== undefined));
    const last = events.filter(e => e.type === "segment").at(-1);
    assert.ok(last?.type === "segment");
    assert.equal(last.segment.gate, "wait");
    assert.equal(last.segment.gateProbability, gate.probability);
    assert.equal(last.segment.gateUnavailable, gate.unavailable);
    assert.equal(last.segment.metrics?.gateMs, gate.elapsedMs);
    assert.equal(last.segment.outcome, "held");
    assert.equal(last.segment.displayedAt, undefined);
    assert.equal(h.player.chunks, 0);
  } finally { h.cleanup(); }
});

test("completed sentences can end with a word that would otherwise be dangling", async () => {
  for (const text of ["What are you looking for?", "I know that.", "That's what it's for!"])
    assert.equal(usablePrefix(text, "", "en"), true, text);
  for (const text of ["What are you looking for", "I know that", "I know that,", "I know that..."])
    assert.equal(usablePrefix(text, "the answer is correct", "en"), false, text);

  const h = harness();
  try {
    h.controller.setProfile("a", { language: "en" });
    h.controller.setProfile("b", { language: "fr" });
    await h.controller.start("a");
    h.socket.delta("What are you looking for?");
    await waitFor(() => h.player.chunks === 1);
    assert.equal(h.requests[0].text, "What are you looking for?");
    assert.equal(h.requests[0].isFinal, false, "sentence punctuation must release the live prefix without ending the turn");
    assert.equal(h.controller.getSnapshot().phase, "listening");
  } finally { h.cleanup(); }
});
