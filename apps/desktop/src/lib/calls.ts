import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AudioPlayer, bytesToBase64 } from "./audio";
import { APP_MICROPHONE_NAME } from "./call-preferences";

export type DetectedCall = { id: string; app: string; simulated: boolean };
// Their speech as captions and/or a translated voice on this Mac; the user's microphone into the call.
export type CallOptions = { captions: boolean; voice: boolean; microphone: boolean };
export type AcceptedCall = DetectedCall & { options: CallOptions };
const optionsKey = "interprete-call-options-v1";
// Captions start enabled. The microphone route stays on for people who already configured it.
export function loadCallOptions(): CallOptions {
  const fallback = {
    captions: true,
    voice: false,
    microphone: Boolean(storedPreference("interprete-call-input-label")),
  };
  try {
    const saved = JSON.parse(localStorage.getItem(optionsKey) || "null");
    if (!saved || typeof saved !== "object") return fallback;
    const read = (key: keyof CallOptions) =>
      typeof saved[key] === "boolean" ? saved[key] : fallback[key];
    return { captions: read("captions"), voice: read("voice"), microphone: read("microphone") };
  } catch {
    return fallback;
  }
}
export function saveCallOptions(options: CallOptions) {
  try {
    localStorage.setItem(optionsKey, JSON.stringify(options));
  } catch {}
}
function storedPreference(key: string) {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
// The toast window reads the languages the main window saved, without its own controller.
export function storedLanguages() {
  try {
    const profiles = JSON.parse(localStorage.getItem("interprete-profiles-v1") || "null");
    const read = (id: "a" | "b", fallback: string) =>
      typeof profiles?.[id]?.language === "string" ? profiles[id].language : fallback;
    return { mine: read("a", "fr"), theirs: read("b", "en") };
  } catch {
    return { mine: "fr", theirs: "en" };
  }
}
// Explicit native route to the Mac's current output, used only for a participant's translated voice.
export const SYSTEM_OUTPUT = "@system-output";
export type CallSnapshot = {
  supported: boolean;
  enabled: boolean;
  call: DetectedCall | null;
  accepted: boolean;
  dismissed: boolean;
  error: string | null;
};
export type OutputDevice = {
  name: string;
  virtualMic: boolean;
  appMic?: boolean;
  uid?: string;
};
export const desktopAvailable = () => isTauri();
export const callSnapshot = () => invoke<CallSnapshot>("call_snapshot");
export const enableCallMonitor = (enabled: boolean) =>
  invoke("call_monitor_enabled", { enabled });
export const simulateCall = () => invoke("simulate_call");
export const answerCall = (
  callId: string,
  accept: boolean,
  options: CallOptions,
) => invoke("answer_call", { callId, accept, options });
export const endSimulatedCall = () => invoke("end_simulated_call");
export const physicalInputNames = () =>
  invoke<string[]>("audio_physical_inputs");
export const outputDevices = () => invoke<OutputDevice[]>("audio_outputs");
export const onCallStatus = (fn: (status: CallSnapshot) => void) =>
  listen<CallSnapshot>("call-status", (e) => fn(e.payload));
export const onCallAccepted = (fn: (call: AcceptedCall) => void) =>
  listen<AcceptedCall>("call-accepted", (e) => fn(e.payload));
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
      d.label !== APP_MICROPHONE_NAME &&
      (!nativeNames || nativeNames.includes(d.label)) &&
      !/blackhole|loopback|virtual|aggregate|parrot|motiv mix|microsoft teams audio/i.test(
        d.label,
      ),
  );
}
// The name System Settings shows: browsers may add a "Default - " prefix, "(Built-in)" or a USB vendor:product id.
export function microphoneName(label: string) {
  return label
    .replace(/^(default|communications)\s*-\s*/i, "")
    .replace(/\s*\(([0-9a-f]{4}:[0-9a-f]{4}|built-in)\)$/i, "")
    .trim();
}
export function requirePhysicalMicrophone(
  devices: MediaDeviceInfo[],
  id: string,
  nativeNames?: string[],
) {
  if (!physicalMicrophones(devices, nativeNames).some((d) => d.deviceId === id))
    throw new Error(
      "Choose your physical microphone. Refresh and allow microphone access if the list is empty.",
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
  private holdOpen = false;
  setHoldOpen(hold: boolean) { this.holdOpen = hold; }
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
  private get label() {
    return this.name === SYSTEM_OUTPUT ? "The Mac audio output" : "The virtual output";
  }
  get pendingSeconds() {
    return Math.max(0, (this.endAt - performance.now()) / 1000);
  }
  async unlock() {
    if (this.id) { await this.tail; return; }
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
    const generation = this.generation;
    if (this.failure) return Promise.reject(this.failure);
    if (!id)
      return Promise.reject(new Error(`${this.label} is not ready.`));
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
          if (this.id !== id || this.generation !== generation || this.failure) return;
          if (this.pendingSeconds > 5.5) {
            while (this.id === id && this.generation === generation) {
              const status = await this.call<NativeStatus>(
                "audio_route_status",
                { id },
              );
              if (status.failed)
                throw new Error(`${this.label} was disconnected.`);
              this.endAt = performance.now() + status.pendingSeconds * 1000;
              if (status.pendingSeconds <= 5.5) break;
              await new Promise((resolve) => setTimeout(resolve, 40));
            }
          }
          if (this.id !== id || this.generation !== generation) return;
          const chunk = packet.subarray(at, at + 24000);
          await this.call("audio_route_push", {
            id,
            audio: bytesToBase64(chunk),
          });
          if (this.id !== id || this.generation !== generation) return;
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
        if (this.id !== id || this.generation !== generation) return;
        this.failure = new Error(String(error));
        this.failed(this.failure.message);
        this.holdOpen = false;
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
        throw new Error(`${this.label} was disconnected.`);
      if (status.pendingSeconds === 0) {
        this.endAt = 0;
        this.setActive(false);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    if (this.failure) throw this.failure;
  }
  async activateSystemMicrophone() {
    const id = this.id;
    if (!id) throw new Error("The translation output is stopped.");
    await this.call("audio_route_activate", { id });
  }
  stop() {
    const generation = ++this.generation;
    const id = this.id;
    const keepOpen = this.holdOpen && !this.failure;
    if (!keepOpen) this.id = null;
    this.endAt = 0;
    this.carry = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.setActive(false);
    if (id)
      this.tail = this.tail
        .then(() => this.call(keepOpen ? "audio_route_clear" : "audio_route_close", { id }))
        .then(
          () => {},
          (error: unknown) => {
            if (this.generation === generation) {
              if (keepOpen) {
                this.failure = new Error(String(error));
                this.holdOpen = false;
                this.stop();
              }
              this.failed(String(error));
            }
          },
        );
  }
  dispose() {
    this.holdOpen = false;
    this.stop();
  }
  async play(_url: string, _signal: AbortSignal): Promise<void> {
    throw new Error(
      "Replay is available in conversation mode, on the speakers.",
    );
  }
}
export class CallAudioPlayer {
  private player: AudioPlayer | NativePcmPlayer = new AudioPlayer();
  private listener = (_active: boolean) => {};
  constructor(private failed: (message: string) => void) {}
  setHoldOpen(hold: boolean) {
    if (this.player instanceof NativePcmPlayer) this.player.setHoldOpen(hold);
  }
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
  async activateSystemMicrophone() {
    if (this.player instanceof NativePcmPlayer)
      await this.player.activateSystemMicrophone();
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
