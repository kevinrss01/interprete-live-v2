import {
  AudioPlayer,
  MicrophoneCapture,
  base64ToBytes,
  makeWav,
  type CaptureOptions,
} from "./audio";
import { api, call, saveSession, streamInterpretation } from "./api";
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
  reconcileConsumed,
  usablePrefix,
  type LiveSegment,
} from "@interprete/shared/live-segments";

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
    name: "Vous",
    language: "fr",
    voice: "sarah",
    consent: false,
    cloneStatus: "off",
    sampleSeconds: 0,
  },
  b: {
    id: "b",
    name: "Votre interlocuteur",
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
const storageKey = "interprete-profiles-v1";
const volumeKey = "interprete-volume-v1";
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Une erreur est survenue. Réessaie.";

export class InterpreterController {
  private state: Snapshot = initial;
  private listeners = new Set<() => void>();
  private runtime: Runtime | null = null;
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
  async start(speaker: SpeakerId, demo = false) {
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
          "Les services de traduction ne sont pas encore configurés sur ce déploiement.",
      });
      return;
    }
    const profile = { ...this.state.profiles[speaker] };
    const target = { ...this.state.profiles[speaker === "a" ? "b" : "a"] };
    if (profile.language === target.language) {
      this.update({ error: "Choisis deux langues différentes pour démarrer." });
      return;
    }
    if (demo && !["fr", "en"].includes(profile.language)) {
      this.update({
        error:
          "L’exemple audio est disponible en français et en anglais. Utilise le micro pour cette langue.",
      });
      return;
    }
    const id = crypto.randomUUID();
    const r: Runtime = {
      id, speaker, profile, target, demo,
      capture: null, startup: null, transcriber: null,
      abort: new AbortController(), segmentTimer: null, inFlight: null,
      blocks: [this.newBlock(id, 0, clickedAt)],
      previousSource: "", previousTranslation: "",
      lastSegmentAt: 0, retryAt: 0, retries: 0, hadSpeech: false, finishing: false,
    };
    this.runtime = r;
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
    r.capture = this.captureFactory({
      onAudio: (bytes) => { if (this.isCurrent(r)) r.transcriber?.append(bytes); },
      onLevel: (level) => { if (this.isCurrent(r)) this.update({ level }); },
      onBoundary: () => { if (this.isCurrent(r)) r.transcriber?.checkpoint(); },
      onEnded: () => { if (this.isCurrent(r) && !r.finishing) void this.stop(); },
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
      ...(demo ? { demoUrl: `/samples/${profile.language}.wav` } : {}),
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
          ? "Le micro est bloqué. Autorise-le dans ton navigateur, puis réessaie."
          : e instanceof DOMException && e.name === "NotFoundError"
            ? "Aucun microphone n’a été trouvé sur cet appareil." : message(e);
        this.fail(r, new Error(label));
      }
    }
  }
  private newBlock(id: string, sequence: number, startedAt: number): Block {
    return {
      id, sequence, startedAt, text: "", translation: "", sourceCommitted: "",
      consumed: 0, rejectedThrough: 0, lastAttempt: "", pcm: [], pcmBytes: 0,
      metrics: {}, firstPlaybackAt: null, final: false, reconcile: false, replaying: false, emptyAttempt: "",
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
    block.text = item.text;
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
      this.turn(lost.id, { status: "error", error: "Traduction indisponible pendant une interruption prolongée." });
      this.update({ warning: "La traduction a pris trop de retard. Certains passages n’ont pas pu être lus ; le micro reste actif." });
    }
    if (!r.finishing) this.scheduleSegment(r);
  }
  private scheduleSegment(r: Runtime) {
    if (!this.isCurrent(r) || r.finishing || r.inFlight || r.segmentTimer) return;
    r.segmentTimer = setTimeout(() => {
      r.segmentTimer = null;
      if (this.isCurrent(r) && !r.finishing) void this.pumpSegment(r);
    }, Math.max(80, r.lastSegmentAt + 250 - performance.now(), r.retryAt - performance.now()));
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
    const candidate = nextSegment(block.text, block.consumed, block.final, r.profile.language, block.rejectedThrough);
    if (!candidate) {
      if (block.final) {
        this.completeBlock(r, block);
        if (!r.finishing) setTimeout(() => this.scheduleSegment(r), 0);
      }
      return;
    }
    if (!block.final && !usablePrefix(candidate.text, candidate.followingText, r.profile.language)) {
      block.rejectedThrough = candidate.endUnits;
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
      this.update({ warning: "La traduction se reconnecte. L’écoute continue et les passages en attente sont conservés." });
    }
    if (this.isCurrent(r) && !r.finishing)
      setTimeout(() => this.scheduleSegment(r), 0);
  }
  private async translateSegment(r: Runtime, block: Block, candidate: LiveSegment) {
    const previous = block.translation;
    let translation = "", accepted = false, allowed = block.final;
    const choice = (await this.speech?.(r.speaker)) ?? { speak: true };
    if (!this.isCurrent(r)) return;
    const speak = choice.speak;
    // Spoken audio commits a source prefix; for captions, the approved and completed text does.
    const accept = () => {
      if (accepted) return;
      accepted = true;
      block.consumed = candidate.endUnits;
      block.rejectedThrough = block.consumed;
    };
    const context = this.context();
    const precedingSource = appendTranslation(r.previousSource, block.sourceCommitted, r.profile.language);
    if (precedingSource) context.push({
      source: precedingSource.slice(-1500),
      translation: appendTranslation(r.previousTranslation, previous, r.target.language).slice(-1500),
      sourceLanguage: r.profile.language, targetLanguage: r.target.language, continuation: true,
    });
    try {
      await streamInterpretation({
        text: candidate.text, followingText: candidate.followingText,
        sourceLanguage: r.profile.language, targetLanguage: r.target.language,
        speaker: r.speaker, voice: choice.voice ?? this.state.profiles[r.speaker].voice,
        isFinal: block.final, speak, context: context.slice(-6),
      }, r.abort.signal, async (event) => {
        if (!this.isCurrent(r)) return;
        const display = () => this.turn(block.id, {
          translation: appendTranslation(previous, translation, r.target.language),
        });
        if (event.type === "gate") {
          allowed = event.decision !== "wait";
          if (allowed && translation) display();
        }
        if (event.type === "text") {
          translation += event.delta;
          if (allowed) display();
        }
        if (event.type === "audio") {
          const bytes = base64ToBytes(event.audio);
          if (!bytes.length) return;
          accept();
          // Replay history is optional and bounded, live playback is never truncated.
          block.pcmBytes += bytes.length;
          if (block.pcmBytes <= 90 * 48_000) block.pcm.push(bytes);
          else block.pcm = [];
          const at = await this.player.enqueue(bytes);
          if (!this.isCurrent(r)) return;
          if (block.firstPlaybackAt === null && at !== null) {
            block.firstPlaybackAt = at;
            block.metrics.firstAudioMs = Math.max(0, at - block.startedAt);
          }
          display();
          if (r.finishing) this.update({ phase: "playing" });
        }
        if (event.type === "done") {
          if (!speak && allowed) {
            // An empty caption is retried once; a second one is a filler with nothing to show.
            if (!translation.trim() && block.emptyAttempt !== candidate.text) {
              block.emptyAttempt = candidate.text;
              throw new Error("La traduction n’a renvoyé aucun texte.");
            }
            accept();
            display();
          }
          if (event.spoken && !accepted) throw new Error("Aucun son reçu. Réessaie avec une voix provisoire.");
          if (!accepted) block.rejectedThrough = candidate.endUnits;
          block.metrics.translationMs ??= event.metrics.translationMs;
          block.metrics.gateMs ??= event.metrics.gateMs;
          block.metrics.ttsFirstMs ??= event.metrics.ttsFirstMs;
        }
      });
    } finally {
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
      if (!r.hadSpeech) throw new Error("Aucune parole détectée. Rapproche-toi du micro et réessaie.");
      while (this.isCurrent(r) && r.blocks.length) {
        if ((this.player.pendingSeconds ?? 0) > 6) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          continue;
        }
        const first = r.blocks[0];
        const before = first.consumed;
        await this.pumpSegment(r);
        if (r.blocks[0] === first && first.consumed <= before)
          throw new Error("La traduction n’a pas renvoyé d’audio. Réessaie.");
      }
      await this.player.idle(r.abort.signal);
      if (!this.isCurrent(r)) return;
      this.runtime = null;
      this.update({ phase: "idle", sessionId: null, input: null, connection: null, active: r.speaker === "a" ? "b" : "a", level: 0, outputActive: false });
    } catch (error) {
      if (this.isCurrent(r)) this.fail(r, error);
    }
  }
  private fail(r: Runtime, error: unknown) {
    if (!this.isCurrent(r)) return;
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
  async collect(id: SpeakerId, blob: Blob, seconds: number) {
    const profile = this.state.profiles[id];
    if (
      !profile.consent ||
      profile.cloneStatus === "ready" ||
      profile.cloneStatus === "verification" ||
      this.cloneJobs.has(id)
    )
      return;
    const sample = this.samples[id];
    if (sample.seconds + seconds <= 90 && sample.files.length < 12) {
      sample.files.push(blob);
      sample.seconds += seconds;
    }
    this.setProfile(id, {
      sampleSeconds: Math.round(sample.seconds),
      cloneStatus: profile.cloneStatus === "error" ? "error" : "collecting",
    });
    if (
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
            "ElevenLabs demande une vérification de cette voix. La voix provisoire reste active.",
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
      this.setProfile(id, {
        cloneVoice: undefined,
        consentId: p.consent ? crypto.randomUUID() : undefined,
        cloneError: undefined,
      });
    } catch (e) {
      this.setProfile(id, {
        cloneStatus: "error",
        cloneError:
          "La voix n’est plus utilisée. Sa suppression a échoué ; réessaie.",
      });
      this.update({ error: message(e) });
    }
  }
  clearConversation = () => {
    this.cancel();
    for (const turn of this.state.turns)
      if (turn.audioUrl) URL.revokeObjectURL(turn.audioUrl);
    this.update({ turns: [] });
  };
  dispose = () => {
    this.cancel();
    this.player.dispose();
  };
}
