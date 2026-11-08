"use client";

import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "@/lib/canvas";
import { money, signed, hhmm } from "@/lib/format";
import { dayLabel, type Trade } from "@/lib/journal";
import { BAYER4 } from "@/lib/noise";
import { cssVar, onThemeChange } from "@/lib/theme";
import s from "./trader.module.css";

type Point = { eq: number; dd: number };

const EQ_TOP = 22;
const EQ_BASE = 262;
const UW_TOP = 286;
const UW_DEPTH = 58;
const HEIGHT = 352;

function hex(c: string): string {
  return c || "#4da3ff";
}

/**
 * Equity by trade, drawn in the band's dither texture: profit as a bright edge
 * with a glow falling beneath it, drawdown hanging below the baseline in ember.
 */
export function EquityChart({ curve, trades }: { curve: Point[]; trades: Trade[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<{ i: number; x: number; y: number; dy: number } | null>(null);
  const state = useRef({
    W: 0,
    cols: 0,
    cell: 4,
    from: null as null | { eq: Float32Array; dd: Float32Array },
    to: null as null | { eq: Float32Array; dd: Float32Array },
    now: null as null | { eq: Float32Array; dd: Float32Array },
    morph: 1,
    reveal: 0,
    zeroY: 0,
    raf: 0,
    started: 0,
    pal: { b: ["", "", "", ""], e: ["", "", "", ""], dot: "" },
  });
  const curveRef = useRef(curve);
  curveRef.current = curve;

  useEffect(() => {
    const st = state.current;
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const reduce = prefersReducedMotion();
    if (reduce) st.reveal = 1;

    const readPal = () => {
      st.pal = {
        b: [0, 1, 2, 3].map((k) => hex(cssVar(`--cv-dither-${k}`))),
        e: [0, 1, 2, 3].map((k) => hex(cssVar(`--cv-ember-${k}`))),
        dot: cssVar("--dim"),
      };
    };

    const columns = (pts: Point[]) => {
      const { W, cell } = st;
      const cols = Math.ceil(W / cell);
      const eq = new Float32Array(cols);
      const dd = new Float32Array(cols);
      const n = pts.length;
      let lo = 0;
      let hi = 1;
      let ddMin = -1;
      for (const p of pts) {
        lo = Math.min(lo, p.eq);
        hi = Math.max(hi, p.eq);
        ddMin = Math.min(ddMin, p.dd);
      }
      const span = (hi - lo) * 1.08 || 1;
      const yOf = (v: number) => EQ_BASE - ((v - lo) / span) * (EQ_BASE - EQ_TOP);
      st.zeroY = yOf(0);
      for (let i = 0; i < cols; i++) {
        const u = ((i + 0.5) * cell) / W * (n - 1);
        const a = Math.max(0, Math.min(n - 1, Math.floor(u)));
        const b = Math.min(n - 1, a + 1);
        const f = Math.min(1, Math.max(0, u - a));
        const v = pts[a].eq + (pts[b].eq - pts[a].eq) * f;
        const d = pts[a].dd + (pts[b].dd - pts[a].dd) * f;
        eq[i] = yOf(v);
        dd[i] = (d / ddMin) * UW_DEPTH;
      }
      return { eq, dd };
    };

    const paint = () => {
      const ctx = canvas.getContext("2d");
      const now = st.now;
      if (!ctx || !now) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const { W, cell } = st;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(HEIGHT * dpr)) {
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(HEIGHT * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, HEIGHT);
      const sq = cell - (cell > 3 ? 1.4 : 1.1);
      const blue = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
      const ember = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
      const tone = (I: number) => (I > 0.92 ? 3 : I > 0.6 ? 2 : I > 0.35 ? 1 : 0);
      const revealX = st.reveal * (W + 80);
      const cols = now.eq.length;

      for (let i = 0; i < cols; i++) {
        const cx = (i + 0.5) * cell;
        if (cx > revealX) break;
        const front = Math.min(1, (revealX - cx) / 60);
        const yl = now.eq[i];
        const yp = now.eq[Math.max(0, i - 1)];
        const yn = now.eq[Math.min(cols - 1, i + 1)];
        const slope = (yn - yp) / (2 * cell);
        const norm = Math.sqrt(1 + slope * slope);
        const top = Math.min(yl, yp, yn) - 14;
        const r0 = Math.max(0, Math.floor(top / cell));
        const rBase = Math.floor(EQ_BASE / cell);
        for (let r = r0; r <= rBase; r++) {
          const cy = (r + 0.5) * cell;
          const dy = cy - yl;
          const dp = dy / norm;
          let I = 1.15 * Math.exp(-(dp * dp) / 18);
          if (dy > 0) I = Math.max(I, 0.64 * Math.exp(-dy / 74));
          I *= front * Math.min(1, (EQ_BASE + 6 - cy) / 34);
          if (I > (BAYER4[(r & 3) * 4 + (i & 3)] + 0.5) / 16) blue[tone(I)].rect(i * cell, r * cell, sq, sq);
        }

        // underwater, hanging from the baseline
        const depth = now.dd[i];
        if (depth > 0.5) {
          const edge = UW_TOP + depth;
          const r1 = Math.floor(UW_TOP / cell);
          const r2 = Math.min(Math.floor((edge + 10) / cell), Math.floor((HEIGHT - 2) / cell));
          for (let r = r1; r <= r2; r++) {
            const cy = (r + 0.5) * cell;
            const up = edge - cy; // >0 inside the drawdown
            let I = 1.1 * Math.exp(-(up * up) / 16);
            if (up > 0) I = Math.max(I, 0.58 * Math.exp(-up / 30));
            I *= front;
            if (I > (BAYER4[(r & 3) * 4 + (i & 3)] + 0.5) / 16) ember[tone(I)].rect(i * cell, r * cell, sq, sq);
          }
        }
      }
      for (let k = 0; k < 4; k++) {
        ctx.fillStyle = st.pal.b[k];
        ctx.fill(blue[k]);
        ctx.fillStyle = st.pal.e[k];
        ctx.fill(ember[k]);
      }
      // the period's starting balance, as a dotted rule
      ctx.fillStyle = st.pal.dot;
      ctx.globalAlpha = 0.5;
      for (let x = 0; x < Math.min(W, revealX); x += 6) ctx.fillRect(x, Math.round(st.zeroY), 1.5, 1);
      for (let x = 0; x < Math.min(W, revealX); x += 6) ctx.fillRect(x, UW_TOP - 6, 1.5, 1);
      ctx.globalAlpha = 1;
    };

    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

    const frame = (time: number) => {
      st.raf = 0;
      if (!st.started) st.started = time;
      let busy = false;
      if (st.reveal < 1) {
        const k = Math.min(1, Math.max(0, (time - st.started - 420) / 1700));
        st.reveal = ease(k);
        busy = k < 1;
      }
      if (st.morph < 1 && st.from && st.to) {
        st.morph = Math.min(1, st.morph + 1 / 48);
        const t = ease(st.morph);
        const n = st.to.eq.length;
        const eq = new Float32Array(n);
        const dd = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          eq[i] = st.from.eq[i] + (st.to.eq[i] - st.from.eq[i]) * t;
          dd[i] = st.from.dd[i] + (st.to.dd[i] - st.from.dd[i]) * t;
        }
        st.now = { eq, dd };
        busy = busy || st.morph < 1;
      } else if (st.to) st.now = st.to;
      paint();
      if (busy) st.raf = requestAnimationFrame(frame);
    };
    const kick = () => {
      if (!st.raf) st.raf = requestAnimationFrame(frame);
    };

    const layout = () => {
      const W = Math.round(wrap.clientWidth);
      if (!W) return;
      st.W = W;
      st.cell = W < 700 ? 3 : 4;
      st.to = columns(curveRef.current);
      st.from = st.to;
      st.now = st.to;
      st.morph = 1;
      kick();
    };
    (wrap as HTMLDivElement & { __retarget?: () => void }).__retarget = () => {
      if (!st.W) return;
      st.from = st.now ?? st.to;
      st.to = columns(curveRef.current);
      st.morph = reduce || !st.from || st.from.eq.length !== st.to.eq.length ? 1 : 0;
      kick();
    };

    readPal();
    layout();
    const ro = new ResizeObserver(layout);
    ro.observe(wrap);
    const off = onThemeChange(() => {
      readPal();
      kick();
    });
    return () => {
      ro.disconnect();
      off();
      cancelAnimationFrame(st.raf);
    };
  }, []);

  // new period: morph from what's on screen
  useEffect(() => {
    const w = wrapRef.current as (HTMLDivElement & { __retarget?: () => void }) | null;
    w?.__retarget?.();
  }, [curve]);

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = state.current;
    if (!st.now || st.reveal < 0.98) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width, e.clientX - r.left));
    const n = curve.length;
    const i = Math.round((x / r.width) * (n - 1));
    const px = (i / (n - 1)) * r.width;
    const col = Math.min(st.now.eq.length - 1, Math.max(0, Math.floor(px / st.cell)));
    setHover({ i, x: px, y: st.now.eq[col], dy: UW_TOP + st.now.dd[col] });
  };

  let lo = 0;
  let hi = 1;
  for (const c of curve) {
    lo = Math.min(lo, c.eq);
    hi = Math.max(hi, c.eq);
  }
  const endY = EQ_BASE - ((curve[curve.length - 1].eq - lo) / ((hi - lo) * 1.08 || 1)) * (EQ_BASE - EQ_TOP);
  const t = hover && hover.i > 0 ? trades[hover.i - 1] : null;
  const p = hover ? curve[hover.i] : null;
  const months: { label: string; at: number }[] = [];
  let lastKey = "";
  const short = trades.length <= 60;
  trades.forEach((tr, k) => {
    const key = short ? tr.day : tr.day.slice(0, 7);
    if (key !== lastKey) {
      lastKey = key;
      months.push({ label: dayLabel(tr.day, short ? { month: "short", day: "numeric" } : { month: "short" }), at: (k + 1) / Math.max(1, curve.length - 1) });
    }
  });
  const thin = Math.max(1, Math.ceil(months.length / 8));

  return (
    <div className={s.equity}>
      <div ref={wrapRef} className={s.equityPlot} style={{ height: HEIGHT }} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <canvas ref={canvasRef} className={s.equityCanvas} aria-hidden="true" />
        <span className={s.endMark} style={{ top: endY }}>
          <i />
          <b />
          <span>{money(curve[curve.length - 1].eq)}</span>
        </span>
        <span className={s.uwLabel} style={{ top: UW_TOP - 24 }}>
          DRAWDOWN
        </span>
        {hover && p && (
          <>
            <span className={s.scrub} style={{ transform: `translateX(${hover.x}px)` }} />
            <span className={s.ring} style={{ transform: `translate(${hover.x}px, ${hover.y}px)` }} />
            {p.dd < 0 && <span className={`${s.ring} ${s.ringEmber}`} style={{ transform: `translate(${hover.x}px, ${hover.dy}px)` }} />}
            <div className={s.tip} style={{ transform: `translateX(${Math.min(Math.max(hover.x + 14, 0), (wrapRef.current?.clientWidth ?? 0) - 214)}px)` }}>
              {t ? (
                <>
                  <span className={s.tipHead}>
                    {dayLabel(t.day, { weekday: "short", month: "short", day: "numeric" })} · {hhmm(t.minute)}
                  </span>
                  <span className={s.tipRow}>
                    <span>
                      {t.mkt} {t.side} {t.size}
                    </span>
                    <b className={t.pnl >= 0 ? s.pos : s.neg}>{money(t.pnl)}</b>
                  </span>
                  <span className={s.tipRow}>
                    <span>R</span>
                    <b className={t.r >= 0 ? s.pos : s.neg}>{signed(t.r, 2, "R")}</b>
                  </span>
                </>
              ) : (
                <span className={s.tipHead}>Start of period</span>
              )}
              <span className={`${s.tipRow} ${s.tipTotal}`}>
                <span>Equity</span>
                <b>{money(p.eq)}</b>
              </span>
              {p.dd < 0 && (
                <span className={s.tipRow}>
                  <span>From peak</span>
                  <b className={s.neg}>{money(p.dd)}</b>
                </span>
              )}
            </div>
          </>
        )}
      </div>
      <div className={s.axis} aria-hidden="true">
        {months
          .filter((_, k) => k % thin === 0)
          .map((m) => (
            <span key={`${m.label}${m.at}`} style={{ left: `${m.at * 100}%` }}>
              {m.label}
            </span>
          ))}
      </div>
    </div>
  );
}
