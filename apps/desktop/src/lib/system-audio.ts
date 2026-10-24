import { Channel, invoke } from "@tauri-apps/api/core";
import type { VoiceFeatures } from "@interprete/shared/contracts";
import type { CaptureOptions } from "./audio";
import type { NativeInvoke } from "./calls";

// "app": only the detected call application. "system": every app except Interprète.
export type CaptureScope = "app" | "system";
export type CaptureStarted = { scope: CaptureScope; processes: number };
type ChannelMessage = ArrayBuffer | { type: "stalled" };
type AudioChannel = { onmessage: (message: ChannelMessage) => void };
export type SystemAudioOptions = CaptureOptions & {
  source: string | null;
  onStarted?: (started: CaptureStarted) => void;
  onSilence?: (silent: boolean) => void;
};
export const SILENCE_NOTICE =
  "Aucun son de l’appel n’est capté pour l’instant. Si quelqu’un parle, autorisez Interprète dans Réglages Système › Confidentialité et sécurité › Enregistrement de l’écran et de l’audio système.";

function rms(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let sum = 0;
  const samples = Math.floor(bytes.byteLength / 2);
  for (let i = 0; i < samples; i++) {
    const sample = view.getInt16(i * 2, true) / 32768;
    sum += sample * sample;
  }
  return samples ? Math.sqrt(sum / samples) : 0;
}

// The call's audio arrives as 20 ms, 24 kHz PCM frames from a CoreAudio process tap.
// It has the microphone capture's interface, so transcription and translation are unchanged.
export class SystemAudioCapture {
  private id = crypto.randomUUID();
  private stopped = false;
  private stopping: Promise<null> | null = null;
  private lastSpeech = 0;
  private boundarySent = false;
  private lastLevelAt = 0;
  private heard = false;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    private options: SystemAudioOptions,
    private call: NativeInvoke = invoke,
    private channel: () => AudioChannel = () => new Channel<ChannelMessage>(),
  ) {}
  setOutputActive(_active: boolean) {}
  async start() {
    const channel = this.channel();
    channel.onmessage = (message) => this.receive(message);
    const started = await this.call<CaptureStarted>("system_audio_start", {
      id: this.id,
      source: this.options.source,
      onAudio: channel,
    });
    if (this.stopped) {
      // stop() ran while the tap was starting; release the tap it could not reach.
      await this.call("system_audio_stop", { id: this.id }).catch(() => {});
      return;
    }
    this.options.onStarted?.(started);
    // Silence is normal between sentences, but complete digital silence usually means no permission.
    this.silenceTimer = setTimeout(() => {
      if (!this.heard && !this.stopped) this.options.onSilence?.(true);
    }, 12_000);
  }
  private receive(message: ChannelMessage) {
    if (this.stopped) return;
    if (!(message instanceof ArrayBuffer)) {
      if (message?.type === "stalled")
        this.options.onError(
          "Le son de l’appel n’arrive plus. Vérifiez l’autorisation d’enregistrement audio, puis relancez la traduction.",
        );
      return;
    }
    const bytes = new Uint8Array(message);
    if (!bytes.length) return;
    this.options.onAudio(bytes);
    const level = rms(bytes);
    if (level > 0 && !this.heard) {
      this.heard = true;
      this.options.onSilence?.(false);
    }
    const now = performance.now();
    if (now - this.lastLevelAt >= 80) {
      this.lastLevelAt = now;
      this.options.onLevel(Math.min(1, level * 8));
    }
    // A pause in their speech finalizes an ASR item, exactly like the microphone capture.
    if (level > 0.014) {
      this.lastSpeech = now;
      this.boundarySent = false;
    } else if (this.lastSpeech && now - this.lastSpeech > 450 && !this.boundarySent) {
      this.boundarySent = true;
      this.options.onBoundary?.();
    }
  }
  stop() {
    this.stopping ??= (async () => {
      this.stopped = true;
      if (this.silenceTimer) clearTimeout(this.silenceTimer);
      this.options.onLevel(0);
      await this.call("system_audio_stop", { id: this.id }).catch(() => {});
      return null;
    })();
    return this.stopping;
  }
}

// YIN pitch estimate on a 12 kHz window; null when the window is not clearly voiced.
export function estimatePitch(samples: Float32Array, rate = 12_000) {
  const minLag = Math.floor(rate / 400);
  const maxLag = Math.ceil(rate / 70);
  const size = samples.length - maxLag;
  if (size < 64) return null;
  const difference = new Float32Array(maxLag + 1);
  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < size; i++) {
      const delta = samples[i] - samples[i + lag];
      sum += delta * delta;
    }
    difference[lag] = sum;
  }
  let running = 0;
  const normalized = new Float32Array(maxLag + 1);
  normalized[0] = 1;
  for (let lag = 1; lag <= maxLag; lag++) {
    running += difference[lag];
    normalized[lag] = running ? (difference[lag] * lag) / running : 1;
  }
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (normalized[lag] >= 0.15) continue;
    while (lag < maxLag && normalized[lag + 1] < normalized[lag]) lag++;
    const before = normalized[lag - 1];
    const after = lag < maxLag ? normalized[lag + 1] : normalized[lag];
    const curve = before + after - 2 * normalized[lag];
    const shift = curve > 0 ? (before - after) / (2 * curve) : 0;
    return rate / (lag + shift);
  }
  return null;
}

// Coarse, on-device measurements used to suggest a similar premade voice.
// Only these numbers leave the device; the participant's audio is never sent for voice matching.
export class VoiceProfiler {
  private previous: Float32Array | null = null;
  private pitches: number[] = [];
  private brightness = 0;
  push(bytes: Uint8Array) {
    // Three seconds of voiced speech are plenty; stop spending CPU afterwards.
    if (this.pitches.length >= 150) return;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const frame = new Float32Array(Math.floor(bytes.byteLength / 2));
    for (let i = 0; i < frame.length; i++) frame[i] = view.getInt16(i * 2, true) / 32768;
    const previous = this.previous;
    this.previous = frame;
    if (!previous || frame.length < 2) return;
    let energy = 0, change = 0;
    for (let i = 1; i < frame.length; i++) {
      energy += frame[i] * frame[i];
      const delta = frame[i] - frame[i - 1];
      change += delta * delta;
    }
    if (Math.sqrt(energy / frame.length) < 0.02) return;
    // 40 ms window, averaged down to 12 kHz: enough periods for 70 Hz voices, at a quarter of the cost.
    const window = new Float32Array(Math.floor((previous.length + frame.length) / 2));
    for (let i = 0; i < window.length; i++) {
      const at = i * 2;
      const first = at < previous.length ? previous[at] : frame[at - previous.length];
      const second = at + 1 < previous.length ? previous[at + 1] : frame[at + 1 - previous.length];
      window[i] = (first + second) / 2;
    }
    const pitch = estimatePitch(window);
    if (pitch === null || pitch < 70 || pitch > 400) return;
    this.pitches.push(pitch);
    this.brightness += Math.min(1, Math.sqrt(change / energy) / 2);
  }
  get voicedSeconds() {
    return this.pitches.length * 0.02;
  }
  features(minSeconds = 0.8): VoiceFeatures | null {
    if (this.voicedSeconds < minSeconds || !this.pitches.length) return null;
    const sorted = [...this.pitches].sort((a, b) => a - b);
    const at = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
    return {
      medianPitchHz: Math.round(at(0.5)),
      pitchRangeSemitones: Math.round(12 * Math.log2(at(0.9) / at(0.1)) * 10) / 10,
      brightness: Math.round((this.brightness / this.pitches.length) * 100) / 100,
      voicedSeconds: Math.round(this.voicedSeconds * 10) / 10,
    };
  }
}
