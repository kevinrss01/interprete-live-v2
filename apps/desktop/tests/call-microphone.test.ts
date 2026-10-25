import assert from "node:assert/strict";
import test from "node:test";
import { CallMicrophoneSync, type CallMicrophoneState, type MicrophoneSyncStatus } from "../src/lib/call-microphone";

const wait = () => new Promise(resolve => setTimeout(resolve, 15));
const unmuted = { supported: true, muted: false, permissionRequired: false };

test("Meet mute suspends processing, unreadable state stays paused, confirmed unmute resumes", async () => {
  let state: CallMicrophoneState = unmuted;
  let starts = 0, pauses = 0;
  const statuses: MicrophoneSyncStatus[] = [];
  const sync = new CallMicrophoneSync({
    read: async () => state,
    resume: async () => { starts++; }, pause: () => { pauses++; },
    changed: status => statuses.push(status), failed: error => assert.fail(String(error)), pollMs: 1,
  });
  try {
    await sync.start();
    assert.equal(starts, 1);
    state = { ...unmuted, muted: true };
    await wait();
    assert.equal(pauses, 1);
    assert.equal(statuses.at(-1)?.paused, true);
    state = { ...unmuted, muted: null };
    await wait();
    assert.equal(starts, 1);
    state = unmuted;
    await wait();
    assert.equal(starts, 2);
    assert.equal(statuses.at(-1)?.paused, false);
  } finally { sync.stop(); }
});

test("missing Accessibility access never opens capture", async () => {
  const sync = new CallMicrophoneSync({
    read: async () => ({ ...unmuted, muted: null, permissionRequired: true }),
    resume: async () => assert.fail("must not capture"), pause: assert.fail,
    changed: status => { assert.equal(status.paused, true); assert.match(status.notice!, /Accessibility/); },
    failed: error => assert.fail(String(error)),
  });
  try { await sync.start(); } finally { sync.stop(); }
});

test("mute during startup invalidates the pending resume without delaying polling", async () => {
  let state: CallMicrophoneState = unmuted;
  let current!: () => boolean;
  let release!: () => void;
  let pauses = 0;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const sync = new CallMicrophoneSync({
    read: async () => state,
    resume: async check => { current = check; await pending; },
    pause: () => { pauses++; }, changed: () => {}, failed: error => assert.fail(String(error)), pollMs: 1,
  });
  await sync.start();
  assert.equal(current(), true);
  state = { ...unmuted, muted: true };
  await wait();
  assert.equal(current(), false);
  assert.equal(pauses, 1);
  sync.stop(); release();
});

test("a delayed unmute reply after stopping cannot restart the microphone", async () => {
  let release!: (state: CallMicrophoneState) => void;
  const sync = new CallMicrophoneSync({
    read: () => new Promise(resolve => { release = resolve; }),
    resume: async () => assert.fail("stale reply restarted capture"),
    pause: assert.fail, changed: () => assert.fail("unexpected state update"), failed: error => assert.fail(String(error)),
  });
  const starting = sync.start();
  sync.stop(); release(unmuted);
  await starting;
});

test("a failed state read pauses a running microphone", async () => {
  let reject = false, pauses = 0;
  const sync = new CallMicrophoneSync({
    read: async () => { if (reject) throw new Error("AX unavailable"); return unmuted; },
    resume: async () => {}, pause: () => { pauses++; }, changed: () => {}, failed: error => assert.fail(String(error)), pollMs: 1,
  });
  try {
    await sync.start(); reject = true; await wait();
    assert.equal(pauses, 1);
  } finally { sync.stop(); }
});
