import type { Phase } from "@interprete/shared/contracts";
import type { ConnectionState } from "./transcription";

export type LiveStatusInput = {
  phase: Phase;
  input: "microphone" | "demo" | null;
  connection: ConnectionState | null;
  outputActive: boolean;
  ready: boolean;
  callBusy: boolean;
  speakerName: string;
};

export function conversationStatus({
  phase,
  input,
  connection,
  outputActive,
  ready,
  callBusy,
  speakerName,
}: LiveStatusInput) {
  const demo = input === "demo";
  if (callBusy) return "Translating the call…";
  if (demo && phase === "listening" && connection === "reconnecting") return "Reconnecting · audio sample";
  if (demo && (phase === "connecting" || phase === "listening")) return "Playing audio sample…";
  if (phase === "connecting") return "Connecting microphone…";
  if (phase === "listening" && connection === "reconnecting") return "Reconnecting · mic on";
  if (phase === "listening" && outputActive) return "Listening and translating…";
  if (phase === "listening") return `${speakerName} is speaking…`;
  if (phase === "finishing") return "Finishing the turn…";
  if (phase === "translating") return "Translating…";
  if (phase === "playing") return "Playing the translation";
  return ready ? "Ready" : "Connecting…";
}

export function microphoneActive(phase: Phase, input: LiveStatusInput["input"]) {
  return phase === "listening" && input === "microphone";
}

export function microphoneLabel(phase: Phase, input: LiveStatusInput["input"]) {
  if (microphoneActive(phase, input)) return "Mic on";
  if (input !== "demo" && phase === "connecting") return "Turning on mic…";
  if (input === "microphone" && phase === "finishing") return "Turning off mic…";
  return "Mic off";
}

export function microphoneHelp(phase: Phase, input: LiveStatusInput["input"]) {
  if (input === "demo") return "The sample uses a recording, not your mic.";
  if (microphoneActive(phase, input)) return "The translation follows your voice. Turn off the mic to finish.";
  if (phase === "idle") return "Turn on the speaker’s mic.";
  if (phase === "connecting") return "Allow microphone access if asked.";
  if (phase === "playing") return "Playing the translation…";
  return "Finishing the translation…";
}

// Idle, playback, and finishing repeat the status line or the talk buttons.
export function microphoneHelpVisible(phase: Phase, input: LiveStatusInput["input"]) {
  return input === "demo" || phase === "listening" || phase === "connecting";
}

export function stopControlLabel(phase: Phase) {
  return phase === "listening" || phase === "connecting" ? "Cancel turn" : "Stop";
}
