import type { Metrics } from "@interprete/shared/contracts";

export type SegmentTrace = {
  id: string;
  text: string;
  translation: string;
  observedAt: number;
  startedAt: number;
  requestedAt?: number;
  textAt?: number;
  displayedAt?: number;
  audioAt?: number;
  playbackAt?: number;
  finishedAt?: number;
  queued: number;
  voice?: string;
  gate?: "ready" | "wait" | "final";
  gateAt?: number;
  gateProbability?: number | null;
  gateUnavailable?: boolean;
  metrics?: Metrics;
  outcome: "running" | "done" | "held" | "superseded" | "cancelled" | "error";
  error?: string;
};
export type DiagnosticEvent = { sessionId: string; at: number } & (
  | { type: "session"; startedAt: number; source: string; target: string; models: Record<string, string> }
  | { type: "input"; seconds: number; queued: number }
  | { type: "input-end" }
  | { type: "transcript" }
  | { type: "segment"; segment: SegmentTrace }
  | { type: "end"; outcome: "done" | "cancelled" | "error"; error?: string }
);
export type BenchmarkConfig = {
  fixture: string;
  direction: "incoming" | "outgoing";
  source: string;
  target: string;
  voice: boolean;
  originalAudible: boolean;
  output: string;
  api: string;
};
export type BenchmarkRun = {
  id: string;
  date: string;
  config: BenchmarkConfig;
  sessionId?: string;
  startedAt: number;
  inputAt?: number;
  inputEndAt?: number;
  transcriptAt?: number;
  endedAt?: number;
  inputSeconds: number;
  models: Record<string, string>;
  segments: SegmentTrace[];
  queue: { at: number; seconds: number }[];
  outcome: "running" | "done" | "cancelled" | "error";
  error?: string;
  truncated: boolean;
  review?: "unreviewed" | "pass" | "issues";
  note?: string;
};
const KEY = "interprete-benchmarks-v1";
const MAX_RUNS = 12, MAX_SEGMENTS = 500, MAX_POINTS = 2400;
export function percentile(values: number[], fraction: number) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))] : null;
}
export function gateSource(segment: SegmentTrace) {
  if (segment.gateUnavailable === true) return "unavailable";
  if (typeof segment.gateProbability === "number") return "jev";
  if (segment.gateProbability === null && segment.gateUnavailable === false && segment.metrics?.gateMs === 0) return "local";
  return "unknown";
}
export function runSummary(run: BenchmarkRun) {
  const origin = run.inputAt;
  const first = (key: "displayedAt" | "playbackAt" | "audioAt") => {
    const times = run.segments.flatMap(s => s[key] === undefined ? [] : [s[key]!]);
    return origin === undefined || !times.length ? null : Math.max(0, Math.min(...times) - origin);
  };
  const requestAudio = run.segments.flatMap(s => s.outcome === "done" && s.requestedAt !== undefined && s.audioAt !== undefined ? [s.audioAt - s.requestedAt] : []);
  return {
    firstCaption: first("displayedAt"), firstPlayback: first("playbackAt"), firstAudio: first("audioAt"),
    requestAudioP50: percentile(requestAudio, .5), requestAudioP90: percentile(requestAudio, .9),
    maxQueue: Math.max(0, ...run.queue.map(p => p.seconds)),
    held: run.segments.filter(s => s.outcome === "held").length,
    jevWait: run.segments.filter(s => s.gate === "wait" && gateSource(s) === "jev").length,
    jevUnavailable: run.segments.filter(s => gateSource(s) === "unavailable").length,
    gateUnknown: run.segments.filter(s => s.gate !== undefined && gateSource(s) === "unknown").length,
    revised: run.segments.filter(s => s.outcome === "superseded").length,
    errors: run.segments.filter(s => s.outcome === "error").length,
  };
}
export function comparable(a: BenchmarkRun, b: BenchmarkRun) {
  return a.outcome === "done" && b.outcome === "done" && !a.truncated && !b.truncated &&
    JSON.stringify(a.config) === JSON.stringify(b.config) && JSON.stringify(a.models) === JSON.stringify(b.models) &&
    a.segments.find(s => s.voice)?.voice === b.segments.find(s => s.voice)?.voice;
}
// Only recording tests enter this store. No microphone audio, credentials, or voice grants
// are persisted. Old runs and long traces are bounded so diagnostics cannot grow indefinitely.
function localHistory() {
  try { return globalThis.localStorage; } catch { return undefined; }
}
export class BenchmarkRecorder {
  private runs: BenchmarkRun[] = [];
  storageWarning: string | null = null;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active: BenchmarkRun | null = null;
  constructor(private storage: Pick<Storage, "getItem" | "setItem"> | undefined = localHistory()) {
    if (!storage) this.storageWarning = "Local history is unavailable. Export results before leaving this page.";
    try {
      const saved: unknown = JSON.parse(storage?.getItem(KEY) || "[]");
      if (Array.isArray(saved)) this.runs = saved.filter((r): r is BenchmarkRun =>
        r && r.version === 1 && typeof r.id === "string" && typeof r.date === "string" &&
        r.config && ["fixture", "source", "target", "output", "api"].every(k => typeof r.config[k] === "string") &&
        ["incoming", "outgoing"].includes(r.config.direction) && typeof r.config.voice === "boolean" && typeof r.config.originalAudible === "boolean" &&
        Number.isFinite(r.startedAt) && Number.isFinite(r.inputSeconds) && typeof r.truncated === "boolean" &&
        ["inputAt", "inputEndAt", "transcriptAt", "endedAt"].every(k => r[k] === undefined || Number.isFinite(r[k])) &&
        (r.error === undefined || typeof r.error === "string") && (r.note === undefined || typeof r.note === "string") &&
        (r.review === undefined || ["unreviewed", "pass", "issues"].includes(r.review)) &&
        ["done", "cancelled", "error"].includes(r.outcome) && Array.isArray(r.segments) && Array.isArray(r.queue) && r.models &&
        Object.values(r.models).every(v => typeof v === "string") &&
        r.segments.length <= MAX_SEGMENTS && r.queue.length <= MAX_POINTS &&
        r.segments.every((s: SegmentTrace) => s && typeof s.id === "string" && Number.isFinite(s.startedAt) && Number.isFinite(s.observedAt) &&
          typeof s.text === "string" && typeof s.translation === "string" && Number.isFinite(s.queued) &&
          ["running", "done", "held", "superseded", "cancelled", "error"].includes(s.outcome) &&
          [s.requestedAt, s.textAt, s.displayedAt, s.audioAt, s.playbackAt, s.finishedAt, s.gateAt].every(v => v === undefined || Number.isFinite(v)) &&
          (s.gate === undefined || ["ready", "wait", "final"].includes(s.gate)) &&
          (s.gateProbability === undefined || s.gateProbability === null || (typeof s.gateProbability === "number" && Number.isFinite(s.gateProbability) && s.gateProbability >= 0 && s.gateProbability <= 1)) &&
          (s.gateUnavailable === undefined || typeof s.gateUnavailable === "boolean") &&
          (s.error === undefined || typeof s.error === "string") && (s.voice === undefined || typeof s.voice === "string") &&
          (s.metrics === undefined || (s.metrics && Object.values(s.metrics).every(v => v === undefined || v === null || Number.isFinite(v))))) &&
        r.queue.every((p: { at: number; seconds: number }) => p && Number.isFinite(p.at) && Number.isFinite(p.seconds))
      ).slice(0, MAX_RUNS);
    } catch { /* An unreadable local history must not prevent a new test. */ }
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.runs;
  private publish(save = false) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.active) this.runs = [structuredClone(this.active), ...this.runs.filter(r => r.id !== this.active!.id)].slice(0, MAX_RUNS);
    else this.runs = [...this.runs];
    if (save) try { this.storage?.setItem(KEY, JSON.stringify(this.runs.filter(r => r.outcome !== "running").map(r => ({ ...r, version: 1 })))); } catch { this.storageWarning = "Results could not be saved locally. Export them before closing the app."; }
    this.listeners.forEach(fn => fn());
  }
  begin(config: BenchmarkConfig) {
    this.finish("cancelled");
    this.active = { id: crypto.randomUUID(), date: new Date().toISOString(), config: { ...config }, startedAt: performance.now(), inputSeconds: 0, models: {}, segments: [], queue: [], outcome: "running", truncated: false };
    this.publish();
    return this.active.id;
  }
  observe = (event: DiagnosticEvent) => {
    const run = this.active;
    if (!run) return;
    if (event.type === "session" && !run.sessionId) {
      run.sessionId = event.sessionId; run.models = { ...event.models };
    }
    if (run.sessionId !== event.sessionId) return;
    if (event.type === "input") {
      run.inputAt ??= event.at; run.inputSeconds = event.seconds;
      if (run.queue.length < MAX_POINTS) run.queue.push({ at: event.at, seconds: event.queued }); else run.truncated = true;
    } else if (event.type === "input-end") run.inputEndAt ??= event.at;
    else if (event.type === "transcript") run.transcriptAt ??= event.at;
    else if (event.type === "segment") {
      const s = { ...event.segment, text: event.segment.text.slice(0, 4000), translation: event.segment.translation.slice(0, 6000) };
      // A custom voice authorization is a credential, not report metadata.
      if (s.voice && !/^[a-z0-9_-]{1,60}$/i.test(s.voice)) s.voice = "custom voice";
      const at = run.segments.findIndex(previous => previous.id === s.id);
      if (at >= 0) run.segments[at] = s;
      else if (run.segments.length < MAX_SEGMENTS) run.segments.push(s); else run.truncated = true;
    } else if (event.type === "end") { this.finish(event.outcome, event.error); return; }
    if (!this.timer) this.timer = setTimeout(() => this.publish(), 150);
  };
  finish(outcome: Exclude<BenchmarkRun["outcome"], "running">, error?: string) {
    if (!this.active) return;
    this.active.outcome = outcome; this.active.error = error; this.active.endedAt = performance.now();
    this.active.segments = this.active.segments.map(s => s.outcome === "running" ? { ...s, outcome: outcome === "error" ? "error" : "cancelled", finishedAt: this.active!.endedAt } : s);
    this.publish(true); this.active = null;
  }
  setOutput(output: string) {
    if (this.active) this.active.config.output = output;
  }
  sampleQueue(seconds: number) {
    if (!this.active || !Number.isFinite(seconds)) return;
    if (this.active.queue.length < MAX_POINTS) this.active.queue.push({ at: performance.now(), seconds });
    else this.active.truncated = true;
    if (!this.timer) this.timer = setTimeout(() => this.publish(), 150);
  }
  review(id: string, review: NonNullable<BenchmarkRun["review"]>, note: string) {
    this.runs = this.runs.map(r => r.id === id ? { ...r, review, note: note.slice(0, 2000) } : r);
    this.publish(true);
  }
  clear() { if (this.active) return; this.runs = []; this.publish(true); }
  dispose() { this.finish("cancelled"); if (this.timer) clearTimeout(this.timer); this.listeners.clear(); }
}
