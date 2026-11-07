"use client";

import { useEffect, useRef } from "react";
import { bayer, noise2, ridge } from "@/lib/noise";

const PALETTE: [number, number, number][] = [
  [10, 11, 13],
  [20, 28, 38],
  [44, 62, 80],
  [88, 110, 132],
  [168, 181, 194],
  [226, 232, 238],
];

const RIDGES = [
  { base: 0.5, amp: 0.22, freq: 2.2, seed: 3.1, tone: 2.25, peak: 0.63 },
  { base: 0.62, amp: 0.2, freq: 1.7, seed: 9.4, tone: 1.45, peak: 0.25 },
  { base: 0.76, amp: 0.16, freq: 1.3, seed: 17.2, tone: 0.75, peak: 0.85 },
];

/** Three ridgelines under a slate sky, ordered-dithered at 1/3 resolution and scaled up pixelated. */
export function MountainScene({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const paint = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      const cell = 3;
      const gw = Math.ceil(w / cell);
      const gh = Math.ceil(h / cell);
      el.width = gw;
      el.height = gh;
      const ctx = el.getContext("2d");
      if (!ctx) return;
      const img = ctx.createImageData(gw, gh);
      const D = img.data;
      const tops = RIDGES.map((r) => {
        const arr = new Float32Array(gw);
        for (let x = 0; x < gw; x++) {
          const xn = x / gw;
          const env = 0.45 + 0.75 * Math.exp(-Math.pow((xn - r.peak) / 0.2, 2));
          arr[x] = (r.base - ridge(xn * r.freq, r.seed, 4) * r.amp * env) * gh;
        }
        return arr;
      });
      const sunX = gw * 0.63;
      const sunY = gh * 0.3;
      for (let y = 0; y < gh; y++) {
        const yn = y / gh;
        for (let x = 0; x < gw; x++) {
          let layer = -1;
          for (let k = 0; k < RIDGES.length; k++) if (y >= tops[k][x]) layer = k;
          let tone: number;
          if (layer < 0) {
            const dx = (x - sunX) / gw;
            const dy = (y - sunY) / gh;
            const glow = Math.exp(-(dx * dx * 2.2 + dy * dy * 5.5) * 6);
            tone = 0.4 + yn * 3.4 + glow * 2.6;
            if (yn < 0.42) tone += (noise2((x / gw) * 4 + 2, yn * 14) - 0.5) * 0.9 * (1 - yn);
          } else {
            const r = RIDGES[layer];
            const depth = (y - tops[layer][x]) / gh;
            const lit = tops[layer][Math.max(0, x - 1)] - tops[layer][x];
            const crest = Math.exp(-depth * 14);
            tone = r.tone + Math.max(-0.5, Math.min(1.2, lit * 0.6)) * crest - depth * 2.6;
            tone += (noise2((x / gw) * 9 + layer * 5, yn * 30) - 0.5) * 0.8 + (noise2((x / gw) * 40, yn * 40) - 0.5) * 0.35;
          }
          tone = Math.max(0, Math.min(5.999, tone));
          const lo = Math.floor(tone);
          let idx = tone - lo > bayer(x, y) ? Math.min(5, lo + 1) : lo;
          const c = PALETTE[idx];
          const o = (y * gw + x) * 4;
          D[o] = c[0];
          D[o + 1] = c[1];
          D[o + 2] = c[2];
          D[o + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    };
    const ro = new ResizeObserver(paint);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return <canvas ref={ref} aria-hidden="true" className={className} />;
}
