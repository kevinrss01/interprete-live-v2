import assert from "node:assert/strict";
import test from "node:test";
import {
  conversationStatus,
  microphoneHelp,
  microphoneHelpVisible,
  microphoneLabel,
  stopControlLabel,
  type LiveStatusInput,
} from "../src/lib/live-status";

const status = (patch: Partial<LiveStatusInput> = {}) =>
  conversationStatus({
    phase: "idle",
    input: null,
    connection: null,
    outputActive: false,
    ready: true,
    callBusy: false,
    speakerName: "You",
    ...patch,
  });

test("conversation status names the active phase", () => {
  assert.equal(status({ callBusy: true, phase: "listening" }), "Translating the call…");
  assert.equal(
    status({ phase: "listening", input: "demo", connection: "reconnecting" }),
    "Reconnecting · audio sample",
  );
  assert.equal(status({ phase: "listening", input: "demo" }), "Playing audio sample…");
  assert.equal(status({ phase: "connecting" }), "Connecting microphone…");
  assert.equal(
    status({ phase: "listening", input: "microphone", connection: "reconnecting" }),
    "Reconnecting · mic on",
  );
  assert.equal(
    status({ phase: "listening", input: "microphone", outputActive: true }),
    "Listening and translating…",
  );
  assert.equal(status({ phase: "listening", input: "microphone", speakerName: "Ana" }), "Ana is speaking…");
  assert.equal(status({ phase: "finishing" }), "Finishing the turn…");
  assert.equal(status({ phase: "translating" }), "Translating…");
  assert.equal(status({ phase: "playing" }), "Playing the translation");
  assert.equal(status({ ready: false }), "Connecting…");
  assert.equal(status(), "Ready");
});

test("microphone copy follows capture, and the stop control names a live turn", () => {
  assert.equal(microphoneLabel("listening", "microphone"), "Mic on");
  assert.equal(microphoneLabel("connecting", null), "Turning on mic…");
  assert.equal(microphoneLabel("connecting", "demo"), "Mic off");
  assert.equal(microphoneLabel("finishing", "microphone"), "Turning off mic…");
  assert.equal(microphoneLabel("idle", null), "Mic off");
  assert.equal(microphoneHelp("listening", "demo"), "The sample uses a recording, not your mic.");
  assert.equal(
    microphoneHelp("listening", "microphone"),
    "The translation follows your voice. Turn off the mic to finish.",
  );
  assert.equal(microphoneHelp("idle", null), "Turn on the speaker’s mic.");
  assert.equal(microphoneHelp("connecting", "microphone"), "Allow microphone access if asked.");
  assert.equal(microphoneHelp("playing", null), "Playing the translation…");
  assert.equal(microphoneHelp("translating", null), "Finishing the translation…");
  assert.equal(microphoneHelpVisible("listening", "demo"), true);
  assert.equal(microphoneHelpVisible("listening", "microphone"), true);
  assert.equal(microphoneHelpVisible("connecting", null), true);
  assert.equal(microphoneHelpVisible("idle", null), false);
  assert.equal(microphoneHelpVisible("playing", null), false);
  assert.equal(microphoneHelpVisible("translating", null), false);
  assert.equal(stopControlLabel("listening"), "Cancel turn");
  assert.equal(stopControlLabel("connecting"), "Cancel turn");
  assert.equal(stopControlLabel("playing"), "Stop");
});
