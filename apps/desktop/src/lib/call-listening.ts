import type {
  Profile,
  SpeakerId,
  VoiceFeatures,
  VoiceMatch,
} from "@interprete/shared/contracts";
import { MATCH_VOICES, nearestMatchVoice } from "@interprete/shared/languages";
import { api, call } from "./api";
import { MicrophoneCapture, type CaptureOptions } from "./audio";
import { CallAudioPlayer, SYSTEM_OUTPUT } from "./calls";
import { InterpreterController, type SpeechChoice } from "./interpreter";
import {
  SILENCE_NOTICE,
  SystemAudioCapture,
  VoiceProfiler,
  type CaptureScope,
} from "./system-audio";

export type ListenOptions = { captions: boolean; voice: boolean };
export type ChosenVoice = { voice: string; name: string; source: VoiceMatch["source"] | "default" };
export type ListeningState = {
  sessionId: string | null;
  callId: string | null;
  app: string | null;
  demo: boolean;
  options: ListenOptions;
  scope: CaptureScope | null;
  voice: ChosenVoice | null;
  notice: string | null;
  error: string | null;
  // How the last session ended: a finished sample keeps its captions on screen a moment longer.
  ended: "stopped" | "finished" | "failed" | null;
};
type Capture = Pick<MicrophoneCapture, "start" | "stop" | "setOutputActive">;
export type ListeningAdapters = {
  native: boolean;
  controller?: (adapters: {
    player: CallAudioPlayer;
    capture: (options: CaptureOptions) => Capture;
    speech: (speaker: SpeakerId) => Promise<SpeechChoice>;
  }) => InterpreterController;
  systemCapture?: (options: ConstructorParameters<typeof SystemAudioCapture>[0]) => Capture;
  matchVoice?: (features: VoiceFeatures, language: string) => Promise<VoiceMatch>;
  // The first spoken passage waits at most this long for a matched voice.
  voiceWaitMs?: number;
};
const idle: ListeningState = {
  sessionId: null,
  callId: null,
  app: null,
  demo: false,
  options: { captions: true, voice: false },
  scope: null,
  voice: null,
  notice: null,
  error: null,
  ended: null,
};
const DEFAULT_VOICE: ChosenVoice = { voice: "river", name: "River", source: "default" };
const sleep = (ms: number) => new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));

// Translates what the other participants say: the call's audio feeds the same transcription and
// translation pipeline as the microphone, shown as captions and/or spoken in a similar premade voice.
export class CallListening {
  readonly controller: InterpreterController;
  private state: ListeningState = idle;
  private listeners = new Set<() => void>();
  private player: CallAudioPlayer;
  private profiler = new VoiceProfiler();
  private matching: Promise<VoiceMatch | null> | null = null;
  private choosing: Promise<string> | null = null;
  private generation = 0;
  private started = false;
  private targetLanguage = "fr";
  private sampleUrl = "";
  private sampleAudible = false;
  private sampleCapture: MicrophoneCapture | null = null;
  constructor(private adapters: ListeningAdapters) {
    this.player = new CallAudioPlayer((message) => {
      this.update({ error: message });
      this.controller.cancel(false);
    });
    const options = {
      player: this.player,
      capture: (capture: CaptureOptions) => this.capture(capture),
      speech: () => this.speech(),
    };
    this.controller = adapters.controller?.(options) ?? new InterpreterController(options);
    // A failed or cancelled controller ends the listening session, keeping its error visible.
    this.controller.subscribe(() => {
      const { phase, error } = this.controller.getSnapshot();
      if (phase !== "idle") {
        this.started = true;
        return;
      }
      if (this.started && this.state.sessionId) {
        this.started = false;
        ++this.generation;
        const failure = error ?? this.state.error;
        this.update({ sessionId: null, callId: null, error: failure, ended: failure ? "failed" : "finished" });
        return;
      }
      // A failure cancels into idle first and publishes its message just after.
      if (error && this.state.ended === "finished" && !this.state.sessionId)
        this.update({ error, ended: "failed" });
    });
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.state;
  getServerSnapshot = () => idle;
  private update(patch: Partial<ListeningState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  async start({
    profiles,
    options,
    app = null,
    callId = null,
    demo = false,
    sample = "solo",
  }: {
    profiles: Record<SpeakerId, Profile>;
    options: ListenOptions;
    app?: string | null;
    callId?: string | null;
    demo?: boolean;
    sample?: "solo" | "group";
  }) {
    if (!options.captions && !options.voice) return;
    this.stop();
    const generation = ++this.generation;
    this.profiler = new VoiceProfiler();
    this.matching = null;
    this.choosing = null;
    this.targetLanguage = profiles.a.language;
    this.sampleUrl = profiles.b.language === "en"
      ? sample === "group" ? "/samples/nasa-three-speakers-en.wav" : "/samples/nasa-en.wav"
      : "";
    // In the desktop app, their voice plays natively so a whole-system tap can exclude it.
    this.player.configure(options.voice && this.adapters.native ? SYSTEM_OUTPUT : null);
    this.update({
      ...idle,
      sessionId: crypto.randomUUID(),
      callId,
      app,
      demo,
      options,
    });
    try {
      await this.controller.init();
      if (generation !== this.generation) return;
      this.controller.clearConversation();
      for (const id of ["a", "b"] as const) this.controller.setProfile(id, profiles[id]);
      // Speaker B is the other participant: their language is the source, the user's the target.
      await this.controller.start("b", demo);
      if (generation !== this.generation) return;
      const snapshot = this.controller.getSnapshot();
      if (snapshot.phase === "idle" && !this.started) {
        ++this.generation;
        this.update({
          sessionId: null,
          callId: null,
          error: snapshot.error ?? "The call translation did not start.",
          ended: "failed",
        });
      }
    } catch (error) {
      if (generation !== this.generation) return;
      this.controller.cancel(false);
      this.update({
        sessionId: null,
        callId: null,
        error: error instanceof Error ? error.message : String(error),
        ended: "failed",
      });
    }
  }
  stop() {
    ++this.generation;
    this.started = false;
    // Always cancel: a start still preparing output or credentials is idle but pending.
    this.controller.cancel();
    this.sampleCapture?.setDemoAudible(false);
    this.sampleCapture = null;
    if (this.state.sessionId)
      this.update({ sessionId: null, callId: null, notice: null, ended: "stopped" });
  }
  dismissError() {
    this.update({ error: null });
    this.controller.dismissError();
  }
  setSampleAudible(audible: boolean) {
    this.sampleAudible = audible;
    this.sampleCapture?.setDemoAudible(audible);
  }
  dispose() {
    this.stop();
    this.controller.dispose();
  }
  private capture(options: CaptureOptions): Capture {
    const generation = this.generation;
    const listen = {
      ...options,
      // Their speech is never a cloning sample.
      recordSample: false,
      onAudio: (bytes: Uint8Array) => {
        if (this.state.options.voice && !this.state.voice) this.profile(bytes);
        options.onAudio(bytes);
      },
    };
    if (options.demoUrl) {
      this.sampleCapture = new MicrophoneCapture({
        ...listen,
        demoUrl: this.sampleUrl || options.demoUrl,
        demoAudible: this.sampleAudible,
      });
      return this.sampleCapture;
    }
    const settings = {
      ...listen,
      source: this.state.app,
      onStarted: ({ scope }: { scope: CaptureScope }) => {
        if (generation === this.generation) this.update({ scope });
      },
      onSilence: (silent: boolean) => {
        if (generation === this.generation) this.update({ notice: silent ? SILENCE_NOTICE : null });
      },
    };
    return this.adapters.systemCapture?.(settings) ?? new SystemAudioCapture(settings);
  }
  private profile(bytes: Uint8Array) {
    this.profiler.push(bytes);
    // Ask early, while the first passage is still being transcribed.
    if (!this.matching && this.profiler.voicedSeconds >= 1) {
      const features = this.profiler.features(1);
      if (features) this.match(features);
    }
  }
  private match(features: VoiceFeatures) {
    const generation = this.generation;
    const request =
      this.adapters.matchVoice ??
      ((json: VoiceFeatures, language: string) =>
        call(api.api.voice.match.$post({ json: { features: json, language } })));
    this.matching ??= request(features, this.targetLanguage).then(
      (match) => (generation === this.generation ? match : null),
      () => null,
    );
    return this.matching;
  }
  private async speech(): Promise<SpeechChoice> {
    if (!this.state.options.voice) return { speak: false };
    return { speak: true, voice: await this.chooseVoice() };
  }
  // One voice per session, chosen once: switching voices mid-call would sound like a new person.
  private chooseVoice() {
    const generation = this.generation;
    this.choosing ??= (async () => {
      const wait = this.adapters.voiceWaitMs ?? 1500;
      const deadline = performance.now() + wait;
      while (!this.profiler.features(0.8) && performance.now() < deadline - wait / 2)
        await sleep(100);
      const features = this.profiler.features(0.25);
      if (!features) return DEFAULT_VOICE;
      const fallback = nearestMatchVoice(features.medianPitchHz);
      const match = await Promise.race([
        this.match(features),
        sleep(Math.max(250, deadline - performance.now())),
      ]);
      const chosen = MATCH_VOICES.find((voice) => voice.key === match?.voice);
      return chosen && match
        ? { voice: chosen.key, name: chosen.name, source: match.source }
        : { voice: fallback.key, name: fallback.name, source: "pitch" as const };
    })().then((voice) => {
      if (generation === this.generation) this.update({ voice });
      return voice.voice;
    });
    return this.choosing;
  }
}
