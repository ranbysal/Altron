"use client";

import { switchTheme, useTheme } from "@/lib/theme";
import s from "./theme-switch.module.css";

/**
 * Theme switch: the current theme's letter (D or L) rolls vertically to the
 * other one, next to a small hollow circle. A disc grows in behind on hover.
 */
export function ThemeSwitch({ className }: { className?: string }) {
  const theme = useTheme();
  const next = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      className={`${s.switch} ${className ?? ""}`}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => switchTheme(next)}
    >
      <span className={s.window} aria-hidden="true">
        <span className={s.strip} data-theme-active={theme}>
          <span>D</span>
          <span>L</span>
        </span>
      </span>
      <span className={s.dot} aria-hidden="true" />
    </button>
  );
}
