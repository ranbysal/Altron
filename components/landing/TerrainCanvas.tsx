"use client";

import { useEffect, useRef } from "react";
import { noise2 } from "@/lib/noise";
import { prepCanvas, prefersReducedMotion } from "@/lib/canvas";

const SHADES = [
  "rgba(233,236,239,0.16)",
  "rgba(233,236,239,0.30)",
  "rgba(233,236,239,0.46)",
  "rgba(233,236,239,0.62)",
  "rgba(233,236,239,0.80)",
  "rgba(244,247,250,0.96)",
  "rgba(110,182,255,0.95)", // scan line
];

/**
 * Point-cloud mountain range. Rows are drawn far → near; each row first
 * fills its silhouette in the ground color so nearer ridges hide farther
 * points, then plots its points bucketed by brightness.
 */
export function TerrainCanvas({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const still = prefersReducedMotion();
    let raf = 0;
    let last = -1e9;
    let visible = true;
    let buf: { cols: number; ys: Float32Array; hs: Float32Array; bx: Float32Array[]; by: Float32Array[]; bn: number[] } | null =
      null;

    const draw = (time: number) => {
      const r = prepCanvas(el);
      if (!r) return;
      const { ctx, w, h } = r;
      ctx.fillStyle = "#0A0B0D";
      ctx.fillRect(0, 0, w, h);
      const step = w < 700 ? 4 : 3;
      const cols = Math.ceil(w / step) + 1;
      const rows = w < 700 ? 56 : 78;
      const horizon = h * 0.24;
      const drift = time * 0.03;
      const scan = 0.45 + ((time * 0.03) % 0.75);
      if (!buf || buf.cols !== cols) {
        buf = { cols, ys: new Float32Array(cols), hs: new Float32Array(cols), bx: [], by: [], bn: [] };
        for (let q = 0; q < SHADES.length; q++) {
          buf.bx.push(new Float32Array(cols));
          buf.by.push(new Float32Array(cols));
          buf.bn.push(0);
        }
      }
      const { ys, hs, bx, by, bn } = buf;
      for (let i = rows - 1; i >= 0; i--) {
        const t = i / (rows - 1);
        const yb = h * 1.04 - (h * 1.04 - horizon) * Math.pow(t, 0.7);
        const amp = h * 0.44 * (1 - t * 0.6);
        const spread = 1 + (1 - t) * 0.5;
        const zz = t * 3.4 + 7.3;
        for (let c = 0; c < cols; c++) {
          const xn = (c * step) / w;
          const xw = (xn - 0.5) / spread + 0.5;
          const env =
            0.16 +
            0.95 * Math.exp(-Math.pow((xw - 0.7) / 0.19, 2)) +
            0.32 * Math.exp(-Math.pow((xw - 0.33) / 0.15, 2));
          const sx = xw * 3.1 + drift;
          let r1 = 1 - Math.abs(noise2(sx, zz) * 2 - 1);
          r1 *= r1;
          let r2 = 1 - Math.abs(noise2(sx * 2.3 + 5, zz * 2.1) * 2 - 1);
          r2 *= r2;
          const n3 = noise2(sx * 6 + 11, zz * 5);
          const hv = (0.62 * r1 + 0.28 * r2 + 0.1 * n3) * env;
          hs[c] = hv;
          ys[c] = yb - hv * amp;
        }
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let c = 0; c < cols; c++) ctx.lineTo(c * step, ys[c]);
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fillStyle = "#0A0B0D";
        ctx.fill();

        const fade = 0.2 + 0.8 * Math.pow(1 - t, 0.8);
        bn.fill(0);
        for (let c = 1; c < cols; c++) {
          const slope = ys[c - 1] - ys[c];
          const b = (0.2 + hs[c] * 0.95 + slope * 0.1) * fade;
          if (b < 0.06) continue;
          let k = Math.min(5, Math.floor(b * 6));
          const x = c * step;
          if (Math.abs(x / w - scan) < 0.004 && hs[c] > 0.18 && t < 0.85) k = 6;
          bx[k][bn[k]] = x;
          by[k][bn[k]] = ys[c];
          bn[k]++;
        }
        const sz = 1 + (1 - t) * 1.1;
        for (let k = 0; k < SHADES.length; k++) {
          const n = bn[k];
          if (!n) continue;
          ctx.fillStyle = SHADES[k];
          const X = bx[k];
          const Y = by[k];
          for (let j = 0; j < n; j++) ctx.fillRect(X[j], Y[j], sz, sz);
        }
      }
    };

    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || ts - last < 42) return;
      last = ts;
      draw(ts / 1000);
    };

    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(el);

    let ro: ResizeObserver | null = null;
    if (still) {
      ro = new ResizeObserver(() => draw(0));
      ro.observe(el);
    } else {
      raf = requestAnimationFrame(loop);
    }
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro?.disconnect();
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className={className} />;
}
