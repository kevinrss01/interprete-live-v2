import type { Language } from "./languages";
export type SpeakerId = "a" | "b";
export type Phase =
  "idle" | "connecting" | "listening" | "finishing" | "translating" | "playing";
export type CloneStatus =
  "off" | "collecting" | "creating" | "ready" | "verification" | "error";
export type Profile = {
  id: SpeakerId;
  name: string;
  language: Language;
  voice: string;
  voiceLabel?: string;
  cloneVoice?: string;
  consent: boolean;
  consentId?: string;
  cloneStatus: CloneStatus;
  sampleSeconds: number;
  cloneError?: string;
};
export type Metrics = {
  translationMs?: number;
  gateMs?: number;
  ttsFirstMs?: number;
  readyMs?: number;
  playbackMs?: number;
  firstAudioMs?: number;
};
export type Turn = {
  id: string;
  speaker: SpeakerId;
  sourceLanguage: Language;
  targetLanguage: Language;
  source: string;
  translation: string;
  status: "draft" | "working" | "done" | "error";
  audioUrl?: string;
  metrics: Metrics;
  error?: string;
  demo?: boolean;
};
export type HistoryItem = {
  source: string;
  translation: string;
  sourceLanguage: string;
  targetLanguage: string;
  continuation?: boolean;
};
export type InterpretationEvent =
  | { type: "text"; delta: string }
  | {
      type: "gate";
      decision: "ready" | "wait" | "final";
      probability: number | null;
      elapsedMs: number;
      unavailable?: boolean;
    }
  | { type: "audio"; audio: string; sampleRate: 24000 }
  | { type: "done"; text: string; spoken: boolean; metrics: Metrics }
  | { type: "error"; message: string; code: string };
