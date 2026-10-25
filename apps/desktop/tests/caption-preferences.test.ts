import assert from "node:assert/strict";
import test from "node:test";
import {
  CAPTION_THEMES, DEFAULT_CAPTION_PREFERENCES,
  captionAppearance, captionContrast, captionPosition,
  loadCaptionPreferences, parseCaptionPreferences, saveCaptionPreferences,
} from "../src/lib/caption-preferences";

test("caption preferences reject invalid storage and clamp positions and opacity", () => {
  assert.deepEqual(parseCaptionPreferences(null), DEFAULT_CAPTION_PREFERENCES);
  assert.deepEqual(parseCaptionPreferences({ x: NaN, y: Infinity, size: "huge", theme: "__proto__", color: "red;display:none", opacity: "20" }), DEFAULT_CAPTION_PREFERENCES);
  const parsed = parseCaptionPreferences({ x: -1, y: 2, opacity: 120, size: "small", color: "#aBc123" });
  assert.equal(parsed.x, 0);
  assert.equal(parsed.y, 1);
  assert.equal(parsed.opacity, 100);
  assert.equal(parsed.size, "small");
  assert.equal(parsed.color, "#aBc123");
  assert.equal(parseCaptionPreferences({ monitor: "External display" }).monitor, "External display");
  assert.equal(parseCaptionPreferences({ monitor: "x".repeat(257) }).monitor, undefined);
  assert.equal(parseCaptionPreferences({ monitor: "" }).monitor, undefined);
});

test("browser caption placement uses normalized coordinates", () => {
  const original = { ...DEFAULT_CAPTION_PREFERENCES, x: 0.5, y: 0.5 };
  assert.deepEqual(captionPosition({ ...original, x: 1, y: 0 }), { left: "100%", top: "0%", transform: "translate(-100%, -0%)" });
});

test("preferences persist and notify the current window; corrupt storage recovers safely", () => {
  const originalStorage = globalThis.localStorage;
  const originalWindow = globalThis.window;
  let value = "";
  const events: string[] = [];
  globalThis.localStorage = {
    getItem: () => value, setItem: (_key, next) => { value = next; },
    length: 1, key: () => null, clear: () => { value = ""; }, removeItem: () => { value = ""; },
  };
  globalThis.window = { dispatchEvent: (event: Event) => { events.push(event.type); return true; } } as unknown as Window & typeof globalThis;
  try {
    const preferences = { ...DEFAULT_CAPTION_PREFERENCES, x: 0.7, size: "large" as const, monitor: "External display" };
    saveCaptionPreferences(preferences);
    assert.deepEqual(loadCaptionPreferences(), preferences);
    assert.deepEqual(events, ["interprete-caption-preferences-changed"]);
    value = "broken";
    assert.deepEqual(loadCaptionPreferences(), DEFAULT_CAPTION_PREFERENCES);
    globalThis.localStorage.setItem = () => { throw new Error("Storage full"); };
    assert.throws(() => saveCaptionPreferences(preferences), /Storage full/, "save failures remain visible to the editor");
  } finally {
    globalThis.localStorage = originalStorage;
    globalThis.window = originalWindow;
  }
});

test("theme presets remain readable and appearance preserves full text opacity", () => {
  for (const [theme, preset] of Object.entries(CAPTION_THEMES)) {
    const preferences = { ...DEFAULT_CAPTION_PREFERENCES, theme: theme as keyof typeof CAPTION_THEMES, color: preset.color, opacity: preset.opacity };
    assert.ok(captionContrast(preferences) >= 4.5);
    const style = captionAppearance(preferences);
    assert.equal(style.opacity, undefined, "only the background fades");
    assert.equal(style["--caption-color" as keyof typeof style], preset.color);
  }
  assert.equal(captionContrast({ ...DEFAULT_CAPTION_PREFERENCES, color: "#161615" }), 1);
  assert.match(captionAppearance({ ...DEFAULT_CAPTION_PREFERENCES, opacity: 0 }).textShadow!, /#000/);
  assert.match(captionAppearance({ ...DEFAULT_CAPTION_PREFERENCES, opacity: 0, color: "#000000" }).textShadow!, /#fff/);
});
