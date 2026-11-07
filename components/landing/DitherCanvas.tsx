"use client";

import { useEffect, useRef } from "react";
import { prepCanvas } from "@/lib/canvas";
import { bayer, noise2 } from "@/lib/noise";

type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

/** Canvas that repaints a static generative image whenever its box changes size. */
function useStaticPaint(paint: Painter) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const run = () => {
      const r = prepCanvas(el);
      if (r) paint(r.ctx, r.w, r.h);
    };
    const ro = new ResizeObserver(run);
    ro.observe(el);
    return () => ro.disconnect();
  }, [paint]);
  return ref;
}

/** Bayer-dithered horizon glow behind the request-access form. */
const paintGlow: Painter = (ctx, w, h) => {
  const cell = 4;
  ctx.fillStyle = "#0A0B0D";
  ctx.fillRect(0, 0, w, h);
  const cx = w * 0.5;
  const cy = -h * 0.62;
  const rx = w * 0.66;
  const ry = h * 1.2;
  for (let y = 0; y < h; y += cell) {
    for (let x = 0; x < w; x += cell) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const d = Math.sqrt(dx * dx + dy * dy);
      let I =
        Math.exp(-Math.pow(d - 1, 2) / (2 * 0.075 * 0.075)) * 1.05 +
        0.32 * Math.exp(-Math.pow(d - 1.12, 2) / (2 * 0.16 * 0.16));
      I *= 0.55 + 0.45 * (1 - Math.min(1, Math.abs(x / w - 0.5) * 1.6));
      if (I > bayer(x / cell, y / cell)) {
        ctx.fillStyle = I > 0.92 ? "#DCEBFA" : I > 0.6 ? "#6EB6FF" : I > 0.35 ? "#2F6FB8" : "#1C2633";
        ctx.fillRect(x, y, cell - 1.4, cell - 1.4);
      }
    }
  }
};

export function DitherGlow({ className }: { className?: string }) {
  const ref = useStaticPaint(paintGlow);
  return <canvas ref={ref} aria-hidden="true" className={className} />;
}

const pillarPainters: Painter[] = [0, 1, 2].map((which) => (ctx, w, h) => {
  const cell = 8;
  ctx.fillStyle = "#0F1114";
  ctx.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += cell) {
    for (let x = 0; x < w; x += cell) {
      const xn = x / w;
      const yn = y / h;
      let v: number;
      if (which === 0) v = (1 - xn) * 0.5 + yn * 0.62 - 0.12;
      else if (which === 1) v = 1 - Math.sqrt(Math.pow((xn - 0.64) * 1.1, 2) + Math.pow(yn - 0.5, 2)) * 1.75;
      else v = 0.15 + yn * 0.85 - 0.18 * Math.sin(xn * 6.5 + 1.3);
      v += (noise2(xn * 5 + which * 13, yn * 4) - 0.5) * 0.45;
      const band = Math.floor(Math.max(0, Math.min(0.999, v)) * 6);
      const cx = x + cell / 2;
      const cy = y + cell / 2;
      if (band === 1) {
        ctx.fillStyle = "rgba(233,236,239,0.35)";
        ctx.fillRect(cx - 1, cy - 1, 2, 2);
      } else if (band === 2) {
        ctx.fillStyle = "#2F6FB8";
        ctx.fillRect(x + 2, y, 2, cell);
      } else if (band === 3) {
        if ((x / cell + y / cell) % 2 === 0) {
          ctx.fillStyle = "#E9ECEF";
          ctx.fillRect(x, y, cell, cell);
        }
      } else if (band === 4) {
        ctx.fillStyle = "#6EB6FF";
        ctx.beginPath();
        ctx.arc(cx, cy, 2.4, 0, Math.PI * 2);
        ctx.fill();
      } else if (band === 5) {
        ctx.fillStyle = "#1C2633";
        ctx.fillRect(x, y, cell, cell);
        ctx.fillStyle = "#4DA3FF";
        ctx.fillRect(x + 3, y + 3, 2, 2);
      }
    }
  }
});

/** Dot / bar / checker pattern art for the three membership cards. */
export function PillarArt({ which, className }: { which: 0 | 1 | 2; className?: string }) {
  const ref = useStaticPaint(pillarPainters[which]);
  return <canvas ref={ref} aria-hidden="true" className={className} />;
}
