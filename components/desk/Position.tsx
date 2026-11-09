"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fmt, money } from "@/lib/format";
import { INSTRUMENTS } from "@/lib/desk/instruments";
import { closePercent, dayStart, flatten, getMarket, openPnl, realizedSince, useDesk } from "@/lib/desk/store";
import { BAYER4 } from "@/lib/noise";
import { onThemeChange } from "@/lib/theme";
import { Odometer } from "@/components/trader/parts";
import s from "./desk.module.css";

/**
 * The trade's P&L since the fill (or the day's, when flat), drawn like the
 * dashboard's equity band: a hairline with dither falling back to zero.
 */
function PathChart({ values }: { values: number[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [theme, setTheme] = useState(0);
  useEffect(() => onThemeChange(() => requestAnimationFrame(() => setTheme((n) => n + 1))), []);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const W = c.clientWidth;
    const H = c.clientHeight;
    if (!W || !H) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(W * dpr)) c.width = Math.round(W * dpr);
    if (c.height !== Math.round(H * dpr)) c.height = Math.round(H * dpr);
    const g = c.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const cs = getComputedStyle(c);
    const v = (n: string) => cs.getPropertyValue(n).trim();
    const C = { tl: v("--tl"), strong: v("--text-strong"), b1: v("--cv-dither-1"), b2: v("--cv-dither-2"), e1: v("--cv-ember-1"), e2: v("--cv-ember-2") };

    const pts = values.length > 1 ? values : [0, 0];
    const lo = Math.min(0, ...pts);
    const hi = Math.max(0, ...pts);
    const span = hi - lo || 1;
    const padY = 5;
    const plotW = W - 12;
    const x = (i: number) => (i / (pts.length - 1)) * plotW;
    const y = (val: number) => padY + ((hi - val) / span) * (H - padY * 2);
    const y0 = Math.round(y(0));
    const at = (px: number) => {
      const f = (px / plotW) * (pts.length - 1);
      const i = Math.min(pts.length - 2, Math.floor(f));
      return pts[i] + (pts[i + 1] - pts[i]) * (f - i);
    };

    // dither between the line and zero, brightest at the line
    const cell = 3;
    const up = [new Path2D(), new Path2D()];
    const dn = [new Path2D(), new Path2D()];
    for (let px = 0; px <= plotW; px += cell) {
      const val = at(px);
      const yl = y(val);
      const a = Math.min(yl, y0);
      const b = Math.max(yl, y0);
      const reach = Math.max(1, b - a);
      for (let py = Math.floor(a / cell) * cell; py < b; py += cell) {
        const near = 1 - Math.abs(py - yl) / reach;
        const I = 0.08 + 0.62 * near * near;
        if (I > (BAYER4[((py / cell) & 3) * 4 + ((px / cell) & 3)] + 0.5) / 16) (val >= 0 ? up : dn)[I > 0.45 ? 1 : 0].rect(px, py, 2, 2);
      }
    }
    g.fillStyle = C.b1;
    g.fill(up[0]);
    g.fillStyle = C.b2;
    g.fill(up[1]);
    g.fillStyle = C.e1;
    g.fill(dn[0]);
    g.fillStyle = C.e2;
    g.fill(dn[1]);

    // zero, dashed
    g.fillStyle = C.tl;
    for (let px = 0; px < W; px += 4) g.fillRect(px, y0, 2, 1);

    // the line
    g.beginPath();
    pts.forEach((val, i) => (i ? g.lineTo(x(i), y(val)) : g.moveTo(x(i), y(val))));
    g.strokeStyle = C.strong;
    g.lineWidth = 1.25;
    g.lineJoin = "round";
    g.stroke();

    // end mark: a square, as on the dashboard's sparks
    const ex = x(pts.length - 1);
    const ey = y(pts[pts.length - 1]);
    g.fillStyle = C.strong;
    g.fillRect(Math.round(ex) - 2, Math.round(ey) - 2, 5, 5);
  }, [values, theme]);

  return <canvas ref={ref} className={s.posPath} aria-hidden="true" />;
}

/** The open position in the selected market, pinned above the blotter so Flatten never moves. */
export function Position() {
  const sym = useDesk((st) => st.settings.sym);
  const pos = useDesk((st) => st.positions[sym]);
  const positions = useDesk((st) => st.positions);
  const quotes = useDesk((st) => st.quotes);
  const trades = useDesk((st) => st.trades);
  const inst = INSTRUMENTS[sym];
  const q = quotes[sym];
  const open = openPnl({ positions, quotes }, sym);
  const trade = pos ? trades.find((x) => x.id === pos.tradeId) : undefined;
  const r = trade?.risk ? open / trade.risk : null;
  const pts = pos ? ((pos.qty > 0 ? q.bid : q.ask) - pos.avg) * Math.sign(pos.qty) : 0;
  const since = dayStart();
  const unreal = openPnl({ positions, quotes });
  const day = realizedSince(trades, since) + unreal;
  const today = trades.filter((x) => x.closedAt && x.closedAt >= since);

  // the path: P&L at each minute's close since the fill, or the day's closes when flat,
  // plus the trade's best and worst open P&L from the bars' highs and lows
  const { path, mfe, mae } = useMemo(() => {
    if (pos) {
      const m = getMarket();
      if (!m) return { path: [] as number[], mfe: 0, mae: 0 };
      const bars = m.bars(inst.under, 60);
      const out = [0];
      let best = Math.max(0, open);
      let worst = Math.min(0, open);
      const k = inst.pv * Math.abs(pos.qty);
      const dir = Math.sign(pos.qty);
      for (const b of bars) {
        if (b.t + 60_000 <= pos.openedAt) continue;
        out.push((b.c - pos.avg) * pos.qty * inst.pv);
        best = Math.max(best, ((dir > 0 ? b.h : b.l) - pos.avg) * dir * k);
        worst = Math.min(worst, ((dir > 0 ? b.l : b.h) - pos.avg) * dir * k);
      }
      out.push(open);
      return { path: out.slice(-240), mfe: best, mae: worst };
    }
    const out = [0];
    let run = 0;
    for (const t of [...today].sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0))) {
      run += t.pnl;
      out.push(run);
    }
    if (out.length === 1) out.push(0);
    return { path: out, mfe: 0, mae: 0 };
  }, [pos, open, today, inst]);
  const held = pos ? Math.max(0, Math.round((Date.now() - pos.openedAt) / 60_000)) : 0;
  const best = today.reduce((a, t) => Math.max(a, t.pnl), -Infinity);
  const worst = today.reduce((a, t) => Math.min(a, t.pnl), Infinity);

  return (
    <div className={s.position}>
      <div className={s.posLine}>
        {pos ? (
          <>
            <span className={`${s.side} ${pos.qty > 0 ? s.sideL : s.sideS}`}>{pos.qty > 0 ? "Long" : "Short"}</span>
            <span>
              {Math.abs(pos.qty)} @ {fmt(pos.avg)}
            </span>
          </>
        ) : (
          <>
            <span className={s.flatTag}>Flat</span>
            <span className={s.dim}>Day so far</span>
          </>
        )}
        <span className={s.posMeta}>
          {pos ? `${pts >= 0 ? "+" : "−"}${fmt(Math.abs(pts))} pts` : `${today.length} closed`}
        </span>
      </div>
      <div className={s.posNum}>
        {pos ? (
          <Odometer value={money(open)} className={`${s.posBig} ${open >= 0 ? s.pos : s.neg}`} delay={0} />
        ) : (
          <Odometer value={money(day)} className={`${s.posBig} ${s.posQuiet}`} delay={0} />
        )}
        {pos && r !== null && <span className={`${s.posR} ${r >= 0 ? s.pos : s.neg}`}>{`${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(2)}R`}</span>}
      </div>
      <PathChart values={path} />
      <div className={s.posStats}>
        {pos ? (
          <>
            <span>
              <i>Held</i>
              {held >= 60 ? `${Math.floor(held / 60)}h ${String(held % 60).padStart(2, "0")}m` : `${held}m`}
            </span>
            <span>
              <i>MFE</i>
              <b className={s.pos}>{money(mfe)}</b>
            </span>
            <span>
              <i>MAE</i>
              <b className={mae < 0 ? s.neg : undefined}>{money(mae)}</b>
            </span>
          </>
        ) : today.length ? (
          <>
            <span>
              <i>Best</i>
              <b className={best >= 0 ? s.pos : s.neg}>{money(best)}</b>
            </span>
            <span>
              <i>Worst</i>
              <b className={worst >= 0 ? s.pos : s.neg}>{money(worst)}</b>
            </span>
          </>
        ) : (
          <span>
            <i>No trades closed since 6:00 PM</i>
          </span>
        )}
      </div>
      <div className={s.posBtns}>
        <button type="button" disabled={!pos} onClick={() => closePercent(sym, 0.5)}>
          Close half
        </button>
        <button type="button" disabled={!pos} className={s.flat} onClick={() => flatten(sym)}>
          Flatten {inst.code.replace(/Z\d$/, "")}
        </button>
      </div>
    </div>
  );
}
