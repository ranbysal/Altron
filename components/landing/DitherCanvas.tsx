"use client";

import { useEffect, useRef } from "react";
import { prepCanvas } from "@/lib/canvas";
import { bayer } from "@/lib/noise";
import { cssVar, onThemeChange } from "@/lib/theme";

type Variant = "horizon" | "bowl";

/**
 * Bayer-dithered glow band, painted once (and again on resize or theme change).
 * - "horizon": a dome rising from the bottom edge (hero)
 * - "bowl": an arc hanging from the top edge (request-access section)
 */
export function DitherGlow({ variant, className }: { variant: Variant; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const paint = () => {
      const r = prepCanvas(el);
      if (!r) return;
      const { ctx, w, h } = r;
      const cell = w < 700 ? 3 : 4;
      const c0 = cssVar("--cv-dither-0");
      const c1 = cssVar("--cv-dither-1");
      const c2 = cssVar("--cv-dither-2");
      const c3 = cssVar("--cv-dither-3");
      ctx.clearRect(0, 0, w, h);

      // ellipse the band follows
      const horizon = variant === "horizon";
      const cx = w * 0.5;
      const cy = horizon ? h * 1.78 : -h * 0.62;
      const rx = Math.max(w * 0.66, 520);
      const ry = h * (horizon ? 1.02 : 1.2);
      const band = horizon ? 0.06 : 0.075;
      const spread = horizon ? 0.22 : 0.16;

      for (let y = 0; y < h; y += cell) {
        for (let x = 0; x < w; x += cell) {
          const dx = (x - cx) / rx;
          const dy = (y - cy) / ry;
          const d = Math.sqrt(dx * dx + dy * dy);
          const inner = horizon ? 0.9 : 1.12;
          let I =
            Math.exp(-Math.pow(d - 1, 2) / (2 * band * band)) * 1.05 +
            0.32 * Math.exp(-Math.pow(d - inner, 2) / (2 * spread * spread));
          I *= 0.55 + 0.45 * (1 - Math.min(1, Math.abs(x / w - 0.5) * 1.6));
          if (I > bayer(x / cell, y / cell)) {
            ctx.fillStyle = I > 0.92 ? c3 : I > 0.6 ? c2 : I > 0.35 ? c1 : c0;
            ctx.fillRect(x, y, cell - 1.4, cell - 1.4);
          }
        }
      }
    };
    const ro = new ResizeObserver(paint);
    ro.observe(el);
    const off = onThemeChange(paint);
    return () => {
      ro.disconnect();
      off();
    };
  }, [variant]);

  return <canvas ref={ref} aria-hidden="true" className={className} />;
}
