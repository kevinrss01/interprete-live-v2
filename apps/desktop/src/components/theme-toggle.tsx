import { Moon, Sun } from "lucide-react";
import { useTheme } from "../lib/theme";

export function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      className="icon-btn theme-toggle"
      aria-pressed={dark}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      <Sun className="theme-icon theme-icon-sun" size={16} aria-hidden="true" />
      <Moon className="theme-icon theme-icon-moon" size={16} aria-hidden="true" />
    </button>
  );
}
