import assert from "node:assert/strict";
import test from "node:test";
import type { NativeInvoke } from "../src/lib/calls";
import {
  TEST_PATTERN,
  VideoCaptionFeed,
  VideoRelay,
  chooseCamera,
  videoCaption,
  type CameraDevices,
  type RelayStatus,
} from "../src/lib/video-captions";

const passage = (id: string, translation: string) => ({ id, translation });
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("video captions roll over the unread words and drop old passages whole", () => {
  const read = new Map([["a", 5]]);
  assert.equal(
    videoCaption([passage("a", "Hello  everyone,"), passage("b", " thanks\nfor joining. ")], read),
    "everyone, thanks for joining.",
  );
  assert.equal(videoCaption([passage("a", "Hello")], read), "");
  const long = Array.from({ length: 4 }, (_, index) => passage(`p${index}`, `${"word ".repeat(40)}end${index}.`));
  const rolled = videoCaption(long, new Map());
  assert.ok(rolled.length <= 600, `${rolled.length} characters`);
  assert.ok(rolled.endsWith("end3."));
  assert.ok(rolled.startsWith("word"), "a whole passage left the front, not a slice of one");
});

test("one very long passage keeps its end, cut on a word in stable steps", () => {
  const words = Array.from({ length: 200 }, (_, index) => `w${index}`).join(" ");
  const first = videoCaption([passage("a", words)], new Map());
  const next = videoCaption([passage("a", `${words} more`)], new Map());
  assert.ok(first.length <= 600 && first.endsWith("w199"));
  assert.ok(/^w\d+ /.test(first), "starts on a whole word");
  assert.equal(next, `${first} more`, "appending a word keeps the same start, so lines do not re-wrap");
  const emoji = videoCaption([passage("a", "😀".repeat(400))], new Map());
  assert.ok(new TextEncoder().encode(emoji).length <= 2000);
  assert.ok(!/^[\uDC00-\uDFFF]/.test(emoji), "never starts inside a character");
});

test("the caption feed shows the live session only, and clears after a pause", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sent: string[] = [];
  const feed = new VideoCaptionFeed((text) => sent.push(text), 5000);
  const earlier = passage("old", "From the previous session.");
  feed.update([earlier]);
  assert.deepEqual(sent, [], "nothing is sent before a session attaches");
  feed.attach([earlier]);
  feed.update([earlier, passage("a", "Good")]);
  feed.update([earlier, passage("a", "Good")]);
  feed.update([earlier, passage("a", "Good morning")]);
  assert.deepEqual(sent, ["Good", "Good morning"]);
  t.mock.timers.tick(4999);
  assert.equal(feed.text, "Good morning");
  t.mock.timers.tick(1);
  assert.equal(feed.text, "", "the caption fades after the hold");
  feed.update([earlier, passage("a", "Good morning")]);
  assert.equal(feed.text, "", "cleared words never come back");
  feed.update([earlier, passage("a", "Good morning, all")]);
  assert.equal(feed.text, "all", "words added later start a fresh caption");
  feed.detach();
  feed.update([earlier, passage("a", "Good morning, all of you")]);
  assert.equal(feed.text, "all", "a stopped session sends nothing new");
  t.mock.timers.tick(5000);
  assert.equal(feed.text, "", "its last words still fade");
  feed.dispose();
});

test("the saved camera is kept while connected, otherwise the first one", () => {
  const devices: CameraDevices = {
    authorization: "authorized",
    cameras: [
      { id: "built-in", name: "MacBook Pro Camera" },
      { id: "desk", name: "Desk camera" },
    ],
    virtualCamera: { name: "OBS Virtual Camera", installed: true, ready: true },
  };
  assert.equal(chooseCamera(devices, "desk"), "desk");
  assert.equal(chooseCamera(devices, "unplugged"), "built-in");
  assert.equal(chooseCamera(devices, TEST_PATTERN), "built-in", "release builds never pick the pattern");
  assert.equal(chooseCamera(devices, TEST_PATTERN, true), TEST_PATTERN);
  assert.equal(chooseCamera({ ...devices, cameras: [] }, ""), "");
});

function nativeRelay() {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let release!: () => void;
  let opening: Promise<void> | null = null;
  let status: Partial<RelayStatus> = {};
  const call: NativeInvoke = async <T>(name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === "camera_relay_start" && opening) await opening;
    if (name === "camera_relay_status")
      return { running: true, sessionId: null, camera: "MacBook Pro Camera", sink: "OBS Virtual Camera",
        frames: 0, sent: 0, delivered: 0, error: null, ...status } as T;
    return undefined as T;
  };
  return {
    calls,
    names: () => calls.map((entry) => entry.name),
    hold: () => {
      opening = new Promise((resolve) => (release = resolve));
    },
    open: () => {
      release();
      opening = null;
    },
    setStatus: (next: Partial<RelayStatus>) => (status = next),
    relay: new VideoRelay(call, 5),
  };
}

test("captions wait for the camera to open, then collapse to the newest text", async () => {
  const h = nativeRelay();
  h.hold();
  const starting = h.relay.start({ cameraId: "built-in", caption: "Hello" });
  h.relay.caption("Hello every");
  h.relay.caption("Hello everyone");
  assert.equal(h.relay.getSnapshot().starting, true);
  h.open();
  assert.equal(await starting, true);
  await settle();
  const start = h.calls.find((entry) => entry.name === "camera_relay_start")!;
  assert.equal(start.args.cameraId, "built-in");
  const captions = h.calls.filter((entry) => entry.name === "camera_relay_caption");
  assert.deepEqual(captions.map((entry) => entry.args.text), ["Hello everyone"]);
  assert.equal(captions[0].args.sessionId, start.args.sessionId);
  await h.relay.stop();
});

test("a stop requested while the camera opens still releases it", async () => {
  const h = nativeRelay();
  h.hold();
  const starting = h.relay.start({ cameraId: "built-in" });
  await settle();
  assert.deepEqual(h.names(), ["camera_relay_start"], "the camera is opening");
  const stopping = h.relay.stop();
  assert.equal(h.relay.getSnapshot().sessionId, null);
  h.open();
  assert.equal(await starting, false);
  await stopping;
  assert.deepEqual(h.names(), ["camera_relay_start", "camera_relay_stop"]);
  assert.equal(h.calls[1].args.sessionId, h.calls[0].args.sessionId);
  h.relay.caption("Too late");
  await settle();
  assert.ok(!h.names().includes("camera_relay_caption"));

  const replaced = nativeRelay();
  const superseded = replaced.relay.start({ cameraId: "built-in" });
  await replaced.relay.start({ cameraId: "desk" });
  assert.equal(await superseded, false);
  assert.deepEqual(
    replaced.calls.map((entry) => entry.args.cameraId),
    ["desk"],
    "a start replaced before it ran never opens its camera",
  );
  await replaced.relay.stop();
  assert.deepEqual(replaced.names(), ["camera_relay_start", "camera_relay_stop"]);
});

test("a start replaced while opening, then stopped, still releases the opened camera", async () => {
  const h = nativeRelay();
  h.hold();
  const first = h.relay.start({ cameraId: "built-in" });
  await settle();
  const second = h.relay.start({ cameraId: "desk" });
  const stopping = h.relay.stop();
  h.open();
  assert.equal(await first, false);
  assert.equal(await second, false);
  await stopping;
  assert.deepEqual(h.names(), ["camera_relay_start", "camera_relay_stop"]);
  assert.equal(h.calls[1].args.sessionId, h.calls[0].args.sessionId, "the camera that opened is released");
  await h.relay.stop();
  assert.equal(h.names().length, 2, "nothing left to release");
});

test("a failed start or a camera failure ends the video with its message", async (t) => {
  const failing = new VideoRelay(async <T>(name: string) => {
    if (name === "camera_relay_start") throw "OBS Virtual Camera is not available.";
    return undefined as T;
  });
  await assert.rejects(failing.start({ cameraId: "built-in" }));
  assert.deepEqual(failing.getSnapshot(), {
    sessionId: null,
    starting: false,
    camera: null,
    callId: null,
    error: "OBS Virtual Camera is not available.",
  });

  const h = nativeRelay();
  await h.relay.start({ cameraId: "built-in", callId: "call-1" });
  const sessionId = h.relay.getSnapshot().sessionId;
  h.setStatus({ sessionId });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(h.relay.getSnapshot().camera, "MacBook Pro Camera");
  assert.equal(h.relay.getSnapshot().callId, "call-1");
  h.setStatus({ sessionId, error: "The camera was disconnected." });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(h.relay.getSnapshot().sessionId, null);
  assert.equal(h.relay.getSnapshot().error, "The camera was disconnected.");
  assert.equal(h.names().filter((name) => name === "camera_relay_stop").length, 1);
  t.after(() => h.relay.dispose());
});

test("leaving or cancelling while the camera permission is pending never opens the camera", async () => {
  const h = nativeRelay();
  let answer!: (allowed: boolean) => void;
  const asking = h.relay.ensure({
    camera: async () => "built-in",
    allow: () => new Promise<boolean>((resolve) => (answer = resolve)),
  });
  await settle();
  void h.relay.stop();
  answer(true);
  assert.equal(await asking, false);
  let current = true;
  const cancelled = h.relay.ensure({
    camera: async () => "built-in",
    allow: async () => {
      current = false;
      return true;
    },
    current: () => current,
  });
  assert.equal(await cancelled, false);
  await settle();
  assert.ok(!h.names().includes("camera_relay_start"), "the camera never opened");
});

test("a running preview follows the call that translation then starts with", async () => {
  const h = nativeRelay();
  await h.relay.start({ cameraId: "built-in" });
  h.setStatus({ sessionId: h.relay.getSnapshot().sessionId });
  const reuse = {
    camera: async () => assert.fail("the running camera is reused"),
    allow: async () => assert.fail("no new permission prompt"),
  };
  assert.equal(await h.relay.ensure({ ...reuse, callId: "call-1" }), true);
  assert.equal(h.relay.getSnapshot().callId, "call-1");
  await h.relay.ensure({ ...reuse, callId: "call-2" });
  assert.equal(h.relay.getSnapshot().callId, "call-1", "the adopted call is kept");
  assert.equal(h.names().filter((name) => name === "camera_relay_start").length, 1);
  await h.relay.stop();

  const preview = nativeRelay();
  await preview.relay.start({ cameraId: "built-in" });
  preview.setStatus({ sessionId: preview.relay.getSnapshot().sessionId });
  const ended = await preview.relay.ensure({ ...reuse, callId: "call-3", current: () => false });
  assert.equal(ended, false, "a call that already ended is not adopted");
  assert.equal(preview.relay.getSnapshot().callId, null);
  assert.ok(preview.relay.getSnapshot().sessionId, "the preview keeps running");
  await preview.relay.stop();
});

test("a missing camera or a refused permission is shown with the video", async () => {
  const relay = new VideoRelay(async <T>() => undefined as T);
  await assert.rejects(relay.ensure({ camera: async () => "", allow: async () => true }));
  assert.match(relay.getSnapshot().error ?? "", /No camera found/);
  await assert.rejects(relay.ensure({ camera: async () => "built-in", allow: async () => false }));
  assert.match(relay.getSnapshot().error ?? "", /Camera access is off/);
  assert.equal(relay.getSnapshot().sessionId, null);
});
