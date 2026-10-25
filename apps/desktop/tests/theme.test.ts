import assert from "node:assert/strict";
import test from "node:test";
import { applyTheme, loadTheme, parseTheme, saveTheme } from "../src/lib/theme";

test("theme storage accepts only light and dark and defaults to light", () => {
  assert.equal(parseTheme("dark"), "dark");
  assert.equal(parseTheme("light"), "light");
  assert.equal(parseTheme("system"), "light");
  assert.equal(parseTheme(null), "light");
});

test("theme persists, paints the document, and skips satellite windows", () => {
  const originalStorage = globalThis.localStorage;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalLocation = globalThis.location;
  let value: string | null = null;
  const events: string[] = [];
  const classes = new Set<string>();
  const meta = { content: "#fafaf9", setAttribute: (_name: string, value: string) => { meta.content = value; } };
  globalThis.localStorage = {
    getItem: () => value,
    setItem: (_key, next) => { value = next; },
    length: 0,
    key: () => null,
    clear: () => { value = null; },
    removeItem: () => { value = null; },
  };
  globalThis.window = { dispatchEvent: (event: Event) => { events.push(event.type); return true; } } as unknown as Window & typeof globalThis;
  globalThis.document = {
    documentElement: {
      classList: {
        toggle(name: string, on: boolean) {
          if (on) classes.add(name);
          else classes.delete(name);
          return on;
        },
      },
      style: {},
    },
    querySelector: () => meta,
  } as unknown as Document;
  globalThis.location = { hash: "" } as Location;
  try {
    saveTheme("dark");
    assert.equal(loadTheme(), "dark");
    assert.equal(classes.has("dark"), true);
    assert.equal(meta.content, "#141413");
    assert.deepEqual(events, ["interprete-theme-changed"]);
    saveTheme("light");
    assert.equal(loadTheme(), "light");
    assert.equal(classes.has("dark"), false);
    assert.equal(meta.content, "#fafaf9");
    value = "nope";
    assert.equal(loadTheme(), "light");
    location.hash = "#call-captions";
    applyTheme("dark");
    assert.equal(classes.has("dark"), false, "caption and toast windows keep their own colors");
  } finally {
    globalThis.localStorage = originalStorage;
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.location = originalLocation;
  }
});
