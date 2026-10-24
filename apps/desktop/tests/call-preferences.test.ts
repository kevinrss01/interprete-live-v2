import assert from "node:assert/strict";
import test from "node:test";
import {
  APP_MICROPHONE_NAME,
  preferredOutput,
  savedRoute,
  displayedOutputs,
} from "../src/lib/call-preferences";
import { physicalMicrophones } from "../src/lib/calls";
const branded = { name: APP_MICROPHONE_NAME, virtualMic: true, appMic: true };
const legacy = { name: "BlackHole 2ch", virtualMic: true, appMic: false };
test("saved BlackHole selections migrate to the app-named microphone", () => {
  assert.equal(
    preferredOutput([branded, legacy], legacy.name),
    APP_MICROPHONE_NAME,
  );
  assert.equal(preferredOutput([branded, legacy], ""), APP_MICROPHONE_NAME);
  assert.equal(
    preferredOutput([branded, legacy], "disconnected"),
    APP_MICROPHONE_NAME,
  );
});
test("a valid explicitly selected output and local-test preference remain stable", () => {
  const custom = { name: "Custom loopback", virtualMic: true, appMic: false };
  assert.equal(preferredOutput([branded, custom], custom.name), custom.name);
  assert.equal(savedRoute("local"), "local");
  assert.equal(savedRoute("virtual"), "virtual");
  assert.equal(savedRoute("invalid"), "virtual");
});
test("the app-named input cannot be selected as its own physical source", () => {
  const devices = [
    { kind: "audioinput", label: APP_MICROPHONE_NAME, deviceId: "virtual" },
    { kind: "audioinput", label: "Physical mic", deviceId: "physical" },
  ] as MediaDeviceInfo[];
  assert.deepEqual(
    physicalMicrophones(devices).map((device) => device.deviceId),
    ["physical"],
  );
});

test("only the app-named microphone is offered once it exists", () => {
  assert.deepEqual(displayedOutputs([legacy, branded]), [branded]);
  assert.deepEqual(displayedOutputs([legacy]), [legacy]);
});
