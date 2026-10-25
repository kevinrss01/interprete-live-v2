import { useEffect, useState, useSyncExternalStore } from "react";
import { Download, Trash2 } from "lucide-react";
import { BenchmarkRecorder, comparable, gateSource, runSummary, type BenchmarkRun, type SegmentTrace } from "../lib/benchmark";

const duration = (ms: number | null | undefined) => ms == null ? "—" : ms > 0 && ms < 10 ? `${ms.toFixed(1)} ms` : `${(ms / 1000).toFixed(2)} s`;
const elapsed = (end?: number, start?: number) => end === undefined || start === undefined ? null : Math.max(0, end - start);
const labels = { running: "Running", done: "Completed", held: "Held", superseded: "Transcript revised", cancelled: "Stopped", error: "Failed" };
const gateLabels = { jev: "Responded", unavailable: "Evaluation unavailable", local: "Not called — local decision", unknown: "Details not recorded" };
function gateScore(segment: SegmentTrace) {
  return gateSource(segment) === "jev"
    ? `${(segment.gateProbability! * 100).toFixed(1)}%`
    : gateLabels[gateSource(segment)];
}

function QueueChart({ run }: { run: BenchmarkRun }) {
  const points = run.queue;
  if (!points.length) return <p className="note">The audio queue will appear when the recording starts.</p>;
  const begin = run.inputAt ?? run.startedAt;
  const width = 560, height = 100;
  const end = Math.max(1000, points.at(-1)!.at - begin);
  const ceiling = Math.max(1, ...points.map(p => p.seconds));
  const line = points.map((p, i) => `${i ? "L" : "M"}${Math.max(0, (p.at - begin) / end * width).toFixed(1)},${(height - p.seconds / ceiling * height).toFixed(1)}`).join(" ");
  return <div className="benchmark-queue">
    <div className="benchmark-labels"><span>Queued translated audio</span><span>Peak {ceiling === 1 ? Math.max(...points.map(p => p.seconds)).toFixed(2) : ceiling.toFixed(2)} s</span></div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Audio queue over ${(end / 1000).toFixed(1)} seconds; peak ${Math.max(...points.map(p => p.seconds)).toFixed(2)} seconds`} preserveAspectRatio="none">
      <path d={line} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
    <div className="benchmark-labels"><span>0 s</span><span>{(end / 1000).toFixed(1)} s since input began</span></div>
  </div>;
}

function SegmentDetails({ segment: s, origin }: { segment: SegmentTrace; origin: number }) {
  const points: [string, number | undefined][] = [
    ["Latest transcript update", s.observedAt], ["Fragment selected", s.startedAt], ["Voice ready / request sent", s.requestedAt],
    ["First translated text received", s.textAt], ["Gate received", s.gateAt], ["Translation available to UI", s.displayedAt],
    ["First audio received", s.audioAt], ["First audible sample scheduled", s.playbackAt], ["Response finished", s.finishedAt],
  ];
  return <div className="benchmark-detail">
    <p><strong>Source</strong> {s.text}</p><p><strong>Translation</strong> {s.translation || "No translation committed yet."}</p>
    {s.error && <p role="alert" className="call-error">{s.error}</p>}
    <dl className="benchmark-timings">
      <div><dt>Gate decision</dt><dd>{s.gate ?? "Not received"}</dd></div>
      <div><dt>Jev status</dt><dd>{gateLabels[gateSource(s)]}</dd></div>
      <div><dt>Jev readiness score</dt><dd>{gateScore(s)}</dd></div>
    </dl>
    <p className="note">The score estimates whether this fragment is ready to translate, not translation quality. An unavailable evaluation also holds the fragment; it may mean a request failure or an invalid response.</p>
    <dl className="benchmark-timings">{points.map(([label, at]) => <div key={label}><dt>{label}</dt><dd>{duration(at === undefined ? null : at - origin)}</dd></div>)}</dl>
    <p className="note">Times above share the browser clock. Native output does not expose the audible playback timestamp yet; a dash means unavailable, not zero.</p>
    <dl className="benchmark-timings">
      <div><dt>Voice selection / preparation</dt><dd>{duration(elapsed(s.requestedAt, s.startedAt))}</dd></div>
      <div><dt>Server Jev evaluation</dt><dd>{duration(s.metrics?.gateMs)}</dd></div>
      <div><dt>Server request → first translation token</dt><dd>{duration(s.metrics?.translationMs)}</dd></div>
      <div><dt>Server request → first audio</dt><dd>{duration(s.metrics?.ttsFirstMs)}</dd></div>
      <div><dt>Audio received → scheduled playback</dt><dd>{duration(elapsed(s.playbackAt, s.audioAt))}</dd></div>
    </dl>
    <p className="note">Caption timings measure controller text availability, not painted words or the progressive reveal. Server durations overlap: do not add them. “First audio” includes the translation and gate; it is not synthesis time alone. Local decisions do not call Jev.</p>
  </div>;
}

export function BenchmarkResults({ recorder }: { recorder: BenchmarkRecorder }) {
  const runs = useSyncExternalStore(recorder.subscribe, recorder.getSnapshot, recorder.getSnapshot);
  const [selected, setSelected] = useState<string | null>(null);
  const [baseline, setBaseline] = useState("");
  const [fragment, setFragment] = useState<string | null>(null);
  const latestId = runs[0]?.id;
  useEffect(() => { setSelected(null); setFragment(null); }, [latestId]);
  const run = runs.find(r => r.id === selected) ?? runs[0];
  const other = runs.find(r => r.id === baseline && r.id !== run?.id);
  const summary = run && runSummary(run);
  const base = other && runSummary(other);
  const matching = run && other && comparable(run, other);
  const active = runs.some(r => r.outcome === "running");
  function download() {
    if (!run) return;
    const blob = new Blob([JSON.stringify({ schemaVersion: 1, measurement: "Client timing and scheduled playback; no acoustic or word-aligned latency", run, baseline: other ?? null }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = `interprete-benchmark-${run.date.replace(/[:.]/g, "-")}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="benchmark-results" aria-labelledby="benchmark-results-title">
    <div className="benchmark-heading"><h2 id="benchmark-results-title">Measurements</h2><div className="benchmark-actions">
      <button type="button" className="btn btn-quiet" onClick={download} disabled={!run}><Download size={14} aria-hidden="true" /> Export JSON</button>
      <button type="button" className="btn btn-quiet" disabled={active || !runs.length} onClick={() => { recorder.clear(); setSelected(null); setBaseline(""); }}><Trash2 size={14} aria-hidden="true" /> Clear results</button>
    </div></div>
    <p className="note">Same translation engine as calls. The last 12 recording runs stay on this device, outside discussion history. No audio is saved in these reports.</p>
    {recorder.storageWarning && <p role="alert" className="call-error">{recorder.storageWarning}</p>}
    {!run || !summary ? <div className="benchmark-empty"><p>Run a recording to see where time is spent.</p><p className="note">Start with the NASA sample. Repeat with identical settings to separate consistent delays from provider variability.</p></div> : <>
      <div className="benchmark-selectors">
        <label className="field"><span id="benchmark-run-label">Run</span><select aria-labelledby="benchmark-run-label" value={run.id} onChange={e => { setSelected(e.target.value); setFragment(null); }}>{runs.map(r => <option key={r.id} value={r.id}>{new Date(r.date).toLocaleTimeString()} · {r.config.fixture} · {r.config.source} → {r.config.target} · {labels[r.outcome]}</option>)}</select></label>
        <label className="field"><span id="benchmark-baseline-label">Compare with</span><select aria-labelledby="benchmark-baseline-label" value={baseline} onChange={e => setBaseline(e.target.value)}><option value="">No baseline</option>{runs.filter(r => r.id !== run.id).map(r => <option value={r.id} key={r.id}>{new Date(r.date).toLocaleTimeString()} · {r.config.fixture} · {labels[r.outcome]}</option>)}</select></label>
      </div>
      <p role="status">{labels[run.outcome]} · {run.inputSeconds.toFixed(1)} s of input · {run.segments.length} fragment attempts</p>
      {run.error && <p className="call-error" role="alert">{run.error}</p>}
      {run.truncated && <p className="call-error">The trace limit was reached. This run is incomplete and cannot be compared.</p>}
      <div className="benchmark-stats">
        <div><span>Input → first captions</span><strong>{duration(summary.firstCaption)}</strong></div>
        <div><span>Input → first audio received</span><strong>{duration(summary.firstAudio)}</strong></div>
        <div><span>Input → scheduled voice</span><strong>{duration(summary.firstPlayback)}</strong></div>
        <div><span>Peak audio queue</span><strong>{summary.maxQueue.toFixed(2)} s</strong></div>
      </div>
      <p className="note">Input starts at the first captured frame, including any opening silence. Exact source-word → translated-word delay is not available: these recordings have no verified word timestamps. This is not an acoustic measurement.</p>
      <QueueChart run={run} />
      <p>Held attempts: {summary.held} · Withdrawn after revisions: {summary.revised} · Failed: {summary.errors}</p>
      <p>Jev wait decisions: {summary.jevWait} · Jev unavailable: {summary.jevUnavailable}</p>
      {summary.gateUnknown > 0 && <p className="note">Jev details were not recorded for {summary.gateUnknown} fragments. These counts cannot distinguish refusals from evaluation failures for those fragments.</p>}
      <p className="note">Request → first audio: median {duration(summary.requestAudioP50)}, P90 {duration(summary.requestAudioP90)} across this run’s audio-producing fragments. This excludes held and failed fragments; small samples are not a reliable tail-latency estimate.</p>
      {other && base && <div className="benchmark-comparison">
        <p>{matching ? "Same recorded configuration; both runs completed." : "Different or incomplete configurations: this is not a controlled speed comparison."}</p>
        <p>Baseline first captions: {duration(base.firstCaption)} → selected: {duration(summary.firstCaption)}. Baseline peak queue: {base.maxQueue.toFixed(2)} s → selected: {summary.maxQueue.toFixed(2)} s.</p>
      </div>}
      <details className="benchmark-config"><summary>Recorded configuration and measurement limits</summary>
        <dl className="benchmark-timings">
          <div><dt>Recording / direction</dt><dd>{run.config.fixture} / {run.config.direction}</dd></div>
          <div><dt>Languages</dt><dd>{run.config.source} → {run.config.target}</dd></div>
          <div><dt>Output</dt><dd>{run.config.voice ? run.config.output : "Captions only"}</dd></div>
          <div><dt>Original audio</dt><dd>{run.config.originalAudible ? "Audible" : "Muted"}</dd></div>
          <div><dt>API</dt><dd>{run.config.api}</dd></div>
          {Object.entries(run.models).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}
          <div><dt>Input → first transcript</dt><dd>{duration(elapsed(run.transcriptAt, run.inputAt))}</dd></div>
          <div><dt>Input finished</dt><dd>{duration(elapsed(run.inputEndAt, run.inputAt))}</dd></div>
          <div><dt>Output drained after input</dt><dd>{run.outcome === "done" ? duration(elapsed(run.endedAt, run.inputEndAt)) : "—"}</dd></div>
        </dl>
        <p className="note">The API reports model names, not its deployed commit. Voice matching and provider load can vary. The test does not exercise native capture from another app. A 23-second recording cannot establish long-call stability.</p>
      </details>
      <h3>Fragment timeline</h3><p className="note">Select a fragment to inspect its source, translation, waits and provider timings. Read source and translation together to spot omissions, repeats or changed meaning.</p>
      <div className="benchmark-table"><table><thead><tr><th scope="col">Fragment</th><th scope="col">Result</th><th scope="col">Jev score / status</th><th scope="col">Request → text</th><th scope="col">Request → audio</th><th scope="col">Queued at request</th></tr></thead><tbody>{run.segments.map((s, i) => <tr key={s.id} data-selected={fragment === s.id}><th scope="row"><button type="button" onClick={() => setFragment(fragment === s.id ? null : s.id)} aria-expanded={fragment === s.id}>{i + 1}. {s.text.slice(0, 85)}{s.text.length > 85 ? "…" : ""}</button></th><td>{labels[s.outcome]}</td><td>{gateScore(s)}</td><td>{duration(elapsed(s.textAt, s.requestedAt))}</td><td>{duration(elapsed(s.audioAt, s.requestedAt))}</td><td>{s.queued.toFixed(2)} s</td></tr>)}</tbody></table></div>
      {run.segments.find(s => s.id === fragment) && <SegmentDetails segment={run.segments.find(s => s.id === fragment)!} origin={run.inputAt ?? run.startedAt} />}
      <fieldset className="benchmark-review" disabled={run.outcome === "running"}><legend>Meaning and clarity — manual review</legend>
        <label className="field"><span id="benchmark-assessment-label">Assessment</span><select aria-labelledby="benchmark-assessment-label" value={run.review ?? "unreviewed"} onChange={e => recorder.review(run.id, e.target.value as NonNullable<BenchmarkRun["review"]>, run.note ?? "")}><option value="unreviewed">Not reviewed</option><option value="pass">No issue noticed</option><option value="issues">Issues noticed</option></select></label>
        <label className="field">Notes<textarea maxLength={2000} rows={3} value={run.note ?? ""} placeholder="For example: amount changed in fragment 4, repeated words, long pause…" onChange={e => recorder.review(run.id, run.review ?? "unreviewed", e.target.value)} /></label>
      </fieldset>
    </>}
  </section>;
}
