import assert from "node:assert/strict";
import test from "node:test";
import {
  OverlayPublisher,
  idleOverlay,
  newestOverlay,
  type OverlaySnapshot,
  type OverlayUpdate,
} from "../src/lib/translation-overlay";

const live: OverlayUpdate = {
  sessionId: "session-one",
  phase: "listening",
  source: "fr",
  target: "en",
  test: false,
};
test("overlay state updates remain ordered when a stop follows a pending show", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls: unknown[] = [];
  const publisher = new OverlayPublisher(
    async <T>(_command: string, args: Record<string, unknown>) => {
      calls.push(args.update);
      if (calls.length === 1) await blocked;
      return undefined as T;
    },
  );
  const showing = publisher.publish(live);
  const hidden = publisher.publish(null);
  await Promise.resolve();
  assert.deepEqual(calls, [live]);
  release();
  await Promise.all([showing, hidden]);
  assert.deepEqual(calls, [live, idleOverlay]);
});
test("a failed show cannot prevent the next hide from reaching the native window", async () => {
  const calls: unknown[] = [];
  const publisher = new OverlayPublisher(
    async <T>(_command: string, args: Record<string, unknown>) => {
      calls.push(args.update);
      if (calls.length === 1) throw new Error("Window unavailable");
      return undefined as T;
    },
  );
  await assert.rejects(publisher.publish(live), /Window unavailable/);
  await publisher.publish(null);
  assert.deepEqual(calls, [live, idleOverlay]);
});
test("an older initial snapshot cannot resurrect a stopped overlay", () => {
  const active: OverlaySnapshot = {
    ...live,
    revision: 4,
    stopRequested: false,
  };
  const stopped: OverlaySnapshot = {
    ...idleOverlay,
    revision: 5,
    stopRequested: false,
  };
  assert.equal(newestOverlay(stopped, active), stopped);
  assert.equal(newestOverlay(active, stopped), stopped);
  assert.equal(newestOverlay(null, active), active);
});
