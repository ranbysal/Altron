"use client";

import { useRef, type CSSProperties } from "react";
import { prefersReducedMotion } from "@/lib/canvas";
import { switchTheme, useTheme } from "@/lib/theme";
import s from "./theme-switch.module.css";

/*
 * A small glass toggle. The knob carries a moon or a sun drawn in the same
 * square pixels as the site's dither, and on a switch the pixels scatter and
 * settle into the other icon while the knob slides across.
 */

const G = 11;
const PITCH = 1.5;
type P = [number, number];

function moon(): P[] {
  const out: P[] = [];
  for (let y = 0; y < G; y++)
    for (let x = 0; x < G; x++) {
      const inDisc = (x - 5) ** 2 + (y - 5) ** 2 <= 20.3;
      const inBite = (x - 7.7) ** 2 + (y - 3) ** 2 <= 11.6;
      if (inDisc && !inBite) out.push([x, y]);
    }
  // a small sparkle in the bite
  out.push([9, 0], [8, 1], [9, 1], [10, 1], [9, 2]);
  return out;
}

function sun(): P[] {
  const out: P[] = [];
  for (let y = 0; y < G; y++)
    for (let x = 0; x < G; x++) if ((x - 5) ** 2 + (y - 5) ** 2 <= 5.06) out.push([x, y]);
  out.push([5, 1], [5, 9], [1, 5], [9, 5], [5, 0], [5, 10], [0, 5], [10, 5]);
  out.push([2, 2], [8, 2], [2, 8], [8, 8]);
  return out;
}

const byAngle = (ps: P[]) => ps.slice().sort((a, b) => Math.atan2(a[1] - 5, a[0] - 5) - Math.atan2(b[1] - 5, b[0] - 5));
const MOON = byAngle(moon());
const SUN = byAngle(sun());
const N = Math.max(MOON.length, SUN.length);
const at = (ps: P[], k: number): P => ps[Math.floor((k * ps.length) / N)];
const px = ([x, y]: P) => `translate(${(x * PITCH).toFixed(2)}px, ${(y * PITCH).toFixed(2)}px)`;

export function ThemeSwitch({ className }: { className?: string }) {
  const theme = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  const dots = useRef<(HTMLElement | null)[]>([]);

  const flip = () => {
    if (!prefersReducedMotion()) {
      const from = theme === "dark" ? MOON : SUN;
      const to = theme === "dark" ? SUN : MOON;
      dots.current.forEach((el, k) => {
        if (!el) return;
        const a = at(from, k);
        const b = at(to, k);
        const ang = Math.random() * Math.PI * 2;
        const r = 3 + Math.random() * 5;
        const mid: P = [(a[0] + b[0]) / 2 + (Math.cos(ang) * r) / PITCH, (a[1] + b[1]) / 2 + (Math.sin(ang) * r) / PITCH];
        el.animate(
          [
            { transform: px(a), opacity: 1 },
            { transform: px(mid), opacity: 0.35, offset: 0.45 },
            { transform: px(b), opacity: 1 },
          ],
          { duration: 620 + Math.random() * 180, delay: Math.random() * 120, easing: "cubic-bezier(0.45, 0, 0.2, 1)", fill: "backwards" },
        );
      });
    }
    switchTheme(next);
  };

  const icon = theme === "dark" ? MOON : SUN;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={theme === "light"}
      className={`${s.switch} ${className ?? ""}`}
      data-on={theme}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={flip}
    >
      <span className={s.knob} aria-hidden="true">
        <span className={s.icon}>
          {Array.from({ length: N }, (_, k) => (
            <i
              key={k}
              ref={(el) => {
                dots.current[k] = el;
              }}
              style={{ transform: px(at(icon, k)) } as CSSProperties}
            />
          ))}
        </span>
      </span>
    </button>
  );
}
