import assert from "node:assert/strict";
import test from "node:test";
import { BenchmarkRecorder, cadenceSummary, comparable, gateSource, runSummary, type BenchmarkConfig, type SegmentTrace } from "../src/lib/benchmark";
const config: BenchmarkConfig = { fixture: "synthetic.wav", direction: "incoming", source: "en", target: "fr", voice: true, originalAudible: false, output: "mock", api: "mock" };
const segment: SegmentTrace = { id: "fragment", text: "Hello", translation: "Bonjour", observedAt: 500, startedAt: 600, requestedAt: 700, textAt: 800, displayedAt: 900, audioAt: 1000, playbackAt: 1200, finishedAt: 1300, queued: .2, outcome: "done" };
function setup() {
  let saved = "[]";
  const storage = { getItem: () => saved, setItem: (_: string, value: string) => { saved = value; } };
  const recorder = new BenchmarkRecorder(storage);
  function begin() {
    recorder.begin(config);
    recorder.observe({ type: "session", sessionId: "session", at: 0, startedAt: 0, source: "en", target: "fr", models: { translation: "mock" } });
    recorder.observe({ type: "input", sessionId: "session", at: 100, seconds: .02, queued: .2 });
  }
  return { recorder, storage, begin };
}
test("benchmark measures distinct input, request and scheduled output clocks", () => {
  const { recorder, begin } = setup(); begin();
  recorder.observe({ type: "segment", sessionId: "unrelated", at: 200, segment: { ...segment, id: "ignored" } });
  recorder.observe({ type: "segment", sessionId: "session", at: 1300, segment });
  recorder.finish("done");
  const run = recorder.getSnapshot()[0];
  assert.equal(run.segments.length, 1);
  assert.deepEqual(runSummary(run), { firstCaption: 800, firstAudio: 900, firstPlayback: 1100, requestAudioP50: 300, requestAudioP90: 300, maxQueue: .2, held: 0, jevWait: 0, jevUnavailable: 0, gateUnknown: 0, revised: 0, errors: 0 });
  assert.equal(comparable(run, structuredClone(run)), true);
  assert.equal(comparable(run, { ...run, outcome: "cancelled" }), false);
  assert.equal(comparable(run, { ...run, config: { ...config, voice: false } }), false);
  assert.equal(comparable(run, { ...run, models: { translation: "other" } }), false);
});
test("missing native playback is unavailable, and cancellation ignores late events", () => {
  const { recorder, begin } = setup(); begin();
  recorder.observe({ type: "segment", sessionId: "session", at: 1000, segment: { ...segment, playbackAt: undefined, outcome: "running" } });
  recorder.finish("cancelled");
  recorder.observe({ type: "segment", sessionId: "session", at: 1300, segment });
  assert.equal(runSummary(recorder.getSnapshot()[0]).firstPlayback, null);
  assert.equal(recorder.getSnapshot()[0].segments[0].outcome, "cancelled");
});
test("completed local history is bounded, reloadable and excludes signed voice authorizations", () => {
  const { recorder, storage, begin } = setup();
  for (let i = 0; i < 14; i++) {
    begin();
    recorder.observe({ type: "segment", sessionId: "session", at: 1300, segment: { ...segment, voice: "signed.secret.token" } });
    recorder.finish("done");
  }
  const loaded = new BenchmarkRecorder(storage);
  assert.equal(loaded.getSnapshot().length, 12);
  assert.equal(loaded.getSnapshot()[0].segments[0].voice, "custom voice");
  assert.ok(!storage.getItem().includes("signed.secret.token"));
  loaded.review(loaded.getSnapshot()[0].id, "issues", "Meaning changed");
  assert.equal(new BenchmarkRecorder(storage).getSnapshot()[0].note, "Meaning changed");
  loaded.clear(); assert.equal(new BenchmarkRecorder(storage).getSnapshot().length, 0);
});
test("corrupt storage cannot crash measurement rendering; unfinished runs are not saved", () => {
  const { recorder, storage, begin } = setup(); begin();
  assert.equal(new BenchmarkRecorder(storage).getSnapshot().length, 0);
  recorder.finish("error", "Synthetic failure");
  const saved = JSON.parse(storage.getItem());
  saved[0].inputSeconds = "broken";
  storage.setItem("", JSON.stringify(saved));
  assert.equal(new BenchmarkRecorder(storage).getSnapshot().length, 0);
  storage.setItem("", "not JSON");
  assert.equal(new BenchmarkRecorder(storage).getSnapshot().length, 0);
});
test("trace bounds mark incomplete measurements without losing cancellation", () => {
  const { recorder, begin } = setup(); begin();
  for (let i = 0; i < 1210; i++) recorder.observe({ type: "segment", sessionId: "session", at: 1300, segment: { ...segment, id: String(i) } });
  recorder.finish("done");
  const run = recorder.getSnapshot()[0];
  assert.equal(run.segments.length, 1200); assert.equal(run.truncated, true);
  assert.equal(comparable(run, run), false);
});
test("storage write failure keeps the report exportable and visibly warns", () => {
  const recorder = new BenchmarkRecorder({ getItem: () => "[]", setItem: () => { throw new Error("Quota exceeded"); } });
  recorder.begin(config); recorder.finish("error", "Test failure");
  assert.equal(recorder.getSnapshot().length, 1);
  assert.match(recorder.storageWarning!, /could not be saved/);
});

test("Jev refusals, unavailability and local decisions survive storage without inventing legacy scores", () => {
  const { recorder, storage, begin } = setup(); begin();
  const cases: SegmentTrace[] = [
    { ...segment, id: "refused", outcome: "held", gate: "wait", gateProbability: .1, gateUnavailable: false },
    { ...segment, id: "unavailable", outcome: "held", gate: "wait", gateProbability: null, gateUnavailable: true },
    { ...segment, id: "local", outcome: "held", gate: "wait", gateProbability: null, gateUnavailable: false, metrics: { gateMs: 0 } },
    { ...segment, id: "legacy", outcome: "held", gate: "wait", metrics: { gateMs: 200 } },
    { ...segment, id: "zero", outcome: "held", gate: "wait", gateProbability: 0, gateUnavailable: false },
    { ...segment, id: "accepted", gate: "ready", gateProbability: 1, gateUnavailable: false },
  ];
  for (const trace of cases) recorder.observe({ type: "segment", sessionId: "session", at: 1300, segment: trace });
  recorder.finish("done");
  const loaded = new BenchmarkRecorder(storage).getSnapshot()[0];
  assert.deepEqual(loaded.segments, cases);
  assert.deepEqual(loaded.segments.map(gateSource), ["jev", "unavailable", "local", "unknown", "jev", "jev"]);
  const summary = runSummary(loaded);
  assert.equal(summary.held, 5);
  assert.equal(summary.jevWait, 2);
  assert.equal(summary.jevUnavailable, 1);
  assert.equal(summary.gateUnknown, 1);
  assert.equal(Object.hasOwn(loaded.segments[3], "gateProbability"), false);
});

test("invalid persisted Jev scores and availability flags are rejected", () => {
  const { recorder, storage, begin } = setup(); begin();
  recorder.observe({ type: "segment", sessionId: "session", at: 1300, segment });
  recorder.finish("done");
  const valid = storage.getItem();
  for (const invalid of [{ gateProbability: -1 }, { gateProbability: 1.1 }, { gateProbability: "0.8" }, { gateUnavailable: "false" }, { gateUnavailable: null }]) {
    const saved = JSON.parse(valid);
    Object.assign(saved[0].segments[0], invalid);
    storage.setItem("", JSON.stringify(saved));
    assert.equal(new BenchmarkRecorder(storage).getSnapshot().length, 0);
  }
});

test("benchmark exports the decision context and ordered ASR revisions for replay", () => {
  const { recorder, storage, begin } = setup(); begin();
  recorder.observe({ type: "transcript", sessionId: "session", at: 510,
    transcript: { id: "block", text: "when astronauts", final: false, revised: false, replaying: false } });
  recorder.observe({ type: "transcript", sessionId: "session", at: 550,
    transcript: { id: "block", text: "when astronauts do experiments", final: true, revised: true, replaying: false } });
  recorder.observe({ type: "segment", sessionId: "session", at: 1300, segment: {
    ...segment, blockId: "block", sourceStart: 0, sourceEnd: 15,
    followingText: "do experiments", precedingSpeech: "Actually,",
  } });
  recorder.finish("done");
  const run = new BenchmarkRecorder(storage).getSnapshot()[0];
  assert.deepEqual(run.transcripts?.map(t => [t.at, t.final, t.revised]), [[510, false, false], [550, true, true]]);
  assert.equal(run.segments[0].precedingSpeech, "Actually,");
  assert.equal(run.segments[0].followingText, "do experiments");
  assert.equal(run.segments[0].blockId, "block");
  assert.equal(run.segments[0].sourceEnd, 15);
  const saved = JSON.parse(storage.getItem());
  saved[0].transcripts[0].at = "invalid";
  storage.setItem("", JSON.stringify(saved));
  assert.equal(new BenchmarkRecorder(storage).getSnapshot().length, 0);
});

test("ASR replay traces are bounded and explicitly mark incomplete recordings", () => {
  const { recorder, begin } = setup(); begin();
  for (let i = 0; i < 2402; i++) recorder.observe({ type: "transcript", sessionId: "session", at: i,
    transcript: { id: "block", text: "x".repeat(4001), final: false, revised: false, replaying: false } });
  recorder.finish("done");
  const run = recorder.getSnapshot()[0];
  assert.equal(run.transcripts?.length, 2400);
  assert.equal(run.transcripts?.[0].text.length, 4000);
  assert.equal(run.truncated, true);
  assert.equal(comparable(run, structuredClone(run)), false);
});

test("cadence excludes duplicate finalization and rejected text, and measures overlapping gate wait", () => {
  const { recorder, begin } = setup(); begin();
  for (const [at, id, text, final] of [[100, "a", "one", false], [200, "a", "one", true], [300, "b", "two", false], [400, "a", "one", true], [600, "b", "two three", false]] as const)
    recorder.observe({ type: "transcript", sessionId: "session", at, transcript: { id, text, final, revised: false, replaying: false } });
  recorder.observe({ type: "segment", sessionId: "session", at: 1000, segment: { ...segment, gateAt: 750 } });
  recorder.observe({ type: "segment", sessionId: "session", at: 1700, segment: { ...segment, id: "second", requestedAt: 1000, textAt: 1100, gateAt: 1300, displayedAt: 1300 } });
  recorder.observe({ type: "segment", sessionId: "session", at: 1800, segment: { ...segment, id: "held", outcome: "held" } });
  recorder.finish("done");
  const run = recorder.getSnapshot()[0], result = cadenceSummary(run);
  assert.deepEqual(result.asr, { count: 2, median: 200, p90: 300, max: 300 });
  assert.deepEqual(result.publications, { count: 1, median: 400, p90: 400, max: 400 });
  assert.equal(result.translation.count, 2);
  assert.equal(result.gateWait.median, 0);
  assert.equal(result.gateWait.max, 200);
  assert.equal(cadenceSummary({ ...run, transcripts: undefined }).asr.median, null);
});
