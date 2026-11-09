"use client";

import { switchTheme, useTheme } from "@/lib/theme";
import s from "./theme-switch.module.css";

/**
 * Theme switch: a small circle, half filled. The filled half turns over when
 * the theme changes, and a disc grows in behind it on hover.
 */
export function ThemeSwitch({ className }: { className?: string }) {
  const theme = useTheme();
  const next = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      className={`${s.switch} ${className ?? ""}`}
      data-on={theme}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => switchTheme(next)}
    >
      <span className={s.dot} aria-hidden="true" />
    </button>
  );
}
