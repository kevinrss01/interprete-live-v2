import assert from "node:assert/strict";
import test from "node:test";
import { scrollFromPointer, scrollbarThumb } from "../src/lib/scrollbar";

test("the custom scrollbar hides until the page can scroll", () => {
  assert.deepEqual(scrollbarThumb({ scrollY: 0, scrollHeight: 800, viewport: 800 }), { hidden: true });
  const thumb = scrollbarThumb({ scrollY: 100, scrollHeight: 2000, viewport: 800 });
  assert.equal(thumb.hidden, false);
  if (thumb.hidden) return;
  assert.equal(thumb.height, 320);
  assert.ok(thumb.offset > 0);
});

test("dragging the thumb maps pointer travel back to the page", () => {
  assert.equal(scrollFromPointer({ originScroll: 40, deltaY: 10, scrollable: 200, travel: 100 }), 60);
  assert.equal(scrollFromPointer({ originScroll: 40, deltaY: 10, scrollable: 200, travel: 0 }), 2040);
});
