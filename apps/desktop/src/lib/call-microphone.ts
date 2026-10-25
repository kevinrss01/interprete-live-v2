import { invoke } from "@tauri-apps/api/core";

export type CallMicrophoneState = {
  supported: boolean;
  muted: boolean | null;
  permissionRequired: boolean;
};
export type MicrophoneSyncStatus = { paused: boolean; notice: string | null; permissionRequired?: boolean };
export const callMicrophoneState = (source: string) =>
  invoke<CallMicrophoneState>("call_microphone_state", { source });
export const openCallPermissions = (kind: "audio" | "accessibility" | "microphone") =>
  invoke<void>("open_call_permissions", { kind });

// Meet keeps the physical microphone open while muted. Its UI action is the source of truth,
// not CoreAudio's "running input" flag. Unknown state pauses processing, just like mute.
export class CallMicrophoneSync {
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private attempt = 0;
  active = false;
  constructor(private adapters: {
    read: () => Promise<CallMicrophoneState>;
    resume: (current: () => boolean) => Promise<void>;
    pause: () => void;
    changed: (status: MicrophoneSyncStatus) => void;
    failed: (error: unknown) => void;
    pollMs?: number;
  }) {}
  async start() {
    this.active = true;
    const generation = ++this.generation;
    await this.poll(generation);
  }
  stop() {
    this.active = false;
    ++this.generation;
    ++this.attempt;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.running) this.adapters.pause();
    this.running = false;
  }
  private async poll(generation: number) {
    let state: CallMicrophoneState;
    try { state = await this.adapters.read(); }
    catch { state = { supported: true, muted: null, permissionRequired: false }; }
    if (!this.active || generation !== this.generation) return;
    const paused = state.permissionRequired || (state.supported && state.muted !== false);
    const notice = !state.supported
      ? "Automatic mute synchronization is available for Google Meet in English or French. Stop translation here when muting other calls."
      : state.permissionRequired
        ? "Translation paused. Allow Interprète in System Settings › Privacy & Security › Accessibility to follow Meet’s mute button."
        : state.muted === true
          ? "Translation paused while your microphone is muted in Meet."
          : state.muted === null
            ? "Translation paused. Keep the Meet tab open so its microphone state can be checked."
            : null;
    this.adapters.changed({ paused, notice, permissionRequired: state.permissionRequired });
    if (paused && this.running) {
      this.running = false;
      ++this.attempt;
      this.adapters.pause();
    } else if (!paused && !this.running) {
      this.running = true;
      const attempt = ++this.attempt;
      const current = () => this.active && this.running && generation === this.generation && attempt === this.attempt;
      // Polling continues during ASR startup, so a mute can cancel it immediately.
      void this.adapters.resume(current).catch((error: unknown) => {
        if (!current()) return;
        this.stop();
        this.adapters.failed(error);
      });
    }
    if (state.supported && this.active && generation === this.generation)
      this.timer = setTimeout(() => void this.poll(generation), this.adapters.pollMs ?? 250);
  }
}
