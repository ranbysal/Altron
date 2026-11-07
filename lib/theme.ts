"use client";

import { useEffect, useState } from "react";

import { THEME_KEY } from "./theme-boot";

export type Theme = "dark" | "light";

export function currentTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function setTheme(t: Theme) {
  const d = document.documentElement;
  d.dataset.theme = t;
  d.style.colorScheme = t;
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* private mode */
  }
}

/** Calls `cb` whenever <html data-theme> changes. Returns an unsubscribe function. */
export function onThemeChange(cb: (t: Theme) => void): () => void {
  const mo = new MutationObserver(() => cb(currentTheme()));
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}

/** Current theme as React state; "dark" during SSR, then the real value after mount. */
export function useTheme(): Theme {
  const [t, setT] = useState<Theme>("dark");
  useEffect(() => {
    setT(currentTheme());
    return onThemeChange(setT);
  }, []);
  return t;
}

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

type VTDoc = Document & { startViewTransition?: (cb: () => void) => unknown };

/** Switch theme with a soft crossfade (View Transitions API where supported). */
export function switchTheme(t: Theme) {
  const doc = document as VTDoc;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (!doc.startViewTransition || reduce) {
    setTheme(t);
    return;
  }
  doc.startViewTransition(() => setTheme(t));
}
