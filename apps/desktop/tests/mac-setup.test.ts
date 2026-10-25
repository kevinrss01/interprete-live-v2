import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MacSetupView } from "../src/onboarding/mac-setup";
import { MacSetupMonitor, missingSetup, type MacSetupStatus } from "../src/lib/mac-setup";

const ready: MacSetupStatus = { supported: true, microphone: "granted", accessibility: true, bundled: true, driverInstalled: true, driverReady: true, virtualMicrophone: true };
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test("setup identifies the running local build and keeps Continue locked until macOS grants access", () => {
  // tsx compiles the shared UI package with classic JSX (it has no app tsconfig).
  Object.assign(globalThis, { React });
  const render = (status: MacSetupStatus) => renderToStaticMarkup(createElement(MacSetupView, {
    state: { status, checking: false, pending: null, lastAction: null, audioRequested: false, error: null },
    audio: "confirmed", onAction() {}, onConfirmAudio() {}, onRefresh() {}, onContinue() {}, onLater() {},
  }));
  const local = render({ ...ready, bundled: false, accessibility: false });
  assert.match(local, /local build needs its own Accessibility permission/);
  assert.match(local, /Show running app/);
  assert.match(local, /<button[^>]*disabled=""[^>]*>Continue/);
  const installed = render({ ...ready, accessibility: false });
  assert.match(installed, /Enable this copy of Interprete/);
  const granted = render({ ...ready, bundled: false });
  assert.doesNotMatch(granted, /Show running app/);
  assert.doesNotMatch(granted, /<button[^>]*disabled=""[^>]*>Continue/);
});

test("all setup checks must pass; opening a permission panel is not audio confirmation", () => {
  assert.deepEqual(missingSetup(ready, null), ["Call audio access"]);
  assert.deepEqual(missingSetup(ready, "confirmed"), []);
  assert.deepEqual(missingSetup(ready, "verified"), []);
  assert.deepEqual(missingSetup({ ...ready, microphone: "denied" }, "verified"), ["Microphone access"]);
  assert.deepEqual(missingSetup({ ...ready, driverReady: false }, "confirmed"), ["Virtual microphone"]);
  assert.deepEqual(missingSetup({ ...ready, accessibility: false }, "confirmed"), ["Meet mute synchronization"]);
});

test("captions do not require BlackHole, microphone or Accessibility; outgoing translation does not require system audio", () => {
  const captions = { ...ready, microphone: "denied", driverReady: false, virtualMicrophone: false, accessibility: false } as MacSetupStatus;
  assert.deepEqual(missingSetup(captions, "confirmed", { audio: true }), []);
  assert.deepEqual(missingSetup(ready, null, { microphone: true, virtualMicrophone: true, accessibility: true }), []);
  assert.deepEqual(missingSetup({ ...ready, supported: false }, "verified"), ["macOS 14.2 or later"]);
});

test("setup checks never request access or run an installer, and concurrent refreshes share one read", async () => {
  let resolve!: (value: MacSetupStatus) => void;
  let reads = 0;
  const monitor = new MacSetupMonitor({
    read: () => { reads++; return new Promise(result => { resolve = result; }); },
    run: async () => assert.fail("passive checks must not perform an action"),
  });
  monitor.start();
  try {
    const first = monitor.refresh();
    const second = monitor.refresh();
    assert.equal(first, second);
    await Promise.resolve();
    assert.equal(reads, 1);
    resolve(ready); await first;
    assert.equal(monitor.getSnapshot().status, ready);
  } finally { monitor.stop(); }
});

test("a permission reply from a closed setup screen cannot overwrite a newly opened screen", async () => {
  const replies: ((value: MacSetupStatus) => void)[] = [];
  const monitor = new MacSetupMonitor({ read: () => new Promise(resolve => replies.push(resolve)), run: async () => {} });
  monitor.start(); await Promise.resolve();
  monitor.stop(); monitor.start(); await Promise.resolve();
  try {
    replies[1](ready); await settle();
    replies[0]({ ...ready, microphone: "denied" }); await settle();
    assert.equal(monitor.getSnapshot().status?.microphone, "granted");
  } finally { monitor.stop(); }
});

test("duplicate installer actions run only once and installer errors survive passive checks", async () => {
  let reject!: (error: Error) => void;
  let runs = 0;
  const monitor = new MacSetupMonitor({
    read: async () => ready,
    run: () => { runs++; return new Promise<void>((_resolve, failure) => { reject = failure; }); },
  });
  monitor.start();
  try {
    await monitor.refresh();
    const downloading = monitor.run("install-driver");
    await monitor.run("install-driver");
    assert.equal(runs, 1);
    reject(new Error("Installer checksum mismatch")); await downloading;
    await monitor.refresh();
    assert.equal(monitor.getSnapshot().error, "Installer checksum mismatch");
    assert.equal(monitor.getSnapshot().pending, null);
  } finally { monitor.stop(); }
});

test("a failed status read can recover without leaving a stale error", async () => {
  let fail = true;
  const monitor = new MacSetupMonitor({ read: async () => { if (fail) throw new Error("Unavailable"); return ready; }, run: async () => {} });
  monitor.start();
  try {
    await monitor.refresh(); assert.equal(monitor.getSnapshot().error, "Unavailable");
    fail = false; await monitor.refresh(); assert.equal(monitor.getSnapshot().error, null);
  } finally { monitor.stop(); }
});

test("audio permission guidance survives another setup action and a failed audio request", async () => {
  const monitor = new MacSetupMonitor({ read: async () => ready, run: async action => { if (action === "audio") throw new Error("Permission denied"); } });
  monitor.start();
  try {
    await monitor.run("audio");
    assert.equal(monitor.getSnapshot().audioRequested, true);
    await monitor.run("accessibility");
    assert.equal(monitor.getSnapshot().audioRequested, true);
  } finally { monitor.stop(); }
});

test("an installer finishing after setup closes cannot change a reopened screen", async () => {
  let finish!: () => void;
  const monitor = new MacSetupMonitor({ read: async () => ready, run: () => new Promise<void>(resolve => { finish = resolve; }) });
  monitor.start();
  const downloading = monitor.run("install-driver");
  monitor.stop(); monitor.start();
  try {
    finish(); await downloading; await monitor.refresh();
    assert.equal(monitor.getSnapshot().pending, null);
    assert.equal(monitor.getSnapshot().lastAction, null);
    assert.equal(monitor.getSnapshot().status, ready);
  } finally { monitor.stop(); }
});
