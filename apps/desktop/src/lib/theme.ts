import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

const KEY = "interprete-theme";
const CHANGED = "interprete-theme-changed";
// Satellite windows paint their own surfaces. Keep this list in sync with the
// script in apps/desktop/index.html, which runs before the bundle.
const SATELLITE_HASHES = new Set(["#translation-overlay", "#call-toast", "#call-captions"]);

export function parseTheme(value: unknown): Theme {
  return value === "dark" ? "dark" : "light";
}

export function loadTheme(): Theme {
  try {
    return parseTheme(localStorage.getItem(KEY));
  } catch {
    return "light";
  }
}

export function applyTheme(theme: Theme) {
  if (typeof document === "undefined" || SATELLITE_HASHES.has(location.hash)) return;
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#141413" : "#fafaf9");
}

export function saveTheme(theme: Theme) {
  const next = parseTheme(theme);
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // The choice still applies for this session when storage is unavailable.
  }
  applyTheme(next);
  window.dispatchEvent(new Event(CHANGED));
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState(loadTheme);
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  useEffect(() => {
    const update = () => setTheme(loadTheme());
    window.addEventListener(CHANGED, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(CHANGED, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return [theme, saveTheme];
}
