import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TranslationPill } from "../src/windows/translation-overlay";
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
test("the card exposes full language names, both directions and options while stopping", () => {
  const html = renderToStaticMarkup(createElement(TranslationPill, {
    session: { ...live, bidirectional: true },
    stopping: true,
    onStop: () => {},
    onOptions: () => {},
    onExpand: () => {},
    expanded: true,
  }));
  assert.match(html, /French/);
  assert.match(html, /English/);
  assert.match(html, /to and from/);
  assert.match(html, /Stopping…/);
  assert.match(html, /aria-expanded="true" aria-label="Translation options"/);
  assert.match(html, /All translation settings/);
  assert.match(html, /disabled="" aria-label="Stop live translation"/);
});
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
