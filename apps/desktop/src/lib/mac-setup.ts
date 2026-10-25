import { invoke, isTauri } from "@tauri-apps/api/core";
import { openCallPermissions } from "./call-microphone";

export type MacSetupStatus = {
  supported: boolean;
  microphone: "granted" | "not-determined" | "denied" | "restricted" | "unknown";
  accessibility: boolean;
  driverInstalled: boolean;
  driverReady: boolean;
  virtualMicrophone: boolean;
};
export type SetupAction = "microphone" | "audio" | "virtual-microphone" | "install-driver" | "accessibility" | "audio-settings" | "microphone-settings";
export type AudioEvidence = "confirmed" | "verified" | null;
type SetupDecision = "ready" | "later";
const decisionKey = "interprete-mac-setup-v1";
const audioKey = "interprete-system-audio-setup-v1";
let sessionDecision: SetupDecision | null = null;
let sessionAudio: AudioEvidence = null;
function stored(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
export function setupDecision(): SetupDecision | null {
  const value = stored(decisionKey);
  return value === "ready" || value === "later" ? value : sessionDecision;
}
export function saveSetupDecision(value: SetupDecision) {
  sessionDecision = value;
  try { localStorage.setItem(decisionKey, value); } catch { /* Continue for this session when storage is unavailable. */ }
}
export function systemAudioEvidence(): AudioEvidence {
  const value = stored(audioKey);
  return value === "confirmed" || value === "verified" ? value : sessionAudio;
}
export function noteSystemAudio(value: Exclude<AudioEvidence, null>) {
  if (systemAudioEvidence() === "verified" && value === "confirmed") return;
  sessionAudio = value;
  try { localStorage.setItem(audioKey, value); } catch { /* The current session still knows the result. */ }
}
export function resetSystemAudioEvidence() {
  sessionAudio = null;
  try { localStorage.removeItem(audioKey); } catch { /* Reconfirmation still works for this session. */ }
}
export type SetupNeeds = { microphone?: boolean; audio?: boolean; virtualMicrophone?: boolean; accessibility?: boolean };
export const allSetupNeeds: SetupNeeds = { microphone: true, audio: true, virtualMicrophone: true, accessibility: true };
export function missingSetup(status: MacSetupStatus, audio: AudioEvidence, needs: SetupNeeds = allSetupNeeds) {
  if (!status.supported) return ["macOS 14.2 or later"];
  return [
    needs.microphone && status.microphone !== "granted" && "Microphone access",
    needs.audio && !audio && "Call audio access",
    needs.accessibility && !status.accessibility && "Meet mute synchronization",
    needs.virtualMicrophone && !(status.driverReady && status.virtualMicrophone) && "Virtual microphone",
  ].filter((item): item is string => typeof item === "string");
}
export const readMacSetup = () => invoke<MacSetupStatus>("mac_setup_status");
export async function meetingSetupReady(needs: SetupNeeds) {
  if (!isTauri()) return true;
  return missingSetup(await readMacSetup(), systemAudioEvidence(), needs).length === 0;
}
async function runSetupAction(action: SetupAction) {
  if (action === "accessibility") return openCallPermissions("accessibility");
  if (action === "audio-settings") return openCallPermissions("audio");
  if (action === "microphone-settings") return openCallPermissions("microphone");
  await invoke<void>("mac_setup_action", { action });
}

export type SetupState = { status: MacSetupStatus | null; checking: boolean; pending: SetupAction | null; lastAction: SetupAction | null; audioRequested: boolean; error: string | null };
const initial: SetupState = { status: null, checking: true, pending: null, lastAction: null, audioRequested: false, error: null };
// One owner for the setup screen. Background checks never request a permission or install software.
export class MacSetupMonitor {
  private state = initial;
  private listeners = new Set<() => void>();
  private generation = 0;
  private active = false;
  private inFlight: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private actionError = false;
  constructor(private adapters = { read: readMacSetup, run: runSetupAction }) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getSnapshot = () => this.state;
  getServerSnapshot = () => initial;
  private update(patch: Partial<SetupState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()); }
  start() {
    if (this.active) return;
    this.active = true;
    ++this.generation;
    void this.refresh();
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => void this.refresh(), 2000);
  }
  stop() {
    this.active = false;
    ++this.generation;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.inFlight = null;
    this.update({ pending: null, checking: false });
  }
  refresh = (): Promise<void> => {
    if (!this.active) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    const generation = this.generation;
    this.update({ checking: true });
    const pending = Promise.resolve().then(() => this.adapters.read()).then(status => {
      if (this.active && generation === this.generation) this.update({ status, checking: false, error: this.actionError ? this.state.error : null });
    }, (error: unknown) => {
      if (this.active && generation === this.generation)
        this.update({ checking: false, error: error instanceof Error ? error.message : String(error) });
    }).finally(() => { if (this.inFlight === pending) this.inFlight = null; });
    this.inFlight = pending;
    return pending;
  };
  async run(action: SetupAction) {
    if (!this.active || this.state.pending) return;
    const generation = this.generation;
    this.actionError = false;
    this.update({ pending: action, error: null, audioRequested: this.state.audioRequested || action === "audio" || action === "audio-settings" });
    try {
      await this.adapters.run(action);
      if (!this.active || generation !== this.generation) return;
      this.update({ lastAction: action });
      await this.inFlight;
      if (this.active && generation === this.generation) await this.refresh();
    } catch (error) {
      if (this.active && generation === this.generation) {
        this.actionError = true;
        this.update({ error: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      if (this.active && generation === this.generation) this.update({ pending: null });
    }
  }
}
