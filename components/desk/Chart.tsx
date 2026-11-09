"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";
import { fmt, money } from "@/lib/format";
import { INSTRUMENTS, TIMEFRAMES, snap, type Sym } from "@/lib/desk/instruments";
import { nyClock, type Bar } from "@/lib/desk/market";
import {
  addBracket,
  cancelOrder,
  getMarket,
  moveOrder,
  setPick,
  setSettings,
  setTicket,
  showShortcuts,
  togglePanel,
  useDesk,
  type Order,
} from "@/lib/desk/store";
import { BAYER4 } from "@/lib/noise";
import { onThemeChange } from "@/lib/theme";
import s from "./desk.module.css";

const AXIS_W = 80;
const TIME_H = 26;
const RIGHT_PAD = 8; // bars of empty space ahead of the live candle
const VOL_FRAC = 0.16;
const STEPS = [0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];

type Line = {
  id: string;
  price: number;
  kind: "entry" | "stop" | "target" | "order" | "ghost";
  title: string;
  value?: string;
  tone?: "pos" | "neg";
  order?: Order;
  drag: boolean;
};

function hm(min: number): string {
  const h = Math.floor(min / 60);
  return `${h % 12 || 12}:${String(min % 60).padStart(2, "0")}`;
}

function timeLabel(t: number): string {
  const { min, wd } = nyClock(t);
  if (min === 0) return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][wd];
  return hm(min);
}

function fullTime(t: number): string {
  const { min } = nyClock(t);
  const h = Math.floor(min / 60);
  return `${h % 12 || 12}:${String(min % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export function Chart() {
  const sym = useDesk((st) => st.settings.sym);
  const tf = useDesk((st) => st.settings.tf);
  const panels = useDesk((st) => st.settings.panels);
  const tick = useDesk((st) => st.tick);
  const quote = useDesk((st) => st.quotes[sym]);
  const pos = useDesk((st) => st.positions[sym]);
  const orders = useDesk(useShallow((st) => st.orders.filter((o) => o.sym === sym)));
  const pick = useDesk((st) => st.pick);
  const ready = useDesk((st) => st.ready);
  const inst = INSTRUMENTS[sym];
  const tfMin = TIMEFRAMES.find((t) => t.id === tf)!.min;

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lineEls = useRef(new Map<string, HTMLDivElement>());
  const view = useRef({
    barW: 9,
    offset: 0,
    lo: 0,
    hi: 1,
    scaled: false,
    mx: -1,
    my: -1,
    pan: null as null | { x: number; offset: number },
    drag: null as null | { id: string; price: number },
    yToPrice: (y: number) => y,
    pTop: 0,
    pBot: 1,
    raf: 0,
    flash: 0,
    lastPx: 0,
    colors: null as null | Record<string, string>,
    entryIdx: -1,
  });
  const [hoverBar, setHoverBar] = useState<Bar | null>(null);
  const hoverIdx = useRef(-1);

  // lines on the chart, from the book
  const lines = useMemo<Line[]>(() => {
    const out: Line[] = [];
    if (pos) {
      const dir = Math.sign(pos.qty);
      out.push({ id: "entry", price: pos.avg, kind: "entry", title: `${dir > 0 ? "Long" : "Short"} ${Math.abs(pos.qty)}`, drag: false });
      for (const o of orders) {
        if (o.role !== "stop" && o.role !== "target") continue;
        const p = o.role === "stop" ? o.stop! : o.limit!;
        const pnl = (p - pos.avg) * pos.qty * inst.pv;
        out.push({ id: o.id, price: p, kind: o.role, title: o.role === "stop" ? (o.type === "TRAIL" ? "Trail" : "Stop") : "Target", value: money(pnl), tone: pnl >= 0 ? "pos" : "neg", order: o, drag: true });
      }
    }
    for (const o of orders) {
      if (o.role === "stop" || o.role === "target") continue;
      const p = o.type === "LMT" ? o.limit : o.stop;
      if (p === undefined) continue;
      out.push({ id: o.id, price: p, kind: "order", title: `${o.side > 0 ? "Buy" : "Sell"} ${o.type === "LMT" ? "lmt" : o.type === "STP" ? "stp" : o.type === "STPLMT" ? "stp lmt" : "trail"} ${o.qty}`, order: o, drag: o.type !== "TRAIL" });
    }
    return out;
  }, [pos, orders, inst.pv]);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  // the draw loop reads the newest render through these
  const latest = useRef({ quote, pos, pick, sym, inst, tfMin });
  latest.current = { quote, pos, pick, sym, inst, tfMin };
  const drawRef = useRef<() => void>(() => {});

  const schedule = () => {
    const v = view.current;
    if (!v.raf) v.raf = requestAnimationFrame(() => drawRef.current());
  };

  function readColors() {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const cs = getComputedStyle(wrap);
    const g = (n: string) => cs.getPropertyValue(n).trim();
    view.current.colors = {
      blue: g("--blue"),
      ember: g("--ember"),
      text: g("--text"),
      strong: g("--text-strong"),
      dim: g("--dim"),
      muted: g("--muted"),
      tl: g("--tl"),
      bg: g("--page") || g("--bg"),
      b1: g("--cv-dither-1"),
      b2: g("--cv-dither-2"),
      e1: g("--cv-ember-1"),
      e2: g("--cv-ember-2"),
      font: cs.fontFamily,
    };
  }

  function draw() {
    const v = view.current;
    v.raf = 0;
    const { quote, pos, pick, sym, inst, tfMin } = latest.current;
    const m = getMarket();
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!m || !wrap || !canvas) return;
    if (!v.colors) readColors();
    const C = v.colors!;
    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    if (!W || !H) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const plotW = W - AXIS_W;
    const plotH = H - TIME_H;
    const volTop = plotH - Math.round(plotH * VOL_FRAC);
    const pTop = 18;
    const pBot = volTop - 18;
    const bars = m.bars(inst.under, tfMin);
    const n = bars.length;
    const bw = v.barW;
    v.offset = Math.max(-RIGHT_PAD + 2, Math.min(n - 20, v.offset));
    const lastIdx = n - 1 - Math.round(v.offset);
    const xOf = (i: number) => plotW - (RIGHT_PAD + (lastIdx - i) + 0.5) * bw;
    const first = Math.max(0, Math.floor(lastIdx - plotW / bw + RIGHT_PAD) - 1);
    const last = Math.min(n - 1, lastIdx);

    let lo = Infinity;
    let hi = -Infinity;
    let vmax = 1;
    for (let i = first; i <= last; i++) {
      const b = bars[i];
      lo = Math.min(lo, b.l);
      hi = Math.max(hi, b.h);
      vmax = Math.max(vmax, b.v);
    }
    if (!Number.isFinite(lo)) {
      lo = quote.last - 10;
      hi = quote.last + 10;
    }
    const span0 = Math.max(hi - lo, inst.tick * 16);
    for (const l of linesRef.current) {
      const p = v.drag?.id === l.id ? v.drag.price : l.price;
      if (p > lo - span0 * 0.6 && p < hi + span0 * 0.6) {
        lo = Math.min(lo, p);
        hi = Math.max(hi, p);
      }
    }
    const pad = Math.max((hi - lo) * 0.08, inst.tick * 4);
    const tLo = lo - pad;
    const tHi = hi + pad;
    let settling = false;
    if (!v.scaled) {
      v.lo = tLo;
      v.hi = tHi;
      v.scaled = true;
    } else {
      v.lo += (tLo - v.lo) * 0.2;
      v.hi += (tHi - v.hi) * 0.2;
      settling = Math.abs(tLo - v.lo) > inst.tick * 0.05 || Math.abs(tHi - v.hi) > inst.tick * 0.05;
    }
    const yOf = (p: number) => pTop + ((v.hi - p) / (v.hi - v.lo)) * (pBot - pTop);
    v.yToPrice = (y: number) => v.hi - ((y - pTop) / (pBot - pTop)) * (v.hi - v.lo);
    v.pTop = pTop;
    v.pBot = pBot;

    ctx.font = `10.5px ${C.font}`;
    ctx.textBaseline = "middle";

    // price grid
    const raw = (v.hi - v.lo) / 7;
    const step = STEPS.find((x) => x >= raw) ?? 1000;
    ctx.fillStyle = C.tl;
    for (let p = Math.ceil(v.lo / step) * step; p <= v.hi; p += step) {
      const y = Math.round(yOf(p));
      if (y < 4 || y > pBot + 8) continue;
      ctx.fillRect(0, y, plotW, 1);
    }
    ctx.fillRect(plotW, 0, 1, plotH);
    ctx.fillRect(0, plotH, W, 1);
    ctx.fillRect(0, volTop - 1, plotW, 1);
    ctx.fillStyle = C.dim;
    ctx.textAlign = "left";
    for (let p = Math.ceil(v.lo / step) * step; p <= v.hi; p += step) {
      const y = Math.round(yOf(p));
      if (y < 8 || y > pBot + 8) continue;
      ctx.fillText(fmt(p), plotW + 12, y);
    }

    // time labels
    const cands = [5, 10, 15, 30, 60, 120, 240, 360, 720, 1440];
    const every = cands.find((c) => (c / tfMin) * bw >= 92) ?? 1440;
    ctx.textAlign = "center";
    for (let i = first; i <= last; i++) {
      const { min } = nyClock(bars[i].t);
      if (min % every !== 0) continue;
      const x = Math.round(xOf(i));
      if (x < 20 || x > plotW - 20) continue;
      ctx.fillStyle = C.tl;
      ctx.fillRect(x, plotH, 1, 5);
      ctx.fillStyle = C.dim;
      ctx.fillText(timeLabel(bars[i].t), x, plotH + 15);
    }

    // the open position, as a dithered zone between entry and the tape
    v.entryIdx = -1;
    if (pos) {
      let ei = last;
      while (ei > 0 && bars[ei].t > pos.openedAt) ei--;
      v.entryIdx = ei;
      const x0 = Math.max(0, Math.round(xOf(ei)));
      const x1 = Math.round(plotW - 2);
      const ya = yOf(pos.avg);
      const yb = yOf(quote.last);
      const top = Math.max(pTop - 6, Math.min(ya, yb));
      const bot = Math.min(pBot + 6, Math.max(ya, yb));
      const win = (quote.last - pos.avg) * Math.sign(pos.qty) >= 0;
      const pA = new Path2D();
      const pB = new Path2D();
      const cell = 3;
      for (let y = Math.floor(top / cell) * cell; y < bot; y += cell) {
        const near = 1 - Math.abs(y - yb) / Math.max(1, bot - top);
        for (let x = Math.floor(x0 / cell) * cell; x < x1; x += cell) {
          const fade = Math.min(1, (x - x0) / 90);
          const I = (0.12 + 0.3 * near) * (0.35 + 0.65 * fade);
          if (I > (BAYER4[((y / cell) & 3) * 4 + ((x / cell) & 3)] + 0.5) / 16) (I > 0.3 ? pB : pA).rect(x, y, 2, 2);
        }
      }
      ctx.fillStyle = win ? C.b1 : C.e1;
      ctx.fill(pA);
      ctx.fillStyle = win ? C.b2 : C.e2;
      ctx.fill(pB);
    }

    // volume, dithered
    const volPaths = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
    const bodyW = Math.max(1, Math.round(bw * 0.64));
    const cellsX = Math.max(1, Math.floor(bodyW / 3));
    for (let i = first; i <= last; i++) {
      const b = bars[i];
      const h = (b.v / vmax) * (plotH - volTop - 6);
      const rows = Math.floor(h / 3);
      const x0 = Math.round(xOf(i) - (cellsX * 3) / 2);
      const up = b.c >= b.o;
      for (let r = 0; r < rows; r++) {
        const I = 0.78 - 0.62 * (r / Math.max(1, rows));
        const y = plotH - 3 - r * 3;
        for (let c = 0; c < cellsX; c++) {
          const gx = (x0 / 3 + c) | 0;
          if (I > (BAYER4[((y / 3) & 3) * 4 + (gx & 3)] + 0.5) / 16) volPaths[(up ? 0 : 2) + (I > 0.6 ? 1 : 0)].rect(x0 + c * 3, y, 2, 2);
        }
      }
    }
    ctx.fillStyle = C.b1;
    ctx.fill(volPaths[0]);
    ctx.fillStyle = C.b2;
    ctx.fill(volPaths[1]);
    ctx.fillStyle = C.e1;
    ctx.fill(volPaths[2]);
    ctx.fillStyle = C.e2;
    ctx.fill(volPaths[3]);

    // candles
    const upP = new Path2D();
    const dnP = new Path2D();
    for (let i = first; i <= last; i++) {
      const b = bars[i];
      const x = Math.round(xOf(i));
      const up = b.c >= b.o;
      const path = up ? upP : dnP;
      const yh = Math.round(yOf(b.h));
      const yl = Math.round(yOf(b.l));
      path.rect(x, yh, 1, Math.max(1, yl - yh));
      const yo = yOf(b.o);
      const yc = yOf(b.c);
      const top = Math.round(Math.min(yo, yc));
      const hgt = Math.max(1, Math.round(Math.abs(yc - yo)));
      path.rect(x - Math.floor(bodyW / 2), top, bodyW, hgt);
    }
    ctx.fillStyle = C.blue;
    ctx.fill(upP);
    ctx.fillStyle = C.ember;
    ctx.fill(dnP);

    // the tape
    const lp = quote.last;
    if (lp !== v.lastPx) {
      v.flash = performance.now();
      v.lastPx = lp;
    }
    const yl = Math.round(yOf(lp));
    ctx.fillStyle = C.text;
    ctx.globalAlpha = 0.55;
    for (let x = 0; x < plotW; x += 5) ctx.fillRect(x, yl, 2, 1);
    ctx.globalAlpha = 1;
    const age = performance.now() - v.flash;
    const flashing = age < 420;
    ctx.fillStyle = flashing ? (quote.dir > 0 ? C.blue : C.ember) : C.strong;
    roundRect(ctx, plotW + 5, yl - 10, AXIS_W - 10, 20, 5);
    ctx.fill();
    ctx.fillStyle = C.bg;
    ctx.textAlign = "left";
    ctx.fillText(fmt(lp), plotW + 12, yl + 0.5);

    // crosshair
    if (v.mx >= 0 && v.mx < plotW && v.my >= 0 && v.my < plotH && !v.pan && !v.drag) {
      const i = Math.round(lastIdx - (plotW - v.mx) / bw + RIGHT_PAD + 0.5);
      const bi = Math.max(first, Math.min(last, i));
      const cx = Math.round(xOf(bi));
      ctx.fillStyle = C.text;
      ctx.globalAlpha = 0.35;
      for (let y = 0; y < plotH; y += 5) ctx.fillRect(cx, y, 1, 2);
      if (v.my < pBot + 10) for (let x = 0; x < plotW; x += 5) ctx.fillRect(x, Math.round(v.my), 2, 1);
      ctx.globalAlpha = 1;
      if (v.my < pBot + 10) {
        const p = snap(sym, v.yToPrice(v.my));
        ctx.fillStyle = C.muted;
        roundRect(ctx, plotW + 5, v.my - 10, AXIS_W - 10, 20, 5);
        ctx.fill();
        ctx.fillStyle = C.bg;
        ctx.fillText(fmt(p), plotW + 12, v.my + 0.5);
      }
      const label = fullTime(bars[bi].t);
      const tw = ctx.measureText(label).width + 16;
      ctx.fillStyle = C.muted;
      roundRect(ctx, cx - tw / 2, plotH + 4, tw, 18, 5);
      ctx.fill();
      ctx.fillStyle = C.bg;
      ctx.textAlign = "center";
      ctx.fillText(label, cx, plotH + 13.5);
      if (hoverIdx.current !== bi) {
        hoverIdx.current = bi;
        setHoverBar(bars[bi]);
      }
    } else if (hoverIdx.current !== -1) {
      hoverIdx.current = -1;
      setHoverBar(null);
    }

    // order and position lines (DOM, positioned here)
    for (const l of linesRef.current) {
      const el = lineEls.current.get(l.id);
      if (!el) continue;
      const p = v.drag?.id === l.id ? v.drag.price : l.price;
      const y = yOf(p);
      const cy = Math.max(pTop - 8, Math.min(pBot + 8, y));
      el.style.transform = `translateY(${cy.toFixed(1)}px)`;
      el.dataset.off = y < pTop - 8 ? "up" : y > pBot + 8 ? "down" : "";
      if (v.drag?.id === l.id) {
        const px = el.querySelector<HTMLElement>("[data-px]");
        if (px) px.textContent = fmt(p);
        const val = el.querySelector<HTMLElement>("[data-val]");
        if (val && pos) val.textContent = money((p - pos.avg) * pos.qty * inst.pv);
      }
    }
    const ghost = lineEls.current.get("ghost");
    if (ghost) {
      const show = pick && v.mx >= 0 && v.mx < plotW && v.my > 0 && v.my < pBot + 10;
      ghost.style.opacity = show ? "1" : "0";
      if (show) {
        const p = snap(sym, v.yToPrice(v.my));
        ghost.style.transform = `translateY(${yOf(p).toFixed(1)}px)`;
        const px = ghost.querySelector<HTMLElement>("[data-px]");
        if (px) px.textContent = fmt(p);
      }
    }

    if (settling || flashing) schedule();
  }
  drawRef.current = draw;

  // redraw on every tick and whenever the book changes
  useEffect(() => {
    schedule();
  });

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => schedule());
    ro.observe(wrap);
    const off = onThemeChange(() => {
      requestAnimationFrame(() => {
        readColors();
        schedule();
      });
    });
    return () => {
      ro.disconnect();
      off();
      cancelAnimationFrame(view.current.raf);
      view.current.raf = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // new market or timeframe: snap the scale instead of easing across
  useEffect(() => {
    view.current.scaled = false;
    view.current.offset = 0;
    schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym, tf]);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onDown = (e: React.PointerEvent) => {
    const v = view.current;
    const { x, y } = local(e);
    if (pick) {
      if (x < (wrapRef.current?.clientWidth ?? 0) - AXIS_W && y < v.pBot + 10) {
        setTicket({ [pick]: snap(sym, v.yToPrice(y)) });
        setPick(null);
      }
      return;
    }
    (e.target as Element).setPointerCapture?.(e.pointerId);
    v.pan = { x, offset: v.offset };
  };
  const onMove = (e: React.PointerEvent) => {
    const v = view.current;
    const { x, y } = local(e);
    v.mx = x;
    v.my = y;
    if (v.pan) v.offset = v.pan.offset + (x - v.pan.x) / v.barW;
    schedule();
  };
  const onUp = () => {
    view.current.pan = null;
    schedule();
  };
  const onLeave = () => {
    view.current.mx = -1;
    view.current.my = -1;
    schedule();
  };

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = view.current;
      const k = Math.exp(-e.deltaY * 0.0015);
      v.barW = Math.max(3, Math.min(28, v.barW * k));
      schedule();
    };
    wrap.addEventListener("wheel", wheel, { passive: false });
    return () => wrap.removeEventListener("wheel", wheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // dragging a line
  const startDrag = (e: React.PointerEvent, l: Line) => {
    if (!l.drag) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    view.current.drag = { id: l.id, price: l.price };
  };
  const moveDrag = (e: React.PointerEvent, l: Line) => {
    const v = view.current;
    if (v.drag?.id !== l.id) return;
    e.stopPropagation();
    const { y } = local(e);
    v.drag.price = snap(sym, v.yToPrice(y));
    v.mx = -1;
    schedule();
  };
  const endDrag = (e: React.PointerEvent, l: Line) => {
    const v = view.current;
    if (v.drag?.id !== l.id) return;
    e.stopPropagation();
    const p = v.drag.price;
    v.drag = null;
    if (l.order && p !== l.price) moveOrder(l.order.id, p);
    schedule();
  };

  const bar = hoverBar ?? (() => {
    const m = getMarket();
    if (!m || !ready) return null;
    const bs = m.bars(inst.under, tfMin);
    return bs[bs.length - 1];
  })();
  void tick;

  const hasStop = orders.some((o) => o.role === "stop");
  const hasTarget = orders.some((o) => o.role === "target");
  const chg = quote.last - quote.prev;

  return (
    <div className={s.chart}>
      <header className={s.chartHead}>
        <div className={s.chartId}>
          <span className={s.chartSym}>{inst.code}</span>
          <span className={s.chartName}>{inst.name}</span>
          <span className={`${s.chartChg} ${chg >= 0 ? s.pos : s.neg}`}>
            {chg >= 0 ? "+" : "−"}
            {fmt(Math.abs(chg))} · {quote.prev ? `${((chg / quote.prev) * 100).toFixed(2)}%` : "–"}
          </span>
        </div>
        <div className={s.ohlc} aria-live="off">
          {bar && (
            <>
              <span>
                {hoverBar ? fullTime(bar.t) : "Now"}
              </span>
              <span>
                <i>O</i>
                {fmt(bar.o)}
              </span>
              <span>
                <i>H</i>
                {fmt(bar.h)}
              </span>
              <span>
                <i>L</i>
                {fmt(bar.l)}
              </span>
              <span>
                <i>C</i>
                <b className={bar.c >= bar.o ? s.pos : s.neg}>{fmt(bar.c)}</b>
              </span>
              <span>
                <i>V</i>
                {bar.v >= 1000 ? `${(bar.v / 1000).toFixed(1)}k` : bar.v}
              </span>
            </>
          )}
        </div>
        <div className={s.chartTools}>
          <div className={s.seg} role="tablist" aria-label="Timeframe" style={{ "--i": TIMEFRAMES.findIndex((t) => t.id === tf), "--n": TIMEFRAMES.length } as CSSProperties}>
            <span className={s.segPill} aria-hidden="true" />
            {TIMEFRAMES.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={t.id === tf} onClick={() => setSettings({ tf: t.id })}>
                {t.label}
              </button>
            ))}
          </div>
          <button type="button" className={s.tool} aria-pressed={panels.instant} onClick={() => togglePanel("instant")} title="Instant trade panel (I)">
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M9.2 1.5 3.5 9h4.1l-1 5.5L12.5 7H8.4z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
            Instant
          </button>
          <button type="button" className={s.tool} aria-pressed={panels.pnl} onClick={() => togglePanel("pnl")} title="Live P&L panel (L)">
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M1.5 9h3l1.6-4 2.6 8 1.8-5H14.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
            Live P&amp;L
          </button>
          <button type="button" className={s.toolIcon} onClick={() => showShortcuts(true)} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">
            <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="1.5" y="4" width="13" height="8.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <path d="M4 7h.01M6.5 7h.01M9 7h.01M11.5 7h.01M5 9.8h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </header>

      <div
        ref={wrapRef}
        className={`${s.plot} ${pick ? s.picking : ""}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onLeave}
        onDoubleClick={() => {
          view.current.offset = 0;
          view.current.barW = 9;
          schedule();
        }}
      >
        <canvas ref={canvasRef} className={s.canvas} aria-label={`${inst.code} chart`} role="img" />

        {lines.map((l) => (
          <div
            key={l.id}
            ref={(el) => {
              if (el) lineEls.current.set(l.id, el);
              else lineEls.current.delete(l.id);
            }}
            className={`${s.line} ${s[`line_${l.kind}`]} ${l.drag ? s.lineDrag : ""}`}
            onPointerDown={(e) => startDrag(e, l)}
            onPointerMove={(e) => moveDrag(e, l)}
            onPointerUp={(e) => endDrag(e, l)}
            style={{ right: AXIS_W } as CSSProperties}
          >
            <span className={s.lineRule} />
            <span className={s.lineTag}>
              <b>{l.title}</b>
              <span data-px>{fmt(l.price)}</span>
              {l.value && (
                <em data-val className={l.tone === "pos" ? s.pos : s.neg}>
                  {l.value}
                </em>
              )}
              {l.kind === "entry" && pos && (
                <em className={(quote.last - pos.avg) * pos.qty >= 0 ? s.pos : s.neg}>{money((quote.last - pos.avg) * pos.qty * inst.pv)}</em>
              )}
              {l.kind === "entry" && !hasStop && (
                <button type="button" className={s.lineAdd} onPointerDown={(e) => e.stopPropagation()} onClick={() => addBracket(sym, "stop")}>
                  + Stop
                </button>
              )}
              {l.kind === "entry" && !hasTarget && (
                <button type="button" className={s.lineAdd} onPointerDown={(e) => e.stopPropagation()} onClick={() => addBracket(sym, "target")}>
                  + Target
                </button>
              )}
              {l.order && (
                <button
                  type="button"
                  className={s.lineX}
                  aria-label={`Cancel ${l.title}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => cancelOrder(l.order!.id)}
                >
                  ×
                </button>
              )}
            </span>
          </div>
        ))}
        <div
          ref={(el) => {
            if (el) lineEls.current.set("ghost", el);
            else lineEls.current.delete("ghost");
          }}
          className={`${s.line} ${s.line_ghost}`}
          style={{ right: AXIS_W, opacity: 0 }}
          aria-hidden="true"
        >
          <span className={s.lineRule} />
          <span className={s.lineTag}>
            <b>Set {pick === "stop" ? "stop" : "limit"}</b>
            <span data-px />
          </span>
        </div>
        {pick && (
          <div className={s.pickHint}>
            Click the chart to set the {pick} price <button type="button" onClick={() => setPick(null)}>Esc</button>
          </div>
        )}
      </div>
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
