"use client";

import { useEffect, useRef } from "react";
import { hash2, noise2 } from "@/lib/noise";
import { prefersReducedMotion } from "@/lib/canvas";

const RAMP = " .:-=+tos%S8X#@";
/** A fuller-bodied version of the star so it reads at character-cell resolution. */
const ART_STAR =
  "M40 0C42 22 45 33 54 41C62 49 70 52 80 55C70 58 62 61 54 69C45 77 42 88 40 110C38 88 35 77 26 69C18 61 10 58 0 55C10 52 18 49 26 41C35 33 38 22 40 0Z";
const TIERS = ["rgba(120,160,205,0.55)", "#7fa8d6", "#a9c9ec", "#e6f0fb"];
const CELL_BG = ["rgba(60,96,140,0.10)", "rgba(60,96,140,0.20)", "rgba(74,116,166,0.30)", "rgba(110,150,200,0.38)"];

type Tracker = { x: number; y: number; w: number; h: number; tx: number; ty: number; tw: number; th: number; id: number; next: number };

function monoFamily(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--font-geist-mono").trim();
  return `${v ? v + ", " : ""}ui-monospace, SFMono-Regular, Menlo, monospace`;
}

/**
 * The Altron star drawn as a grid of character cells (an ASCII "specimen"),
 * slowly turning on its vertical axis, with two "SECTION" boxes that hop
 * between regions of the shape. Redraws at ~15 fps and only while visible.
 * `focusX` is where the star's center sits, as a fraction of the width.
 */
export function AsciiStar({ className, focusX = 0.5 }: { className?: string; focusX?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const focus = useRef(focusX);
  focus.current = focusX;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const still = prefersReducedMotion();
    const mono = monoFamily();
    const star = new Path2D(ART_STAR);
    const mask = document.createElement("canvas");
    const mctx = mask.getContext("2d", { willReadFrequently: true });
    if (!mctx) return;
    const trackers: Tracker[] = [0, 1].map((i) => ({ x: 0, y: 0, w: 0, h: 0, tx: 0, ty: 0, tw: 0, th: 0, id: 12 + i * 31, next: i * 1.3 }));
    let raf = 0;
    let last = -1e9;
    let visible = true;
    let seed = 1;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };

    const draw = (t: number) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
      }
      const ctx = el.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // backdrop: near-black navy falling to slate at the bottom
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "#04060a");
      g.addColorStop(0.55, "#070c14");
      g.addColorStop(1, "#24344a");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      // faint static specks
      ctx.fillStyle = "rgba(170,200,235,0.18)";
      for (let i = 0; i < 90; i++) {
        const sx = hash2(i, 7) * w;
        const sy = hash2(i, 13) * h;
        const tw = 0.5 + 0.5 * Math.sin(t * 1.3 + i);
        if (tw > 0.35) ctx.fillRect(sx, sy, 1.2, 1.2);
      }

      const cw = w < 700 ? 6 : 8;
      const ch = Math.round(cw * 1.25);
      const cols = Math.ceil(w / cw);
      const rows = Math.ceil(h / ch);
      if (mask.width !== cols || mask.height !== rows) {
        mask.width = cols;
        mask.height = rows;
      }

      // star mask at grid resolution; the 3D turn is a horizontal squash
      const turn = still ? 1 : 0.68 + 0.32 * Math.cos(t * 0.55);
      const breathe = still ? 1 : 1 + 0.025 * Math.sin(t * 1.1);
      const starH = Math.min(h * 0.78, w < 900 ? w * 1.15 : w * 0.6) / ch; // in rows
      const scale = (starH / 110) * breathe;
      const cxCells = (w * (w < 900 ? 0.5 : focus.current)) / cw;
      const cyCells = rows * 0.45;
      mctx.setTransform(1, 0, 0, 1, 0, 0);
      mctx.clearRect(0, 0, cols, rows);
      // cells are taller than wide, so stretch x to keep the star's proportions on screen
      mctx.setTransform(scale * turn * (ch / cw), 0, 0, scale, cxCells, cyCells);
      mctx.translate(-40, -55);
      mctx.fillStyle = "#fff";
      mctx.fill(star);
      const data = mctx.getImageData(0, 0, cols, rows).data;
      const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows && data[(y * cols + x) * 4 + 3] > 110;

      ctx.font = `600 ${Math.round(cw * 1.05)}px ${mono}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const frame = Math.floor(t * 6);
      const cellsIn: number[] = [];
      const buckets: [number, number, string][][] = [[], [], [], []];
      const minX = Math.max(0, Math.floor(cxCells - starH)), maxX = Math.min(cols, Math.ceil(cxCells + starH));
      for (let y = 0; y < rows; y++) {
        for (let x = minX; x < maxX; x++) {
          if (!inside(x, y)) {
            // a few loose dashes hugging the outline, like scan noise
            if ((inside(x + 1, y) || inside(x - 1, y)) && hash2(x * 3 + frame, y) > 0.86) {
              ctx.fillStyle = "rgba(127,168,214,0.35)";
              ctx.fillText("-", x * cw + cw / 2, y * ch + ch / 2);
            }
            continue;
          }
          cellsIn.push(y * cols + x);
          const edge = !inside(x + 1, y) || !inside(x - 1, y) || !inside(x, y + 1) || !inside(x, y - 1);
          const dx = (x - cxCells) / (starH * 0.5);
          const dy = (y - cyCells) / (starH * 0.5);
          const core = Math.max(0, 1 - Math.sqrt(dx * dx * 4 + dy * dy * 4));
          let I = edge ? 0.95 : 0.32 + 0.42 * noise2(x * 0.18, y * 0.18 + t * 0.35) + 0.35 * core;
          if (hash2(x + frame * 17, y * 7) > 0.97) I = Math.min(1, I + 0.35); // flicker
          I = Math.max(0, Math.min(0.999, I));
          const tier = Math.min(3, Math.floor(I * 4));
          const gi = Math.max(1, Math.min(RAMP.length - 1, Math.floor(I * RAMP.length + (hash2(x, y + frame) - 0.5) * 2)));
          ctx.fillStyle = CELL_BG[tier];
          ctx.fillRect(x * cw + 1, y * ch + 1, cw - 2, ch - 2);
          buckets[tier].push([x * cw + cw / 2, y * ch + ch / 2 + 0.5, RAMP[gi]]);
        }
      }
      for (let k = 0; k < 4; k++) {
        ctx.fillStyle = TIERS[k];
        for (const [px, py, c] of buckets[k]) ctx.fillText(c, px, py);
      }

      // SECTION trackers hop between regions of the shape and ease into place
      if (cellsIn.length > 40) {
        ctx.font = `600 11px ${mono}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        for (const tr of trackers) {
          if (t >= tr.next || tr.tw === 0) {
            const pick = cellsIn[Math.floor(rnd() * cellsIn.length)];
            const px = pick % cols;
            const py = Math.floor(pick / cols);
            tr.tw = (5 + Math.floor(rnd() * 5)) * cw;
            tr.th = (5 + Math.floor(rnd() * 6)) * ch;
            tr.tx = px * cw - tr.tw * 0.3;
            tr.ty = Math.max(28, Math.min(h - tr.th - 8, py * ch - tr.th * 0.3));
            tr.id = 10 + Math.floor(rnd() * 89);
            tr.next = t + 2 + rnd() * 1.8;
            if (tr.w === 0) Object.assign(tr, { x: tr.tx, y: tr.ty, w: tr.tw, h: tr.th });
          }
          const k = still ? 1 : 0.18;
          tr.x += (tr.tx - tr.x) * k;
          tr.y += (tr.ty - tr.y) * k;
          tr.w += (tr.tw - tr.w) * k;
          tr.h += (tr.th - tr.h) * k;
          ctx.strokeStyle = "rgba(233,239,246,0.75)";
          ctx.lineWidth = 1;
          ctx.strokeRect(Math.round(tr.x) + 0.5, Math.round(tr.y) + 0.5, Math.round(tr.w), Math.round(tr.h));
          const label = `SECTION ${tr.id}`;
          const lw = ctx.measureText(label).width + 12;
          ctx.fillStyle = "#e9eff6";
          ctx.fillRect(Math.round(tr.x), Math.round(tr.y) - 18, lw, 18);
          ctx.fillStyle = "#0a0f16";
          ctx.fillText(label, Math.round(tr.x) + 6, Math.round(tr.y) - 8.5);
        }
      }
    };

    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || ts - last < 66) return;
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
