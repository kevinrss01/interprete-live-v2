import { useEffect, useState, type CSSProperties } from "react";

export const CAPTION_THEMES = {
  dark: { label: "Dark", background: "#161615", color: "#fafaf9", opacity: 86 },
  light: { label: "Light", background: "#fafaf9", color: "#1b1b1a", opacity: 96 },
  clear: { label: "Transparent", background: "#161615", color: "#ffffff", opacity: 0 },
} as const;
export const CAPTION_SIZES = {
  small: { label: "Small", width: 720, font: 21, lines: 110 },
  medium: { label: "Medium", width: 980, font: 26, lines: 148 },
  large: { label: "Large", width: 1180, font: 32, lines: 184 },
} as const;
export type CaptionLayout = { x: number; y: number; size: keyof typeof CAPTION_SIZES; monitor?: string };
export type CaptionPreferences = CaptionLayout & {
  theme: keyof typeof CAPTION_THEMES;
  opacity: number;
  color: string;
};
export const DEFAULT_CAPTION_PREFERENCES: CaptionPreferences = {
  x: 0.5, y: 1, size: "medium", theme: "dark", opacity: 86, color: "#fafaf9",
};
const KEY = "interprete-caption-preferences";
const CHANGED = "interprete-caption-preferences-changed";
const bounded = (value: unknown, fallback: number, max = 1) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : fallback;

export function parseCaptionPreferences(value: unknown): CaptionPreferences {
  const p = value && typeof value === "object" ? value as Partial<CaptionPreferences> : {};
  return {
    x: bounded(p.x, 0.5), y: bounded(p.y, 1),
    ...(typeof p.monitor === "string" && p.monitor.length > 0 && p.monitor.length <= 256 ? { monitor: p.monitor } : {}),
    size: typeof p.size === "string" && Object.hasOwn(CAPTION_SIZES, p.size) ? p.size : "medium",
    theme: typeof p.theme === "string" && Object.hasOwn(CAPTION_THEMES, p.theme) ? p.theme : "dark",
    opacity: bounded(p.opacity, 86, 100),
    color: typeof p.color === "string" && /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : "#fafaf9",
  };
}
export function loadCaptionPreferences() {
  try { return parseCaptionPreferences(JSON.parse(localStorage.getItem(KEY) || "null")); }
  catch { return { ...DEFAULT_CAPTION_PREFERENCES }; }
}
export function saveCaptionPreferences(preferences: CaptionPreferences) {
  localStorage.setItem(KEY, JSON.stringify(parseCaptionPreferences(preferences)));
  window.dispatchEvent(new Event(CHANGED));
}
export function useCaptionPreferences() {
  const [preferences, setPreferences] = useState(loadCaptionPreferences);
  useEffect(() => {
    const update = () => setPreferences(loadCaptionPreferences());
    window.addEventListener(CHANGED, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(CHANGED, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return preferences;
}
export function captionAppearance(p: CaptionPreferences): CSSProperties {
  const theme = CAPTION_THEMES[p.theme];
  const size = CAPTION_SIZES[p.size];
  return {
    "--caption-background": `rgb(${parseInt(theme.background.slice(1, 3), 16)} ${parseInt(theme.background.slice(3, 5), 16)} ${parseInt(theme.background.slice(5, 7), 16)} / ${p.opacity}%)`,
    "--caption-color": p.color,
    "--caption-font": `${size.font}px`,
    "--caption-lines": `${size.lines}px`,
    textShadow: p.opacity < 40
      ? luminance(p.color) > 0.3 ? "0 1px 3px #000, 0 0 8px #000" : "0 1px 3px #fff, 0 0 8px #fff"
      : "none",
  } as CSSProperties;
}
export function captionPosition(p: CaptionLayout): CSSProperties {
  return { left: `${p.x * 100}%`, top: `${p.y * 100}%`, transform: `translate(-${p.x * 100}%, -${p.y * 100}%)` };
}
function luminance(hex: string) {
  const channels = [1, 3, 5].map((at) => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
// Opacity and the app underneath affect real contrast; this checks the selected solid background.
export function captionContrast(p: CaptionPreferences) {
  const a = luminance(p.color), b = luminance(CAPTION_THEMES[p.theme].background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
