"use client";

import { useEffect, useRef } from "react";
import { prepCanvas } from "@/lib/canvas";
import { fmt, hhmm, toTick } from "@/lib/format";
import { POSITION, SESSION_OPEN_MIN, type FeedSim } from "@/lib/feed";
import { cssVar, onThemeChange } from "@/lib/theme";

function readPalette() {
  const v = (n: string) => cssVar(`--cv-${n}`);
  return {
    up: v("candle-up"), down: v("candle-down"), grid: v("grid"), axis: v("axis"), entry: v("entry"),
    tp: v("tp"), sl: v("sl"), zoneUp: v("zone-up"), zoneDown: v("zone-down"), tipBg: v("tip-bg"),
    tipLine: v("tip-line"), cross: v("cross"), crossTag: v("cross-tag"), text: cssVar("--text"), ink: "#04101C",
  };
}

function monoFamily(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--font-geist-mono").trim();
  return `${v ? v + ", " : ""}ui-monospace, SFMono-Regular, Menlo, monospace`;
}

/** One-minute candles with the open position's entry, stop and target zones. Redraws ~10×/s. */
export function CandleChart({ sim, className }: { sim: FeedSim; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hover = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    let last = 0;
    let visible = true;
    const MONO = monoFamily();
    let P = readPalette();
    const offTheme = onThemeChange(() => (P = readPalette()));
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(el);

    const draw = () => {
      const r = prepCanvas(el);
      if (!r) return;
      const { ctx, w, h } = r;
      const C = sim.candles;
      const N = C.length;
      ctx.clearRect(0, 0, w, h);
      const axisW = 76;
      const padT = 14;
      const padB = 26;
      const plotW = w - axisW;
      const plotH = h - padT - padB;
      let lo = Infinity;
      let hi = -Infinity;
      for (const c of C) {
        lo = Math.min(lo, c.l);
        hi = Math.max(hi, c.h);
      }
      lo = Math.min(lo, POSITION.stop);
      hi = Math.max(hi, POSITION.target);
      const pad = (hi - lo) * 0.08;
      lo -= pad;
      hi += pad;
      const Y = (v: number) => padT + ((hi - v) / (hi - lo)) * plotH;
      const slot = plotW / N;
      const bw = Math.max(1.5, slot * 0.6);
      ctx.font = `500 11px ${MONO}`;
      ctx.textBaseline = "middle";

      for (let g = 0; g <= 5; g++) {
        const gv = lo + ((hi - lo) * g) / 5;
        const gy = Y(gv);
        ctx.fillStyle = P.grid;
        ctx.fillRect(0, Math.round(gy), plotW, 1);
        ctx.fillStyle = P.axis;
        ctx.textAlign = "left";
        ctx.fillText(fmt(toTick(gv)), plotW + 10, gy);
      }

      const ei = C.findIndex((c) => c.t === POSITION.entryMinute);
      const zx = ei >= 0 ? (ei + 0.5) * slot : 0;
      ctx.fillStyle = P.zoneUp;
      ctx.fillRect(zx, Y(POSITION.target), plotW - zx, Y(POSITION.entry) - Y(POSITION.target));
      ctx.fillStyle = P.zoneDown;
      ctx.fillRect(zx, Y(POSITION.entry), plotW - zx, Y(POSITION.stop) - Y(POSITION.entry));

      for (let j = 0; j < N; j++) {
        const cd = C[j];
        const x = (j + 0.5) * slot;
        ctx.fillStyle = cd.c >= cd.o ? P.up : P.down;
        ctx.fillRect(Math.round(x) - 0.5, Y(cd.h), 1, Math.max(1, Y(cd.l) - Y(cd.h)));
        const top = Y(Math.max(cd.o, cd.c));
        ctx.fillRect(x - bw / 2, top, bw, Math.max(1.5, Math.abs(Y(cd.o) - Y(cd.c))));
      }

      const level = (v: number, col: string, label: string) => {
        const y = Math.round(Y(v)) + 0.5;
        ctx.strokeStyle = col;
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(zx, y);
        ctx.lineTo(plotW, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = col;
        ctx.textAlign = "right";
        ctx.fillText(`${label}  ${fmt(v)}`, plotW - 8, y - 9);
      };
      level(POSITION.target, P.tp, "TP");
      level(POSITION.entry, P.entry, "ENTRY");
      level(POSITION.stop, P.sl, "SL");

      if (ei >= 0) {
        const ex = (ei + 0.5) * slot;
        const ey = Y(C[ei].l) + 10;
        ctx.fillStyle = P.up;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - 6, ey + 9);
        ctx.lineTo(ex + 6, ey + 9);
        ctx.closePath();
        ctx.fill();
        ctx.textAlign = "center";
        ctx.fillStyle = P.tp;
        ctx.fillText(`BUY ${POSITION.size}`, ex, ey + 22);
      }

      const py = Math.round(Y(sim.nq)) + 0.5;
      ctx.strokeStyle = P.up;
      ctx.globalAlpha = 0.45;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(plotW, py);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      ctx.fillStyle = P.up;
      ctx.fillRect(plotW + 2, py - 10, axisW - 4, 20);
      ctx.fillStyle = "#fff";
      ctx.textAlign = "left";
      ctx.fillText(fmt(sim.nq), plotW + 9, py);

      ctx.fillStyle = P.axis;
      ctx.textAlign = "center";
      for (let i = 0; i < N; i++) {
        const every = slot * 15 < 56 ? 30 : 15;
        if (C[i].t % every === 0) ctx.fillText(hhmm(SESSION_OPEN_MIN + C[i].t), Math.min(plotW - 20, Math.max(20, (i + 0.5) * slot)), h - 10);
      }

      const hv = hover.current;
      if (hv && hv.x < plotW && hv.y > padT && hv.y < h - padB) {
        const idx = Math.max(0, Math.min(N - 1, Math.floor(hv.x / slot)));
        const cx = (idx + 0.5) * slot;
        const cd = C[idx];
        ctx.strokeStyle = P.cross;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(cx, padT);
        ctx.lineTo(cx, h - padB);
        ctx.moveTo(0, hv.y);
        ctx.lineTo(plotW, hv.y);
        ctx.stroke();
        ctx.setLineDash([]);
        const hvp = hi - ((hv.y - padT) / plotH) * (hi - lo);
        ctx.fillStyle = P.crossTag;
        ctx.fillRect(plotW + 2, hv.y - 10, axisW - 4, 20);
        ctx.fillStyle = P.text;
        ctx.textAlign = "left";
        ctx.fillText(fmt(toTick(hvp)), plotW + 9, hv.y);
        const lines: [string, string][] = [
          ["Time", hhmm(SESSION_OPEN_MIN + cd.t)],
          ["Open", fmt(cd.o)],
          ["High", fmt(cd.h)],
          ["Low", fmt(cd.l)],
          ["Close", fmt(cd.c)],
        ];
        const bwid = 150;
        const bht = 18 + lines.length * 18;
        const bx = cx + 16 + bwid > plotW ? cx - 16 - bwid : cx + 16;
        const by = Math.max(padT, Math.min(hv.y - bht / 2, h - padB - bht));
        ctx.fillStyle = P.tipBg;
        ctx.strokeStyle = P.tipLine;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(bx, by, bwid, bht, 10);
        else ctx.rect(bx, by, bwid, bht);
        ctx.fill();
        ctx.stroke();
        lines.forEach(([k, v], li) => {
          const ly = by + 18 + li * 18;
          ctx.textAlign = "left";
          ctx.fillStyle = P.axis;
          ctx.fillText(k, bx + 12, ly);
          ctx.textAlign = "right";
          ctx.fillStyle = P.text;
          ctx.fillText(v, bx + bwid - 12, ly);
        });
      }
    };

    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || ts - last < 90) return;
      last = ts;
      draw();
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      offTheme();
    };
  }, [sim]);

  return (
    <canvas
      ref={ref}
      className={className}
      role="img"
      aria-label="NQ one-minute candlestick chart with the open long position, its stop and its target"
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        hover.current = { x: e.clientX - r.left, y: e.clientY - r.top };
      }}
      onMouseLeave={() => (hover.current = null)}
    />
  );
}
