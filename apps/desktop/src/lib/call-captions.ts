import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import type { Turn } from "@interprete/shared/contracts";
import type { OverlayInvoke } from "./translation-overlay";

export type CaptionLine = { id: string; text: string; live: boolean };
export type CaptionsStatus = "idle" | "starting" | "listening" | "preview";
export type CaptionsUpdate = {
  sessionId: string | null;
  status: CaptionsStatus;
  source: string;
  target: string;
  lines: CaptionLine[];
};
export type CaptionsSnapshot = CaptionsUpdate & { revision: number };
export const idleCaptions: CaptionsUpdate = {
  sessionId: null,
  status: "idle",
  source: "",
  target: "",
  lines: [],
};
// A turn holds at most 30 s of speech; the window shows its last lines.
const MAX_CHARACTERS = 1500;

// Keeps the end of an unusually long turn, starting on a word.
export function captionTail(text: string, limit = MAX_CHARACTERS) {
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean.length <= limit) return clean;
  const tail = clean.slice(-limit);
  const space = tail.indexOf(" ");
  return "…" + (space >= 0 && space < 40 ? tail.slice(space + 1) : tail);
}
// The two most recent translated passages of the current session; the latest may still grow.
export function captionLines(turns: Turn[]): CaptionLine[] {
  return turns
    .filter((turn) => turn.translation.trim())
    .slice(-2)
    .map((turn) => ({
      id: turn.id,
      text: captionTail(turn.translation),
      live: turn.status === "draft" || turn.status === "working",
    }));
}
// Appended words animate in as "fresh" spans; older ones settle into one static span.
// A revised caption starts a new version and is drawn again.
export type CaptionText = {
  version: number;
  settled: string;
  fresh: { key: number; text: string }[];
  nextKey: number;
};
export const emptyCaptionText: CaptionText = { version: 0, settled: "", fresh: [], nextKey: 0 };
export function nextCaptionText(current: CaptionText, text: string): CaptionText {
  const shown = current.settled + current.fresh.map((part) => part.text).join("");
  if (text === shown) return current;
  if (shown && text.startsWith(shown)) {
    const fresh = [...current.fresh, { key: current.nextKey, text: text.slice(shown.length) }];
    const settled = fresh.length > 8 ? current.settled + fresh.shift()!.text : current.settled;
    return { ...current, settled, fresh, nextKey: current.nextKey + 1 };
  }
  return {
    version: current.version + (shown ? 1 : 0),
    settled: "",
    fresh: [{ key: current.nextKey, text }],
    nextKey: current.nextKey + 1,
  };
}
export function newestCaptions(
  current: CaptionsSnapshot | null,
  incoming: CaptionsSnapshot,
) {
  return current && current.revision > incoming.revision ? current : incoming;
}

// Text streams in many small deltas. Only the newest state matters, so pending updates collapse.
export class CaptionsPublisher {
  private pending: CaptionsUpdate | null = null;
  private running = false;
  constructor(
    private onError: (message: string) => void,
    private call: OverlayInvoke = invoke,
  ) {}
  publish(update: CaptionsUpdate | null) {
    this.pending = update ?? idleCaptions;
    if (!this.running) void this.flush();
  }
  private async flush() {
    this.running = true;
    while (this.pending) {
      const update = this.pending;
      this.pending = null;
      try {
        await this.call<void>("set_call_captions", { update });
      } catch (error) {
        this.onError(`Les sous-titres n’ont pas pu être affichés : ${String(error)}`);
      }
    }
    this.running = false;
  }
}
// One owner publishes the native captions window; it closes when the owner unmounts.
export function useCallCaptions(
  update: CaptionsUpdate | null,
  onError: (message: string) => void,
) {
  const native = isTauri();
  const [publisher] = useState(() => new CaptionsPublisher(onError));
  const serialized = JSON.stringify(update ?? idleCaptions);
  useEffect(() => {
    if (native) publisher.publish(JSON.parse(serialized) as CaptionsUpdate);
  }, [native, publisher, serialized]);
  useEffect(
    () => () => {
      if (native) publisher.publish(null);
    },
    [native, publisher],
  );
}
export const getCaptions = () => invoke<CaptionsSnapshot>("call_captions_snapshot");
export const onCaptions = (listener: (state: CaptionsSnapshot) => void) =>
  listen<CaptionsSnapshot>("call-captions-state", (event) => listener(event.payload));

const PREVIEW: Record<string, string[]> = {
  fr: [
    "Bonjour à tous, merci d’être là aujourd’hui.",
    "Commençons par un rapide tour de table, puis nous verrons le planning.",
  ],
  en: [
    "Hi everyone, thanks for joining today.",
    "Let’s start with a quick round of introductions, then review the schedule.",
  ],
  es: [
    "Hola a todos, gracias por estar aquí hoy.",
    "Empecemos con una breve ronda de presentaciones y luego veamos el calendario.",
  ],
  de: [
    "Hallo zusammen, danke, dass ihr heute dabei seid.",
    "Beginnen wir mit einer kurzen Vorstellungsrunde und schauen dann auf den Zeitplan.",
  ],
};
// A local, provider-free preview: two sentences revealed word by word, like live speech.
export function previewFrames(language: string) {
  const sentences = PREVIEW[language] ?? PREVIEW.en;
  const frames: CaptionLine[][] = [];
  sentences.forEach((sentence, index) => {
    const words = sentence.split(" ");
    const done = sentences.slice(0, index).map((text, line) => ({
      id: `preview-${line}`,
      text,
      live: false,
    }));
    for (let count = 1; count <= words.length; count++)
      frames.push([
        ...done,
        { id: `preview-${index}`, text: words.slice(0, count).join(" "), live: count < words.length },
      ].slice(-2));
  });
  return frames;
}
