import {
  AudioPlayer,
  MicrophoneCapture,
  base64ToBytes,
  makeWav,
  type CaptureOptions,
} from "./audio";
import { readAuthToken, rpc } from "./account";
import { api, call, readSession, saveSession, streamInterpretation } from "./api";
import { savedMicrophone } from "./call-preferences";
import { ContinuousTranscription, type ConnectionState, type StreamTiming, type Transcript } from "./transcription";
import type {
  HistoryItem,
  Metrics,
  Phase,
  Profile,
  SpeakerId,
  Turn,
} from "@interprete/shared/contracts";
import { LANGUAGES } from "@interprete/shared/languages";
import {
  appendTranslation,
  nextSegment,
  prefixEnd,
  reconcileConsumed,
  usablePrefix,
  type LiveSegment,
} from "@interprete/shared/live-segments";

import type { DiagnosticEvent, SegmentTrace } from "./benchmark";

export type Snapshot = {
  profiles: Record<SpeakerId, Profile>;
  turns: Turn[];
  phase: Phase;
  sessionId: string | null;
  input: "microphone" | "demo" | null;
  active: SpeakerId;
  level: number;
  error: string | null;
  ready: boolean;
  outputActive: boolean;
  connection: ConnectionState | null;
  warning: string | null;
  volume: number;
  services: {
    transcription: boolean;
    voice: boolean;
    decision: boolean;
  } | null;
};
type Capture = Pick<MicrophoneCapture, "start" | "stop" | "setOutputActive">;
type Player = Omit<Pick<
  AudioPlayer,
  | "unlock"
  | "enqueue"
  | "idle"
  | "stop"
  | "play"
  | "dispose"
  | "setActivityListener"
>, "enqueue"> & {
  enqueue: (input: Uint8Array) => number | null | Promise<number | null>;
  readonly pendingSeconds?: number;
  sharedContext?: () => AudioContext;
  setVolume?: (value: number) => void;
};
// Calls translate other participants as captions (speak: false) or with a matched voice.
export type SpeechChoice = { speak: boolean; voice?: string };
export type InterpreterAdapters = {
  player?: Player;
  capture?: (options: CaptureOptions) => Capture;
  timing?: Partial<StreamTiming>;
  speech?: (speaker: SpeakerId) => SpeechChoice | Promise<SpeechChoice>;
};
type Block = {
  id: string;
  sequence: number;
  text: string;
  translation: string;
  sourceCommitted: string;
  consumed: number;
  rejectedThrough: number;
  lastAttempt: string;
  pcm: Uint8Array[];
  pcmBytes: number;
  metrics: Metrics;
  firstPlaybackAt: number | null;
  startedAt: number;
  final: boolean;
  reconcile: boolean;
  replaying: boolean;
  emptyAttempt: string;
  // When the transcript text last changed; a quiet transcript has complete words.
  updatedAt: number;
};
type Flight = {
  block: Block;
  text: string;
  // Transcript up to the end of the fragment, while none of it has been spoken.
  prefix: string | null;
  // Its last word was only assumed complete, after a pause.
  tentative: boolean;
  abort: AbortController;
  superseded: boolean;
};
type Runtime = {
  id: string;
  speaker: SpeakerId;
  profile: Profile;
  target: Profile;
  demo: boolean;
  capture: Capture | null;
  startup: Promise<void> | null;
  transcriber: ContinuousTranscription | null;
  abort: AbortController;
  segmentTimer: ReturnType<typeof setTimeout> | null;
  inFlight: Promise<void> | null;
  // The fragment in flight while it can still be withdrawn: no audio has been played yet.
  flight: Flight | null;
  blocks: Block[];
  previousSource: string;
  previousTranslation: string;
  lastSegmentAt: number;
  retryAt: number;
  retries: number;
  hadSpeech: boolean;
  finishing: boolean;
};
const initialProfiles: Record<SpeakerId, Profile> = {
  a: {
    id: "a",
    name: "You",
    language: "fr",
    voice: "sarah",
    consent: false,
    cloneStatus: "off",
    sampleSeconds: 0,
  },
  b: {
    id: "b",
    name: "Other person",
    language: "en",
    voice: "george",
    consent: false,
    cloneStatus: "off",
    sampleSeconds: 0,
  },
};
const initial: Snapshot = {
  profiles: initialProfiles,
  turns: [],
  phase: "idle",
  sessionId: null,
  input: null,
  active: "a",
  level: 0,
  error: null,
  ready: false,
  outputActive: false,
  connection: null,
  warning: null,
  volume: 1,
  services: null,
};
// While the speaker keeps talking, the last word waits for the next one to start: it may be
// incomplete, and it gives the readiness gate one word of look-ahead. A pause this long marks
// it complete, so a phrase whose punctuation the ASR adds late is not held back.
const WORD_SETTLE_MS = 250;
// Minimum gap between two segment requests of the same turn.
const SEGMENT_SPACING_MS = 120;
const storageKey = "interprete-profiles-v1";
const volumeKey = "interprete-volume-v1";
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong. Try again.";

const hotControllers = new Set<InterpreterController>();

export class InterpreterController {
  private state: Snapshot = initial;
  private listeners = new Set<() => void>();
  private runtime: Runtime | null = null;
  private diagnosticListeners = new Set<(event: DiagnosticEvent) => void>();
  private models: Record<string, string> = {};
  observeDiagnostics = (listener: (event: DiagnosticEvent) => void) => {
    this.diagnosticListeners.add(listener);
    return () => { this.diagnosticListeners.delete(listener); };
  };
  get pendingAudioSeconds() { return this.player.pendingSeconds ?? 0; }
  private diagnostic(event: DiagnosticEvent) {
    // Diagnostics must never interrupt capture, cancellation, or ordered playback.
    for (const listener of this.diagnosticListeners) {
      try { listener(event); } catch { /* The translation remains usable if a diagnostic observer fails. */ }
    }
  }
  private player: Player;
  private captureFactory: (options: CaptureOptions) => Capture;
  private timing?: Partial<StreamTiming>;
  private speech?: InterpreterAdapters["speech"];
  private outputTail: ReturnType<typeof setTimeout> | null = null;
  private initPromise: Promise<void> | null = null;
  private samples: Record<SpeakerId, { files: Blob[]; seconds: number }> = {
    a: { files: [], seconds: 0 },
    b: { files: [], seconds: 0 },
  };
  private cloneJobs = new Set<SpeakerId>();
  private replayAbort: AbortController | null = null;
  private startGeneration = 0;
  private stoppingCapture: Promise<unknown> = Promise.resolve();
  constructor(adapters: InterpreterAdapters = {}) {
    this.player = adapters.player ?? new AudioPlayer();
    if (import.meta.hot) {
      hotControllers.add(this);
      import.meta.hot.dispose(() => Promise.allSettled([...hotControllers].map(async (controller) => {
        controller.dispose();
        await Promise.allSettled([controller.stoppingCapture, controller.player.idle()]);
      })));
    }
    this.timing = adapters.timing;
    this.speech = adapters.speech;
    this.captureFactory =
      adapters.capture ?? ((options) => new MicrophoneCapture(options));
    this.player.setActivityListener((active) => {
      if (this.outputTail) clearTimeout(this.outputTail);
      this.update({ outputActive: active });
      if (active) this.runtime?.capture?.setOutputActive(true);
      else {
        const capture = this.runtime?.capture;
        this.outputTail = setTimeout(
          () => capture?.setOutputActive(false),
          180,
        );
      }
    });
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.state;
  getServerSnapshot = () => initial;
  private update(patch: Partial<Snapshot>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  private turn(id: string, patch: Partial<Turn>) {
    this.update({
      turns: this.state.turns.map((t) =>
        t.id === id ? { ...t, ...patch } : t,
      ),
    });
  }
  private persist() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(this.state.profiles));
    } catch {}
  }
  setProfile(id: SpeakerId, patch: Partial<Profile>) {
    this.update({
      profiles: {
        ...this.state.profiles,
        [id]: { ...this.state.profiles[id], ...patch, id },
      },
    });
    this.persist();
  }
  async setConsent(id: SpeakerId, consent: boolean) {
    const previous = this.state.profiles[id];
    if (consent && !previous.consent && previous.cloneVoice) {
      await this.removeVoice(id);
      if (this.state.profiles[id].cloneVoice) return;
    }
    this.setProfile(id, {
      consent,
      consentId: consent
        ? previous.consentId || crypto.randomUUID()
        : undefined,
      cloneError: undefined,
    });
    if (!consent) {
      this.samples[id] = { files: [], seconds: 0 };
      await this.removeVoice(id);
    } else if (this.state.profiles[id].cloneStatus !== "ready")
      this.setProfile(id, { cloneStatus: "collecting" });
  }
  dismissError = () => this.update({ error: null, warning: null });
  setVolume(value: number) {
    const volume = Math.min(1, Math.max(0, value));
    this.player.setVolume?.(volume);
    this.update({ volume });
    try {
      localStorage.setItem(volumeKey, String(volume));
    } catch {}
  }
  init() {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      try {
        const result = await call(api.api.status.$get());
        saveSession(result.session);
        this.models = result.models ?? {};
        try {
          const raw = localStorage.getItem(volumeKey);
          const storedVolume = Number(raw);
          if (raw !== null && Number.isFinite(storedVolume))
            this.setVolume(storedVolume);
        } catch {}
        try {
          const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
          if (saved) {
            for (const id of ["a", "b"] as const) {
              const p = saved[id];
              if (
                p &&
                LANGUAGES.some((l) => l.code === p.language) &&
                typeof p.voice === "string"
              )
                this.setProfile(id, {
                  name:
                    typeof p.name === "string"
                      ? p.name.slice(0, 40)
                      : initialProfiles[id].name,
                  language: p.language,
                  voice:
                    p.consent === true ? p.voice : initialProfiles[id].voice,
                  voiceLabel: p.voiceLabel,
                  cloneVoice: p.cloneVoice,
                  consent: p.consent === true,
                  consentId:
                    p.consent === true
                      ? typeof p.consentId === "string"
                        ? p.consentId
                        : crypto.randomUUID()
                      : undefined,
                  cloneStatus:
                    p.cloneStatus === "ready" && p.consent === true
                      ? "ready"
                      : p.cloneVoice
                        ? "verification"
                        : p.consent
                          ? "collecting"
                          : "off",
                  sampleSeconds: 0,
                });
            }
          }
        } catch {}
        this.update({ services: result.services, ready: true });
        void this.syncAccountVoice();
      } catch (e) {
        this.update({ error: message(e), ready: false });
        this.initPromise = null;
      }
    })();
    return this.initPromise;
  }
  private context(): HistoryItem[] {
    return this.state.turns
      .filter((t) => t.status === "done")
      .slice(-4)
      .map((t) => ({
        source: t.source.slice(0, 1500),
        translation: t.translation.slice(0, 1500),
        sourceLanguage: t.sourceLanguage,
        targetLanguage: t.targetLanguage,
      }));
  }
  private isCurrent(r: Runtime) {
    return this.runtime === r && !r.abort.signal.aborted;
  }
  async start(speaker: SpeakerId, demo = false, demoUrl?: string) {
    const clickedAt = performance.now();
    if (this.runtime) {
      if (
        this.state.phase === "connecting" &&
        this.runtime.speaker === speaker
      ) {
        this.cancel();
        return;
      }
      if (
        this.state.phase === "listening" &&
        this.runtime.speaker === speaker
      ) {
        await this.stop();
        return;
      }
      this.cancel();
    }
    this.replayAbort?.abort();
    this.player.stop();
    const generation = ++this.startGeneration;
    // Unlock output immediately in the click gesture, while the session is prepared.
    const unlock = this.player.unlock().then(
      () => null,
      (error) => error,
    );
    await this.init();
    await this.stoppingCapture;
    const audioError = await unlock;
    if (generation !== this.startGeneration || !this.state.ready) return;
    if (audioError) {
      this.update({ error: message(audioError) });
      return;
    }
    if (!this.state.services?.transcription || !this.state.services.voice) {
      this.update({
        error:
          "Translation services are not configured on this deployment yet.",
      });
      return;
    }
    const profile = { ...this.state.profiles[speaker] };
    const target = { ...this.state.profiles[speaker === "a" ? "b" : "a"] };
    if (profile.language === target.language) {
      this.update({ error: "Choose two different languages to start." });
      return;
    }
    if (demo && !demoUrl && !["fr", "en"].includes(profile.language)) {
      this.update({
        error:
          "The audio sample is available in French and English. Use the microphone for this language.",
      });
      return;
    }
    const id = crypto.randomUUID();
    const r: Runtime = {
      id, speaker, profile, target, demo,
      capture: null, startup: null, transcriber: null,
      abort: new AbortController(), segmentTimer: null, inFlight: null, flight: null,
      blocks: [this.newBlock(id, 0, clickedAt)],
      previousSource: "", previousTranslation: "",
      lastSegmentAt: 0, retryAt: 0, retries: 0, hadSpeech: false, finishing: false,
    };
    this.runtime = r;
    this.diagnostic({ type: "session", sessionId: id, at: performance.now(), startedAt: clickedAt, source: profile.language, target: target.language, models: this.models });
    this.addTurn(r, r.blocks[0]);
    this.update({
      phase: "connecting", sessionId: id, connection: "connecting", active: speaker,
      input: demo ? "demo" : "microphone",
      error: null, warning: null, outputActive: false,
    });
    r.transcriber = new ContinuousTranscription({
      language: profile.language, initialId: id, signal: r.abort.signal,
      timing: this.timing,
      onTranscript: (item) => this.transcript(r, item),
      onConnection: (connection) => {
        if (this.isCurrent(r)) this.update({ connection });
      },
      onWarning: (warning) => {
        if (this.isCurrent(r)) this.update({ warning });
      },
    });
    let inputBytes = 0, lastInputTrace = -Infinity;
    r.capture = this.captureFactory({
      onAudio: (bytes) => {
        if (!this.isCurrent(r)) return;
        inputBytes += bytes.length;
        const now = performance.now();
        if (this.diagnosticListeners.size && now - lastInputTrace >= 250) {
          lastInputTrace = now;
          this.diagnostic({ type: "input", sessionId: id, at: now, seconds: inputBytes / 48000, queued: this.pendingAudioSeconds });
        }
        r.transcriber?.append(bytes);
      },
      onLevel: (level) => { if (this.isCurrent(r)) this.update({ level }); },
      onBoundary: () => { if (this.isCurrent(r)) r.transcriber?.checkpoint(); },
      onEnded: () => {
        if (!this.isCurrent(r)) return;
        this.diagnostic({ type: "input", sessionId: id, at: performance.now(), seconds: inputBytes / 48000, queued: this.pendingAudioSeconds });
        this.diagnostic({ type: "input-end", sessionId: id, at: performance.now() });
        if (!r.finishing) void this.stop();
      },
      onError: (error) => this.fail(r, new Error(error)),
      recordSample: profile.consent && !demo,
      shouldRecordSample: () => {
        const current = this.state.profiles[speaker];
        return current.consent && current.consentId === profile.consentId &&
          !["ready", "creating", "verification", "error"].includes(current.cloneStatus);
      },
      onSample: (sample) => {
        if (this.isCurrent(r)) void this.collect(speaker, sample.blob, sample.seconds);
      },
      ...(demo
        ? { demoUrl: demoUrl || `/samples/${profile.language}.wav` }
        : { preferredDeviceId: savedMicrophone() }),
      context: this.player.sharedContext?.(),
    });
    try {
      // The capture starts once. Connections and transcripts roll underneath it.
      r.startup = Promise.all([r.capture.start(), r.transcriber.start()]).then(() => {});
      await r.startup;
      if (this.isCurrent(r) && !r.finishing) this.update({ phase: "listening" });
    } catch (e) {
      if (this.isCurrent(r)) {
        const label = e instanceof DOMException && e.name === "NotAllowedError"
          ? "The microphone is blocked. Allow it in your browser, then try again."
          : e instanceof DOMException && e.name === "NotFoundError"
            ? "No microphone was found on this device." : message(e);
        this.fail(r, new Error(label));
      }
    }
  }
  private newBlock(id: string, sequence: number, startedAt: number): Block {
    return {
      id, sequence, startedAt, text: "", translation: "", sourceCommitted: "",
      consumed: 0, rejectedThrough: 0, lastAttempt: "", pcm: [], pcmBytes: 0,
      metrics: {}, firstPlaybackAt: null, final: false, reconcile: false, replaying: false, emptyAttempt: "",
      updatedAt: startedAt,
    };
  }
  private addTurn(r: Runtime, block: Block) {
    if (this.state.turns.some((turn) => turn.id === block.id)) return;
    for (const turn of this.state.turns.slice(0, -29))
      if (turn.audioUrl) URL.revokeObjectURL(turn.audioUrl);
    this.update({ turns: [...this.state.turns.slice(-29), {
      id: block.id, speaker: r.speaker, sourceLanguage: r.profile.language,
      targetLanguage: r.target.language, source: block.text, translation: "",
      status: "draft", metrics: {}, demo: r.demo,
    }] });
  }
  private transcript(r: Runtime, item: Transcript) {
    if (!this.isCurrent(r)) return;
    let block = r.blocks.find((entry) => entry.id === item.id);
    if (!block) {
      block = this.newBlock(item.id, item.sequence, item.startedAt);
      r.blocks.push(block);
      r.blocks.sort((a, b) => a.sequence - b.sequence);
    }
    if (block.text !== item.text) {
      block.updatedAt = performance.now();
    }
    if (this.diagnosticListeners.size) this.diagnostic({
      type: "transcript", sessionId: r.id, at: performance.now(),
      transcript: { id: item.id, text: item.text, final: item.final, revised: item.revised, replaying: item.replaying },
    });
    block.text = item.text;
    const flight = r.flight;
    // An unspoken fragment can still be wrong: the ASR may revise its words or keep extending
    // a last word assumed complete after a pause, and the next words can reveal a negation or
    // the rest of an amount. It is withdrawn and offered again with that context.
    if (flight?.block === block && flight.prefix !== null) {
      const end = prefixEnd(flight.prefix, block.text, r.profile.language);
      if (end === null || !usablePrefix(flight.text, block.text.slice(end), r.profile.language)) {
        flight.superseded = true;
        flight.abort.abort();
      }
    }
    block.final = item.final;
    block.replaying = item.replaying;
    block.reconcile ||= item.revised;
    if (block.text.trim()) {
      r.hadSpeech = true;
      this.addTurn(r, block);
    this.turn(block.id, { source: block.text, status: item.final ? "working" : "draft" });
    }
    // Even a prolonged provider outage cannot grow retained transcripts forever.
    if (r.blocks.length > 60) {
      const index = r.inFlight ? 1 : 0;
      const [lost] = r.blocks.splice(index, 1);
      this.turn(lost.id, { status: "error", error: "Translation unavailable during an extended interruption." });
      this.update({ warning: "The translation fell too far behind. Some passages could not be played; the microphone stays on." });
    }
    if (!r.finishing) this.scheduleSegment(r);
  }
  private scheduleSegment(r: Runtime) {
    if (!this.isCurrent(r) || r.finishing || r.inFlight || r.segmentTimer) return;
    const now = performance.now();
    r.segmentTimer = setTimeout(() => {
      r.segmentTimer = null;
      if (this.isCurrent(r) && !r.finishing) void this.pumpSegment(r);
    }, Math.max(10, r.lastSegmentAt + SEGMENT_SPACING_MS - now, r.retryAt - now));
  }
  private pumpSegment(r: Runtime): Promise<void> {
    if (r.inFlight) return r.inFlight;
    const work = this.processSegment(r);
    r.inFlight = work;
    void work.then(() => {
      if (r.inFlight === work) r.inFlight = null;
    }, (error) => {
      if (r.inFlight === work) r.inFlight = null;
      if (this.isCurrent(r)) this.fail(r, error);
    });
    return work;
  }
  private async processSegment(r: Runtime) {
    const block = r.blocks[0];
    if (!block || block.replaying || !this.isCurrent(r)) return;
    if ((this.player.pendingSeconds ?? 0) > 6) {
      if (!r.finishing) setTimeout(() => this.scheduleSegment(r), 300);
      return;
    }
    if (block.reconcile) {
      block.consumed = reconcileConsumed(block.sourceCommitted, block.text, r.profile.language);
      block.rejectedThrough = block.consumed;
      block.reconcile = false;
    }
    const quiet = performance.now() - block.updatedAt;
    const paused = !block.final && quiet >= WORD_SETTLE_MS;
    // Look again once a pause would release the last word.
    if (!block.final && !paused && !r.finishing) setTimeout(() => this.scheduleSegment(r), WORD_SETTLE_MS - quiet);
    let candidate = nextSegment(block.text, block.consumed, block.final, r.profile.language, block.rejectedThrough, paused);
    // A fragment that cannot be spoken yet must not hide a later one that can.
    while (candidate && !block.final && !usablePrefix(candidate.text, candidate.followingText, r.profile.language)) {
      block.rejectedThrough = candidate.endUnits;
      candidate = nextSegment(block.text, block.consumed, false, r.profile.language, block.rejectedThrough, paused);
    }
    if (!candidate) {
      if (block.final) {
        this.completeBlock(r, block);
        if (!r.finishing) setTimeout(() => this.scheduleSegment(r), 0);
      }
      return;
    }
    const attempt = candidate.text + "|" + candidate.followingText;
    if (!block.final && attempt === block.lastAttempt) return;
    block.lastAttempt = attempt;
    r.lastSegmentAt = performance.now();
    try {
      await this.translateSegment(r, block, candidate);
      r.retries = 0;
      r.retryAt = 0;
    } catch (error) {
      if (!this.isCurrent(r)) return;
      if (r.finishing) throw error;
      // Translation/provider errors must not tear down microphone capture.
      block.lastAttempt = "";
      r.retryAt = performance.now() + Math.min(5000, 500 * 2 ** Math.min(r.retries++, 4));
      this.update({ warning: "The translation is reconnecting. Listening continues and pending passages are kept." });
    }
    if (this.isCurrent(r) && !r.finishing)
      setTimeout(() => this.scheduleSegment(r), 0);
  }
  private async translateSegment(r: Runtime, block: Block, candidate: LiveSegment) {
    const trace: SegmentTrace | null = this.diagnosticListeners.size ? {
      id: crypto.randomUUID(), text: candidate.text, translation: "", observedAt: block.updatedAt,
      blockId: block.id, sourceStart: block.text.slice(0, candidate.end).trimEnd().length - candidate.text.length, sourceEnd: candidate.end,
      followingText: candidate.followingText,
      startedAt: performance.now(), queued: this.pendingAudioSeconds, outcome: "running",
    } : null;
    const report = () => { if (trace) this.diagnostic({ type: "segment", sessionId: r.id, at: performance.now(), segment: { ...trace } }); };
    report();
    const previous = block.translation;
    let translation = "", accepted = false, allowed = block.final;
    const flight: Flight = {
      block, text: candidate.text, abort: new AbortController(), superseded: false,
      prefix: block.final ? null : block.text.slice(0, candidate.end),
      tentative: !block.final && candidate.end === block.text.length && /[\p{L}\p{N}]$/u.test(block.text),
    };
    r.flight = flight;
    const choice = (await this.speech?.(r.speaker)) ?? { speak: true };
    if (!this.isCurrent(r)) return;
    const speak = choice.speak;
    if (trace) trace.voice = speak ? (choice.voice ?? this.state.profiles[r.speaker].voice) : undefined;
    // Spoken audio commits a source prefix; for captions, the approved and completed text does.
    const accept = () => {
      if (accepted) return;
      accepted = true;
      flight.prefix = null;
      block.consumed = candidate.endUnits;
      block.rejectedThrough = block.consumed;
    };
    const context = this.context();
    const precedingSource = appendTranslation(r.previousSource, block.sourceCommitted, r.profile.language);
    if (trace) trace.precedingSpeech = precedingSource.slice(-1500);
    if (precedingSource) context.push({
      source: precedingSource.slice(-1500),
      translation: appendTranslation(r.previousTranslation, previous, r.target.language).slice(-1500),
      sourceLanguage: r.profile.language, targetLanguage: r.target.language, continuation: true,
    });
    try {
      if (trace) { trace.requestedAt = performance.now(); trace.queued = this.pendingAudioSeconds; report(); }
      await streamInterpretation({
        text: candidate.text, followingText: candidate.followingText,
        sourceLanguage: r.profile.language, targetLanguage: r.target.language,
        speaker: r.speaker, voice: choice.voice ?? this.state.profiles[r.speaker].voice,
        isFinal: block.final, speak, context: context.slice(-6),
        // Translated speech still waiting to play lets the server voice this fragment faster.
        ...(speak ? { queued: Math.round(100 * (this.player.pendingSeconds ?? 0)) / 100 } : {}),
      }, AbortSignal.any([r.abort.signal, flight.abort.signal]), async (event) => {
        if (!this.isCurrent(r)) return;
        const display = () => {
          if (trace && translation && trace.displayedAt === undefined) { trace.displayedAt = performance.now(); report(); }
          this.turn(block.id, { translation: appendTranslation(previous, translation, r.target.language) });
        };
        if (event.type === "gate") {
          if (trace) {
            trace.gate = event.decision;
            trace.gateAt = performance.now();
            trace.gateProbability = event.probability;
            trace.gateUnavailable = event.unavailable;
            trace.metrics = { ...trace.metrics, gateMs: event.elapsedMs };
            report();
          }
          allowed = event.decision !== "wait";
          if (allowed && translation) display();
        }
        if (event.type === "text") {
          translation += event.delta;
          if (trace) { trace.textAt ??= performance.now(); trace.translation = translation; report(); }
          if (allowed) display();
        }
        if (event.type === "audio") {
          const bytes = base64ToBytes(event.audio);
          if (!bytes.length) return;
          if (trace && trace.audioAt === undefined) { trace.audioAt = performance.now(); report(); }
          accept();
          // Replay history is optional and bounded, live playback is never truncated.
          block.pcmBytes += bytes.length;
          if (block.pcmBytes <= 90 * 48_000) block.pcm.push(bytes);
          else block.pcm = [];
          const at = await this.player.enqueue(bytes);
          if (!this.isCurrent(r)) return;
          if (trace && trace.playbackAt === undefined && at !== null) { trace.playbackAt = at; report(); }
          if (block.firstPlaybackAt === null && at !== null) {
            block.firstPlaybackAt = at;
            block.metrics.firstAudioMs = Math.max(0, at - block.startedAt);
          }
          display();
          if (r.finishing) this.update({ phase: "playing" });
        }
        if (event.type === "done") {
          if (trace) { trace.metrics = { ...trace.metrics, ...event.metrics }; trace.outcome = allowed ? "done" : "held"; }
          if (!speak && allowed) {
            // An empty caption is retried once; a second one is a filler with nothing to show.
            if (!translation.trim() && block.emptyAttempt !== candidate.text) {
              block.emptyAttempt = candidate.text;
              throw new Error("The translation returned no text.");
            }
            accept();
            display();
          }
          if (event.spoken && !accepted) throw new Error("No audio received. Try again with a standard voice.");
          // A last word held back after a pause is offered again if punctuation now ends it.
          if (!accepted) block.rejectedThrough = candidate.endUnits - (flight.tentative ? 1 : 0);
          block.metrics.translationMs ??= event.metrics.translationMs;
          block.metrics.gateMs ??= event.metrics.gateMs;
          block.metrics.ttsFirstMs ??= event.metrics.ttsFirstMs;
        }
      });
    } catch (error) {
      if (trace) {
        trace.outcome = flight.superseded && !accepted ? "superseded" : r.abort.signal.aborted ? "cancelled" : "error";
        if (trace.outcome === "error") trace.error = message(error);
      }
      if (!flight.superseded || accepted) throw error;
      block.lastAttempt = "";
    } finally {
      if (trace) { trace.finishedAt = performance.now(); if (trace.outcome === "running") trace.outcome = "cancelled"; report(); }
      if (r.flight === flight) r.flight = null;
      // Once audio was played, never replay this source prefix on a network retry.
      if (accepted) {
        block.translation = appendTranslation(previous, translation, r.target.language);
        block.sourceCommitted = appendTranslation(block.sourceCommitted, candidate.text, r.profile.language);
      }
      this.turn(block.id, { translation: block.translation, metrics: block.metrics });
    }
  }
  private completeBlock(r: Runtime, block: Block) {
    if (block.text.trim()) {
      this.turn(block.id, {
        translation: block.translation, status: "done", metrics: block.metrics,
        ...(block.pcm.length ? { audioUrl: URL.createObjectURL(makeWav(block.pcm)) } : {}),
      });
      r.previousSource = appendTranslation(r.previousSource, block.sourceCommitted, r.profile.language).slice(-1500);
      r.previousTranslation = appendTranslation(r.previousTranslation, block.translation, r.target.language).slice(-1500);
      const oldAudio = this.state.turns.filter((turn) => turn.audioUrl).slice(0, -3);
      for (const turn of oldAudio) {
        URL.revokeObjectURL(turn.audioUrl!);
        this.turn(turn.id, { audioUrl: undefined });
      }
    } else this.update({ turns: this.state.turns.filter((turn) => turn.id !== block.id) });
    block.pcm = [];
    r.blocks = r.blocks.filter((entry) => entry !== block);
  }
  async stop() {
    const r = this.runtime;
    if (!r || r.finishing) return;
    r.finishing = true;
    if (r.segmentTimer) clearTimeout(r.segmentTimer);
    this.update({ phase: "finishing", level: 0 });
    try {
      // Do not wait for a disconnected ASR socket before releasing the microphone.
      const sample = await r.capture?.stop();
      r.capture = null;
      if (!this.isCurrent(r)) return;
      if (sample && sample.seconds >= 1) void this.collect(r.speaker, sample.blob, sample.seconds);
      await r.transcriber?.finish();
      if (!this.isCurrent(r)) return;
      for (const block of r.blocks) { block.final = true; block.replaying = false; block.reconcile = true; }
      this.update({ phase: "translating", connection: null });
      await r.inFlight;
      if (!r.hadSpeech) throw new Error("No speech detected. Move closer to the microphone and try again.");
      while (this.isCurrent(r) && r.blocks.length) {
        if ((this.player.pendingSeconds ?? 0) > 6) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          continue;
        }
        const first = r.blocks[0];
        const before = first.consumed;
        await this.pumpSegment(r);
        if (r.blocks[0] === first && first.consumed <= before)
          throw new Error("The translation returned no audio. Try again.");
      }
      await this.player.idle(r.abort.signal);
      if (!this.isCurrent(r)) return;
      this.diagnostic({ type: "end", sessionId: r.id, at: performance.now(), outcome: "done" });
      this.runtime = null;
      this.update({ phase: "idle", sessionId: null, input: null, connection: null, active: r.speaker === "a" ? "b" : "a", level: 0, outputActive: false });
    } catch (error) {
      if (this.isCurrent(r)) this.fail(r, error);
    }
  }
  private fail(r: Runtime, error: unknown) {
    if (!this.isCurrent(r)) return;
    this.diagnostic({ type: "end", sessionId: r.id, at: performance.now(), outcome: "error", error: message(error) });
    this.cancel(false);
    for (const block of r.blocks) this.turn(block.id, { status: "error", error: message(error) });
    this.update({ error: message(error) });
  }
  cancelSession = (sessionId: string) => {
    // Read the live owner rather than a rendered React snapshot during handoffs.
    if (this.runtime?.id !== sessionId) return false;
    this.cancel();
    return true;
  };
  cancel = (clearError = true) => {
    this.startGeneration++;
    this.replayAbort?.abort();
    this.replayAbort = null;
    const r = this.runtime;
    this.runtime = null;
    if (r) {
      this.diagnostic({ type: "end", sessionId: r.id, at: performance.now(), outcome: "cancelled" });
      r.abort.abort();
      if (r.segmentTimer) clearTimeout(r.segmentTimer);
      r.transcriber?.close();
      if (r.capture) this.stoppingCapture = Promise.allSettled([this.stoppingCapture, r.capture.stop()]);
      for (const block of r.blocks) this.turn(block.id, { status: "error", error: "Prise de parole interrompue" });
    }
    this.player.stop();
    if (this.outputTail) clearTimeout(this.outputTail);
    this.update({ phase: "idle", sessionId: null, input: null, connection: null, outputActive: false, level: 0,
      ...(clearError ? { error: null, warning: null } : {}),
    });
  };
  async replay(turnId: string) {
    const turn = this.state.turns.find((t) => t.id === turnId);
    if (!turn?.audioUrl) return;
    this.cancel();
    const abort = new AbortController();
    this.replayAbort = abort;
    try {
      this.update({ phase: "playing", active: turn.speaker });
      await this.stoppingCapture;
      abort.signal.throwIfAborted();
      await this.player.play(turn.audioUrl, abort.signal);
      if (!abort.signal.aborted) this.update({ phase: "idle" });
    } catch (e) {
      if (!abort.signal.aborted) this.update({ error: message(e), phase: "idle" });
    } finally {
      if (this.replayAbort === abort) this.replayAbort = null;
    }
  }
  // Public for onboarding, which records its own sample before cloning.
  // `autoClone: false` keeps collecting past 30 s; the caller then calls clone().
  async collect(id: SpeakerId, blob: Blob, seconds: number, { autoClone = true } = {}) {
    const profile = this.state.profiles[id];
    if (
      !profile.consent ||
      profile.cloneStatus === "ready" ||
      profile.cloneStatus === "verification" ||
      this.cloneJobs.has(id)
    )
      return;
    const sample = this.samples[id];
    const bytes = sample.files.reduce((n, f) => n + f.size, 0);
    // Same caps as the clone route: 90 s, 12 files, 3.2 MB.
    if (sample.seconds + seconds <= 90 && sample.files.length < 12 && bytes + blob.size <= 3_200_000) {
      sample.files.push(blob);
      sample.seconds += seconds;
    }
    this.setProfile(id, {
      sampleSeconds: Math.round(sample.seconds),
      cloneStatus: profile.cloneStatus === "error" ? "error" : "collecting",
    });
    if (
      autoClone &&
      profile.cloneStatus !== "error" &&
      (sample.seconds >= 30 || sample.files.length >= 12)
    )
      await this.clone(id);
  }
  async clone(id: SpeakerId) {
    const profile = this.state.profiles[id],
      sample = this.samples[id];
    if (
      !profile.consent ||
      !profile.consentId ||
      sample.seconds < 10 ||
      this.cloneJobs.has(id)
    )
      return;
    this.cloneJobs.add(id);
    this.setProfile(id, { cloneStatus: "creating", cloneError: undefined });
    try {
      const form = new FormData();
      form.set("speaker", id);
      form.set("consent", "true");
      form.set("consentId", profile.consentId);
      form.set("seconds", String(sample.seconds));
      for (const [i, blob] of sample.files.entries())
        form.append("files", blob, `voice-${i}.webm`);
      const result = await call(
        api.api.voice.clone.$post(undefined, { init: { body: form } }),
      );
      if (
        !this.state.profiles[id].consent ||
        this.state.profiles[id].consentId !== profile.consentId
      ) {
        await call(
          api.api.voice.delete.$post({ json: { speaker: id, voice: result.voice } }),
        );
        return;
      }
      if (result.requiresVerification)
        this.setProfile(id, {
          cloneVoice: result.voice,
          cloneStatus: "verification",
          cloneError:
            "ElevenLabs requires verification for this voice. The standard voice stays active.",
        });
      else {
        this.setProfile(id, {
          voice: result.voice,
          cloneVoice: result.voice,
          voiceLabel: this.state.profiles[id].name,
          cloneStatus: "ready",
          sampleSeconds: Math.round(sample.seconds),
        });
        this.samples[id] = { files: [], seconds: 0 };
        if (id === "a") void this.saveAccountVoice();
      }
    } catch (e) {
      this.setProfile(id, { cloneStatus: "error", cloneError: message(e) });
    } finally {
      this.cloneJobs.delete(id);
    }
  }
  async removeVoice(id: SpeakerId) {
    const p = this.state.profiles[id];
    this.samples[id] = { files: [], seconds: 0 };
    this.setProfile(id, {
      voice: id === "a" ? "sarah" : "george",
      voiceLabel: undefined,
      sampleSeconds: 0,
      cloneStatus: p.consent ? "collecting" : "off",
    });
    try {
      const voice =
        p.cloneVoice || (p.cloneStatus === "ready" ? p.voice : undefined);
      if (voice)
        await call(api.api.voice.delete.$post({ json: { speaker: id, voice } }));
      if (id === "a" && readAuthToken())
        await rpc.voice.remove().catch((e) => console.warn("Account voice not removed", e));
      this.setProfile(id, {
        cloneVoice: undefined,
        consentId: p.consent ? crypto.randomUUID() : undefined,
        cloneError: undefined,
      });
    } catch (e) {
      this.setProfile(id, {
        cloneStatus: "error",
        cloneError:
          "The voice is no longer in use, but deleting it failed; try again.",
      });
      this.update({ error: message(e) });
    }
  }
  // Speaker A's clone lives on the signed-in account (PostgreSQL). Order: the account's
  // clone if there is one, else the local clone (then saved on the account), else the
  // standard voice already in the profile.
  async syncAccountVoice() {
    const session = readSession();
    if (!readAuthToken() || !session || this.cloneJobs.has("a")) return;
    try {
      const saved = await rpc.voice.get({ session });
      if (!saved) return await this.saveAccountVoice();
      if (this.cloneJobs.has("a")) return;
      this.setProfile("a", {
        voice: saved.voice,
        cloneVoice: saved.voice,
        voiceLabel: this.state.profiles.a.name,
        consent: true,
        consentId: this.state.profiles.a.consentId || crypto.randomUUID(),
        cloneStatus: "ready",
        cloneError: undefined,
      });
    } catch (e) {
      console.warn("Account voice not synced", e);
    }
  }
  // Saves a ready local clone on the account (after onboarding or a new recording).
  async saveAccountVoice() {
    const session = readSession();
    const p = this.state.profiles.a;
    if (!readAuthToken() || !session || p.cloneStatus !== "ready" || !p.cloneVoice) return;
    await rpc.voice.save({ session, voice: p.cloneVoice }).catch((e) => console.warn("Account voice not saved", e));
  }
  // On sign-out the clone stays on the account; this device forgets it.
  forgetAccountVoice() {
    this.samples.a = { files: [], seconds: 0 };
    this.setProfile("a", {
      voice: initialProfiles.a.voice,
      voiceLabel: undefined,
      cloneVoice: undefined,
      consent: false,
      consentId: undefined,
      cloneStatus: "off",
      cloneError: undefined,
      sampleSeconds: 0,
    });
  }
  clearConversation = () => {
    this.cancel();
    for (const turn of this.state.turns)
      if (turn.audioUrl) URL.revokeObjectURL(turn.audioUrl);
    this.update({ turns: [] });
  };
  dispose = () => {
    if (import.meta.hot) hotControllers.delete(this);
    this.cancel();
    this.player.dispose();
  };
}

// React refresh retains controllers in useState, including their previous implementation.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
