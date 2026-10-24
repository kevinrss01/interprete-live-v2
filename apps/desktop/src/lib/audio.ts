export function bytesToBase64(bytes: Uint8Array) {
  let text = "";
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
  return btoa(text);
}
export function base64ToBytes(value: string) {
  const raw = atob(value),
    bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
export function makeWav(chunks: Uint8Array[], sampleRate = 24000) {
  const size = chunks.reduce((n, c) => n + c.byteLength, 0),
    buffer = new ArrayBuffer(44 + size),
    v = new DataView(buffer);
  const write = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  write(0, "RIFF");
  v.setUint32(4, 36 + size, true);
  write(8, "WAVE");
  write(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  write(36, "data");
  v.setUint32(40, size, true);
  const out = new Uint8Array(buffer);
  let at = 44;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return new Blob([buffer], { type: "audio/wav" });
}
export class AudioPlayer {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private volume = 1;
  private nextAt = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private carry: Uint8Array | null = null;
  private onActivity: (active: boolean) => void = () => {};
  private active = false;
  private setActive(active: boolean) {
    if (active === this.active) return;
    this.active = active;
    this.onActivity(active);
  }
  setActivityListener(listener: (active: boolean) => void) {
    this.onActivity = listener;
  }
  get pendingSeconds() {
    return this.context ? Math.max(0, this.nextAt - this.context.currentTime) : 0;
  }
  async unlock() {
    this.context ??= new AudioContext({
      sampleRate: 24000,
      latencyHint: "interactive",
    });
    if (this.context.state === "suspended") await this.context.resume();
    this.ensureGain();
  }
  setVolume(value: number) {
    this.volume = Math.min(1, Math.max(0, value));
    if (this.gain && this.context)
      this.gain.gain.setValueAtTime(this.volume, this.context.currentTime);
  }
  private ensureGain() {
    if (!this.context) return null;
    if (!this.gain) {
      this.gain = this.context.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.context.destination);
    }
    return this.gain;
  }
  // Capture must reuse this context. A second one stays silent in the desktop webview.
  sharedContext() {
    if (!this.context) throw new Error("Audio output is not unlocked.");
    return this.context;
  }
  enqueue(input: Uint8Array) {
    const ctx = this.context;
    if (!ctx || ctx.state === "closed")
      throw new Error("Clique sur le bouton de lecture pour activer le son.");
    if (ctx.state === "suspended") {
      void ctx.resume().then(() => {
        if (this.context === ctx && ctx.state === "running") this.enqueue(input);
      });
      return null;
    }
    let bytes = input;
    if (this.carry) {
      bytes = new Uint8Array(this.carry.length + input.length);
      bytes.set(this.carry);
      bytes.set(input, this.carry.length);
      this.carry = null;
    }
    if (bytes.length % 2) {
      this.carry = bytes.slice(-1);
      bytes = bytes.slice(0, -1);
    }
    if (!bytes.length) return null;
    const audio = ctx.createBuffer(1, bytes.length / 2, 24000),
      channel = audio.getChannelData(0),
      view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let first = -1;
    for (let i = 0; i < channel.length; i++) {
      channel[i] = view.getInt16(i * 2, true) / 32768;
      if (first < 0 && Math.abs(channel[i]) > 0.015) first = i;
    }
    const source = ctx.createBufferSource();
    source.buffer = audio;
    source.connect(this.ensureGain()!);
    const start = Math.max(ctx.currentTime + 0.025, this.nextAt);
    source.start(start);
    this.nextAt = start + audio.duration;
    this.sources.add(source);
    this.setActive(true);
    source.onended = () => {
      this.sources.delete(source);
      if (!this.sources.size) this.setActive(false);
    };
    return first < 0
      ? null
      : performance.now() + (start - ctx.currentTime + first / 24000) * 1000;
  }
  async idle(signal?: AbortSignal) {
    while (this.context && this.sources.size) {
      if (signal?.aborted) return;
      await new Promise((r) => setTimeout(r, 60));
    }
  }
  stop() {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {}
    }
    this.sources.clear();
    this.nextAt = 0;
    this.carry = null;
    this.setActive(false);
  }
  async play(url: string, signal: AbortSignal) {
    await this.unlock();
    signal.throwIfAborted();
    this.stop();
    const ctx = this.context!;
    const response = await fetch(url, { signal });
    const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
    signal.throwIfAborted();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ensureGain()!);
    this.sources.add(source);
    this.setActive(true);
    source.onended = () => {
      this.sources.delete(source);
      if (!this.sources.size) this.setActive(false);
    };
    source.start();
    await this.idle(signal);
  }
  dispose() {
    this.stop();
    void this.context?.close();
    this.context = null;
    this.gain = null;
  }
}

export type CaptureOptions = {
  onAudio: (bytes: Uint8Array) => void;
  onLevel: (level: number) => void;
  onBoundary?: () => void;
  onEnded: () => void;
  onError: (message: string) => void;
  recordSample: boolean;
  shouldRecordSample?: () => boolean;
  onSample?: (sample: { blob: Blob; seconds: number }) => void;
  demoUrl?: string;
  deviceId?: string;
  echoCancellation?: boolean;
  context?: AudioContext;
};
export class MicrophoneCapture {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private source: AudioNode | null = null;
  private sampleChunks: Uint8Array[] = [];
  private sampleBytes = 0;
  private lastSpeech = 0;
  private boundarySent = false;
  private stopped = false;
  private flushResolve: (() => void) | null = null;
  private stopPromise: Promise<{ blob: Blob; seconds: number } | null> | null =
    null;
  private outputActive = false;
  private cleanSpeechMs = 0;
  private lastLevelAt = 0;
  private ownsContext = false;
  constructor(private options: CaptureOptions) {}
  setOutputActive(active: boolean) {
    this.outputActive = active;
  }
  private takeSample() {
    const sample = this.sampleChunks.length
      ? { blob: makeWav(this.sampleChunks), seconds: this.cleanSpeechMs / 1000 }
      : null;
    this.sampleChunks = [];
    this.sampleBytes = 0;
    this.cleanSpeechMs = 0;
    return sample;
  }
  private sample(bytes: Uint8Array, speech: boolean, now: number) {
    if (!this.options.recordSample || this.options.shouldRecordSample?.() === false) {
      this.takeSample();
      return;
    }
    // This only selects a cloning sample. ASR always receives every frame,
    // including frames captured while translated speech is playing.
    if (!this.outputActive && (speech || (this.sampleChunks.length && now - this.lastSpeech < 180))) {
      this.sampleChunks.push(bytes);
      this.sampleBytes += bytes.length;
      if (speech) this.cleanSpeechMs += bytes.length / 48;
    }
    if (this.cleanSpeechMs >= 10_000 || this.sampleBytes >= 15 * 48_000) {
      const sample = this.takeSample();
      if (sample && sample.seconds >= 1) this.options.onSample?.(sample);
    }
  }
  async start() {
    if (this.options.context) {
      this.ctx = this.options.context;
    } else {
      this.ctx = new AudioContext({
        sampleRate: 24000,
        latencyHint: "interactive",
      });
      this.ownsContext = true;
    }
    await this.ctx.resume();
    if (this.stopped) return;
    await this.ctx.audioWorklet.addModule("/audio-capture.js");
    if (this.stopped) return;
    this.node = new AudioWorkletNode(this.ctx, "speech-capture");
    this.node.port.onmessage = (e) => {
      if (e.data?.type === "flushed") {
        this.flushResolve?.();
        return;
      }
      if (e.data?.type !== "audio" || this.stopped) return;
      const rms = Number(e.data.rms) || 0;
      const bytes = new Uint8Array(e.data.pcm);
      this.options.onAudio(bytes);
      const now = performance.now();
      if (now - this.lastLevelAt >= 80) {
        this.lastLevelAt = now;
        this.options.onLevel(Math.min(1, rms * 8));
      }
      if (rms > 0.014) {
        this.lastSpeech = now;
        this.boundarySent = false;
      } else if (this.lastSpeech && now - this.lastSpeech > 450 && !this.boundarySent) {
        this.boundarySent = true;
        this.options.onBoundary?.();
      }
      this.sample(bytes, rms > 0.014, now);
    };
    this.node.connect(this.ctx.destination);
    if (this.options.demoUrl) {
      const response = await fetch(this.options.demoUrl);
      if (!response.ok)
        throw new Error("L’exemple audio n’est pas disponible.");
      if (this.stopped) return;
      const buffer = await this.ctx.decodeAudioData(
        await response.arrayBuffer(),
      );
      if (this.stopped) return;
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.node);
      source.onended = () => {
        if (!this.stopped) this.options.onEnded();
      };
      this.source = source;
      source.start();
    } else {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(this.options.deviceId ? { deviceId: { exact: this.options.deviceId } } : {}),
          channelCount: 1,
          echoCancellation: this.options.echoCancellation ?? true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      if (this.stopped) {
        this.stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const track = this.stream.getAudioTracks()[0];
      if (track) track.onended = () => {
        if (!this.stopped) this.options.onError("Le microphone a été déconnecté.");
      };
      const modes = track?.getCapabilities?.().echoCancellation as unknown;
      if (this.options.echoCancellation !== false && Array.isArray(modes) && modes.includes("all")) {
        await track
          .applyConstraints({
            echoCancellation: { exact: "all" },
          } as unknown as MediaTrackConstraints)
          .catch(() => {});
        if (this.stopped) {
          this.stream.getTracks().forEach((t) => t.stop());
          return;
        }
      }
      this.source = this.ctx.createMediaStreamSource(this.stream);
      this.source.connect(this.node);
    }
  }
  stop() {
    this.stopPromise ??= this.finish();
    return this.stopPromise;
  }
  private async finish() {
    if (this.stopped) return null;
    if (this.node) {
      await Promise.race([
        new Promise<void>((resolve) => {
          this.flushResolve = resolve;
          this.node!.port.postMessage({ type: "flush" });
        }),
        new Promise<void>((r) => setTimeout(r, 120)),
      ]);
    }
    this.stopped = true;
    const sample = this.takeSample();
    this.source?.disconnect();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.ownsContext) await this.ctx?.close();
    this.ctx = null;
    this.options.onLevel(0);
    return sample;
  }
}
