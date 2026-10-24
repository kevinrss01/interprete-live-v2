import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AudioPlayer, bytesToBase64 } from "./audio";

export type DetectedCall = { id: string; app: string; simulated: boolean };
export type CallSnapshot = {
  supported: boolean;
  enabled: boolean;
  call: DetectedCall | null;
  accepted: boolean;
  dismissed: boolean;
  error: string | null;
};
export type OutputDevice = { name: string; virtualMic: boolean };
export const desktopAvailable = () => isTauri();
export const callSnapshot = () => invoke<CallSnapshot>("call_snapshot");
export const enableCallMonitor = (enabled: boolean) =>
  invoke("call_monitor_enabled", { enabled });
export const simulateCall = () => invoke("simulate_call");
export const answerCall = (callId: string, accept: boolean) =>
  invoke("answer_call", { callId, accept });
export const endSimulatedCall = () => invoke("end_simulated_call");
export const physicalInputNames = () =>
  invoke<string[]>("audio_physical_inputs");
export const outputDevices = () => invoke<OutputDevice[]>("audio_outputs");
export const onCallStatus = (fn: (status: CallSnapshot) => void) =>
  listen<CallSnapshot>("call-status", (e) => fn(e.payload));
export const onCallAccepted = (fn: (call: DetectedCall) => void) =>
  listen<DetectedCall>("call-accepted", (e) => fn(e.payload));
export function physicalMicrophones(
  devices: MediaDeviceInfo[],
  nativeNames?: string[],
) {
  return devices.filter(
    (d) =>
      d.kind === "audioinput" &&
      d.deviceId !== "default" &&
      d.deviceId !== "communications" &&
      d.label &&
      (!nativeNames || nativeNames.includes(d.label)) &&
      !/blackhole|loopback|virtual|aggregate|parrot|motiv mix|microsoft teams audio/i.test(
        d.label,
      ),
  );
}
export function requirePhysicalMicrophone(
  devices: MediaDeviceInfo[],
  id: string,
  nativeNames?: string[],
) {
  if (!physicalMicrophones(devices, nativeNames).some((d) => d.deviceId === id))
    throw new Error(
      "Choisissez votre microphone physique. Actualisez et autorisez le micro si la liste est vide.",
    );
}

type NativeStatus = { pendingSeconds: number; failed: boolean };
export type NativeInvoke = <T>(
  command: string,
  args: Record<string, unknown>,
) => Promise<T>;
// PCM packets go directly to CoreAudio; no WebView sink selection or speaker fallback.
export class NativePcmPlayer {
  private id: string | null = null;
  private generation = 0;
  private tail = Promise.resolve();
  private endAt = 0;
  private activity = (_active: boolean) => {};
  private active = false;
  private setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    this.activity(active);
  }
  private failure: Error | null = null;
  private carry: Uint8Array | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(
    private name: string,
    private failed: (message: string) => void,
    private call: NativeInvoke = invoke,
  ) {}
  setActivityListener(fn: (active: boolean) => void) {
    this.activity = fn;
  }
  get pendingSeconds() {
    return Math.max(0, (this.endAt - performance.now()) / 1000);
  }
  async unlock() {
    if (this.id) return;
    const generation = ++this.generation;
    const id = crypto.randomUUID();
    this.failure = null;
    const open = this.tail.then(async () => {
      if (generation !== this.generation) return;
      await this.call("audio_route_open", { id, name: this.name });
      if (generation !== this.generation) {
        await this.call("audio_route_close", { id });
        return;
      }
      this.id = id;
    });
    this.tail = open.catch(() => {});
    await open;
  }
  enqueue(input: Uint8Array): Promise<null> {
    const id = this.id;
    if (this.failure) return Promise.reject(this.failure);
    if (!id)
      return Promise.reject(new Error("La sortie virtuelle n’est pas prête."));
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
    const packet = bytes;
    this.tail = this.tail
      .then(async () => {
        // Split large provider messages and pause SSE consumption as the actual hardware queue fills.
        for (let at = 0; at < packet.length; at += 24000) {
          if (this.id !== id || this.failure) return;
          if (this.pendingSeconds > 5.5) {
            while (this.id === id) {
              const status = await this.call<NativeStatus>(
                "audio_route_status",
                { id },
              );
              if (status.failed)
                throw new Error("La sortie virtuelle a été déconnectée.");
              this.endAt = performance.now() + status.pendingSeconds * 1000;
              if (status.pendingSeconds <= 5.5) break;
              await new Promise((resolve) => setTimeout(resolve, 40));
            }
          }
          if (this.id !== id) return;
          const chunk = packet.subarray(at, at + 24000);
          await this.call("audio_route_push", {
            id,
            audio: bytesToBase64(chunk),
          });
          if (this.id !== id) return;
          this.endAt =
            Math.max(performance.now(), this.endAt) + chunk.length / 48;
          this.setActive(true);
          if (!this.timer)
            this.timer = setInterval(() => {
              if (this.pendingSeconds === 0) {
                this.setActive(false);
                if (this.timer) clearInterval(this.timer);
                this.timer = null;
              }
            }, 60);
        }
      })
      .catch((error: unknown) => {
        if (this.id !== id) return;
        this.failure = new Error(String(error));
        this.failed(this.failure.message);
        this.stop();
      });
    // The controller awaits delivery, applying backpressure within a long segment as well as between segments.
    return this.tail.then(() => {
      if (this.failure) throw this.failure;
      return null;
    });
  }
  async idle(signal?: AbortSignal) {
    const id = this.id;
    await this.tail;
    while (this.id === id && id && !signal?.aborted) {
      if (this.failure) throw this.failure;
      const status = await this.call<NativeStatus>("audio_route_status", {
        id,
      });
      if (status.failed)
        throw new Error("La sortie virtuelle a été déconnectée.");
      if (status.pendingSeconds === 0) {
        this.endAt = 0;
        this.setActive(false);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    if (this.failure) throw this.failure;
  }
  stop() {
    ++this.generation;
    const id = this.id;
    this.id = null;
    this.endAt = 0;
    this.carry = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.setActive(false);
    if (id)
      this.tail = this.tail
        .then(() => this.call("audio_route_close", { id }))
        .then(
          () => {},
          () => {},
        );
  }
  dispose() {
    this.stop();
  }
  async play(_url: string, _signal: AbortSignal): Promise<void> {
    throw new Error(
      "La réécoute est disponible dans le mode conversation, sur les haut-parleurs.",
    );
  }
}
export class CallAudioPlayer {
  private player: AudioPlayer | NativePcmPlayer = new AudioPlayer();
  private listener = (_active: boolean) => {};
  constructor(private failed: (message: string) => void) {}
  configure(output: string | null) {
    this.player.dispose();
    this.player = output
      ? new NativePcmPlayer(output, this.failed)
      : new AudioPlayer();
    this.player.setActivityListener(this.listener);
  }
  get pendingSeconds() {
    return this.player.pendingSeconds;
  }
  setActivityListener(fn: (active: boolean) => void) {
    this.listener = fn;
    this.player.setActivityListener(fn);
  }
  unlock() {
    return this.player.unlock();
  }
  enqueue(bytes: Uint8Array) {
    return this.player.enqueue(bytes);
  }
  idle(signal?: AbortSignal) {
    return this.player.idle(signal);
  }
  stop() {
    this.player.stop();
  }
  play(url: string, signal: AbortSignal) {
    return this.player.play(url, signal);
  }
  dispose() {
    this.player.dispose();
  }
}
