import assert from "node:assert/strict";
import test from "node:test";
import {
  NativePcmPlayer,
  physicalMicrophones,
  requirePhysicalMicrophone,
  type NativeInvoke,
} from "../src/lib/calls";

const device = (deviceId: string, label: string) =>
  ({ deviceId, label, kind: "audioinput" }) as MediaDeviceInfo;
test("call mode requires an explicit physical microphone and excludes virtual/default aliases", () => {
  const devices = [
    device("default", "EarPods"),
    device("blackhole", "BlackHole 2ch"),
    device("mix", "Shure Virtual Audio"),
    device("mic", "EarPods Microphone"),
    device("hidden", ""),
  ];
  assert.deepEqual(
    physicalMicrophones(devices).map((d) => d.deviceId),
    ["mic"],
  );
  assert.throws(() => requirePhysicalMicrophone(devices, "blackhole"));
  assert.throws(() => requirePhysicalMicrophone(devices, "default"));
  assert.doesNotThrow(() => requirePhysicalMicrophone(devices, "mic"));
});
test("native output preserves odd PCM chunks, serializes packets, and drains the hardware queue", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let polls = 0;
  const call: NativeInvoke = async <T>(
    name: string,
    args: Record<string, unknown>,
  ) => {
    calls.push({ name, args });
    return (
      name === "audio_route_status"
        ? { pendingSeconds: polls++ ? 0 : 0.01, failed: false }
        : undefined
    ) as T;
  };
  const failures: string[] = [];
  const player = new NativePcmPlayer(
    "BlackHole 2ch",
    (error) => failures.push(error),
    call,
  );
  await player.unlock();
  await player.enqueue(new Uint8Array([1, 2, 3]));
  await player.enqueue(new Uint8Array([4, 5, 6]));
  await player.idle();
  assert.deepEqual(
    calls
      .filter((c) => c.name === "audio_route_push")
      .map((c) => [...Buffer.from(String(c.args.audio), "base64")]),
    [
      [1, 2],
      [3, 4, 5, 6],
    ],
  );
  assert.equal(polls, 2);
  assert.deepEqual(failures, []);
  player.dispose();
});
test("stopping before native open resolves closes the stale route and cannot revive output", async () => {
  let finish!: () => void;
  const started = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const calls: string[] = [];
  const player = new NativePcmPlayer(
    "BlackHole 2ch",
    () => {},
    async <T>(name: string) => {
      calls.push(name);
      if (name === "audio_route_open") await started;
      return undefined as T;
    },
  );
  const opening = player.unlock();
  await Promise.resolve();
  player.stop();
  finish();
  await opening;
  assert.deepEqual(calls, ["audio_route_open", "audio_route_close"]);
  await assert.rejects(player.enqueue(new Uint8Array([0, 1])), /not ready/);
  player.dispose();
});
test("device failure stops output and is surfaced while the microphone session is live", async () => {
  const errors: string[] = [];
  const commands: string[] = [];
  const player = new NativePcmPlayer(
    "BlackHole 2ch",
    (e) => errors.push(e),
    async <T>(name: string) => {
      commands.push(name);
      if (name === "audio_route_push") throw new Error("Device disconnected");
      return undefined as T;
    },
  );
  await player.unlock();
  await assert.rejects(player.enqueue(new Uint8Array([0, 1])), /disconnected/);
  await assert.rejects(player.idle(), /disconnected/);
  assert.equal(errors.length, 1);
  assert.equal(player.pendingSeconds, 0);
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(commands.includes("audio_route_close"));
  player.dispose();
});
test("cancel drops queued packets instead of leaking them into the next call", async () => {
  const packets: string[] = [];
  const player = new NativePcmPlayer(
    "BlackHole 2ch",
    () => {},
    async <T>(name: string, args: Record<string, unknown>) => {
      if (name === "audio_route_push") packets.push(String(args.id));
      return (
        name === "audio_route_status"
          ? { pendingSeconds: 0, failed: false }
          : undefined
      ) as T;
    },
  );
  await player.unlock();
  const pending = player.enqueue(new Uint8Array([1, 2]));
  player.stop();
  await pending;
  await player.unlock();
  await player.enqueue(new Uint8Array([3, 4]));
  await player.idle();
  assert.equal(packets.length, 1);
  player.dispose();
});

test("native transport allow-list rejects user-named aggregates", () => {
  const devices = [
    device("aggregate", "Zoom + BH"),
    device("mic", "EarPods Microphone"),
  ];
  assert.deepEqual(
    physicalMicrophones(devices, ["EarPods Microphone"]).map((d) => d.deviceId),
    ["mic"],
  );
  assert.throws(() =>
    requirePhysicalMicrophone(devices, "aggregate", ["EarPods Microphone"]),
  );
});
test("a long TTS segment applies backpressure instead of truncating at eight seconds", async () => {
  let queued = 0,
    peak = 0,
    bytes = 0,
    polls = 0;
  const failures: string[] = [];
  const player = new NativePcmPlayer(
    "BlackHole 2ch",
    (error) => failures.push(error),
    async <T>(name: string, args: Record<string, unknown>) => {
      if (name === "audio_route_push") {
        const size = Buffer.from(String(args.audio), "base64").length;
        bytes += size;
        queued += size / 48000;
        peak = Math.max(peak, queued);
        if (queued > 8) throw new Error("Native ring overflow");
      }
      if (name === "audio_route_status") {
        queued = 0;
        polls++;
        return { pendingSeconds: 0, failed: false } as T;
      }
      return undefined as T;
    },
  );
  await player.unlock();
  const segment = new Uint8Array(48000 * 24);
  await player.enqueue(segment);
  await player.idle();
  assert.equal(bytes, segment.length);
  assert.ok(polls >= 4);
  assert.ok(peak <= 6);
  assert.deepEqual(failures, []);
  player.dispose();
});

test("native activity reports transitions once, including the idle timer", async () => {
  const changes: boolean[] = [];
  const player = new NativePcmPlayer(
    "BlackHole 2ch",
    () => {},
    async <T>(name: string) => {
      if (name === "audio_route_push")
        await new Promise((resolve) => setTimeout(resolve, 80));
      return (
        name === "audio_route_status"
          ? { pendingSeconds: 0, failed: false }
          : undefined
      ) as T;
    },
  );
  player.setActivityListener((active) => changes.push(active));
  await player.unlock();
  await player.enqueue(new Uint8Array([0, 1]));
  await new Promise((resolve) => setTimeout(resolve, 130));
  assert.deepEqual(
    changes,
    [true, false],
    "activity stops after a slow native acknowledgement without needing idle()",
  );
  await player.idle();
  player.dispose();
  assert.deepEqual(changes, [true, false]);
});

test("system microphone switching requires a live output session and uses its exact id", async () => {
  const calls: { command: string; id: unknown }[] = [];
  const player = new NativePcmPlayer(
    "Interprete",
    () => {},
    async <T>(command: string, args: Record<string, unknown>) => {
      calls.push({ command, id: args.id });
      return undefined as T;
    },
  );
  await assert.rejects(player.activateSystemMicrophone(), /stopped/);
  await player.unlock();
  await player.activateSystemMicrophone();
  assert.equal(calls[0].command, "audio_route_open");
  assert.deepEqual(calls[1], {
    command: "audio_route_activate",
    id: calls[0].id,
  });
  player.stop();
  await assert.rejects(player.activateSystemMicrophone(), /stopped/);
});
