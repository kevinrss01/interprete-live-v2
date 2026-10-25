import assert from "node:assert/strict";
import test from "node:test";
import { BenchmarkRecorder, comparable, gateSource, runSummary, type BenchmarkConfig, type SegmentTrace } from "../src/lib/benchmark";
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
  for (let i = 0; i < 510; i++) recorder.observe({ type: "segment", sessionId: "session", at: 1300, segment: { ...segment, id: String(i) } });
  recorder.finish("done");
  const run = recorder.getSnapshot()[0];
  assert.equal(run.segments.length, 500); assert.equal(run.truncated, true);
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
