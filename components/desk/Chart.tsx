"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";
import { fmt, money } from "@/lib/format";
import { INSTRUMENTS, RANGES, SYMS, TIMEFRAMES, snap, tfSec, type Range, type Timeframe } from "@/lib/desk/instruments";
import {
  addAlert,
  addBracket,
  cancelOrder,
  getMarket,
  moveAlert,
  moveOrder,
  placeOrder,
  removeAlert,
  selectSym,
  setPick,
  setSettings,
  setTicket,
  showShortcuts,
  toggleFull,
  dismissMove,
  notifyMove,
  setExitPrice,
  ticketEntry,
  ticketExits,
  ticketFromPosition,
  togglePanel,
  bookOf,
  hisBook,
  useDesk,
  type Order,
} from "@/lib/desk/store";
import { addDrawing, clearDrawings, drawId, removeDrawing, replaceDrawing, restyle, selectDrawing, setTool, startDrawings, toggleDraw, toggleHidden, useDraw, type Drawing, type Pt } from "@/lib/desk/drawings";
import { BAYER4 } from "@/lib/noise";
import { onThemeChange } from "@/lib/theme";
import { Odometer } from "@/components/trader/parts";
import { ChartMenu, ChartSettings, DrawPop, ToolRail, ToolsIcon, type MenuAt } from "./ChartParts";
import { Toaster } from "./Toaster";
import * as K from "./chartKit";
import s from "./desk.module.css";

/* ------------------------------------------------------------------ */
/* the toolbar over the chart                                          */
/* ------------------------------------------------------------------ */

function ChartBar({ viewer = false, frozen = false }: { viewer?: boolean; frozen?: boolean }) {
  const sym = useDesk((st) => st.settings.sym);
  const tf = useDesk((st) => st.settings.tf);
  const pnl = useDesk((st) => st.settings.panels.pnl);
  const markets = useDesk((st) => st.settings.panels.markets);
  const full = useDesk((st) => st.full);
  const quote = useDesk((st) => st.quotes[sym]);
  const held = useDesk(useShallow((st) => SYMS.map((x) => Math.sign(st.positions[x]?.qty ?? 0))));
  const chg = quote.last - quote.prev;
  const ti = TIMEFRAMES.findIndex((t) => t.id === tf);

  return (
    <header className={s.bar} data-viewer={viewer ? "" : undefined}>
      <button type="button" className={`${s.barIcon} ${s.barMk}`} aria-pressed={markets} onClick={() => togglePanel("markets")} title={markets ? "Hide markets (M)" : "Show markets (M)"} aria-label="Markets panel">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="1.5" y="2.5" width="13" height="11" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M6 2.5v11" stroke="currentColor" strokeWidth="1.2" />
          <rect className={s.barIconFill} x="2.6" y="3.6" width="2.4" height="8.8" rx="0.8" />
        </svg>
      </button>
      <div className={s.syms} role="tablist" aria-label="Market" style={{ "--i": SYMS.indexOf(sym) } as CSSProperties}>
        <span className={s.symBar} aria-hidden="true" />
        {SYMS.map((x, k) => (
          <button key={x} type="button" role="tab" aria-selected={x === sym} onClick={() => selectSym(x)} title={`${INSTRUMENTS[x].name} (${k + 1})`}>
            {x}
            {held[k] !== 0 && <i className={held[k] > 0 ? s.symL : s.symS} />}
          </button>
        ))}
      </div>
      <span className={s.barSep} aria-hidden="true" />
      <div className={s.quote} hidden={frozen}>
        <Odometer value={quote.last ? fmt(quote.last) : "0.00"} className={s.quotePx} delay={0} />
        <span className={`${s.quoteChg} ${chg >= 0 ? s.pos : s.neg}`}>
          {chg >= 0 ? "+" : "−"}
          {fmt(Math.abs(chg))}
          <span>{quote.prev ? `${chg >= 0 ? "+" : "−"}${Math.abs((chg / quote.prev) * 100).toFixed(2)}%` : ""}</span>
        </span>
      </div>
      <div className={s.barRight}>
        <div className={s.seg} role="tablist" aria-label="Timeframe" style={{ "--i": ti, "--n": TIMEFRAMES.length } as CSSProperties}>
          <span className={s.segPill} aria-hidden="true" />
          {TIMEFRAMES.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={t.id === tf} onClick={() => setSettings({ tf: t.id })}>
              {t.label}
            </button>
          ))}
        </div>
        <label className={s.tfPick}>
          <select aria-label="Timeframe" value={tf} onChange={(e) => setSettings({ tf: e.target.value as Timeframe })}>
            {TIMEFRAMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 3.8l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </label>
        <span className={s.barSep} aria-hidden="true" />
        <button type="button" className={`${s.barBtn} ${s.barPnl}`} aria-pressed={pnl} onClick={() => togglePanel("pnl")} title="Live P&L panel (L)">
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M1.5 9h3l1.6-4 2.6 8 1.8-5H14.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
          Live P&amp;L
        </button>
        <button type="button" className={`${s.barIcon} ${s.barKeys}`} onClick={() => showShortcuts(true)} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="1.5" y="4" width="13" height="8.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <path d="M4 7h.01M6.5 7h.01M9 7h.01M11.5 7h.01M5 9.8h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          className={`${s.barIcon} ${s.barFull}`}
          aria-pressed={full}
          onClick={() => toggleFull()}
          title={full ? "Exit full screen (Esc)" : "Full screen (Shift F)"}
          aria-label={full ? "Exit full screen" : "Full screen chart"}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <g className={s.fullOut}>
              <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
            </g>
            <g className={s.fullIn}>
              <path d="M6 2.5V6H2.5M13.5 6H10V2.5M10 13.5V10h3.5M2.5 10H6v3.5" />
            </g>
          </svg>
        </button>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* the plot                                                            */
/* ------------------------------------------------------------------ */

type Line = {
  id: string;
  price: number;
  kind: "entry" | "stop" | "target" | "order" | "alert" | "exit" | "dbuy" | "dsell" | "dstop" | "dtarget" | "his";
  title: string;
  value?: string;
  tone?: "pos" | "neg";
  order?: Order;
  alertId?: string;
  /** the ticket's order, drawn before it's sent */
  draft?: "entry" | "stop" | "target" | "target2";
  /** a draft exit that keeps its distance when the draft entry is dragged */
  follows?: boolean;
  /** a stop or target moved since members last heard: offer to tell them */
  moved?: boolean;
  drag: boolean;
};

type TwoPoint = "trend" | "ray" | "rect" | "fib" | "measure" | "zoom";
type Drag =
  | { kind: "pan"; x: number; y: number; off: number; lo: number; hi: number }
  | { kind: "scaleY"; y: number; lo: number; hi: number }
  | { kind: "scaleX"; x: number; bw: number; off: number }
  | { kind: "draw"; tool: TwoPoint; x0: number; y0: number }
  | { kind: "brush"; pts: Pt[] }
  | { kind: "move"; orig: Drawing; x0: number; y0: number }
  | { kind: "handle"; orig: Drawing; idx: number };

type Ink = K.Ink & { blue: string; ember: string; strong: string; muted: string; tl: string; e1: string; e2: string };

const TWO: TwoPoint[] = ["trend", "ray", "rect", "fib", "measure", "zoom"];

/** Style writes that only touch the DOM when the value actually changes, so a quiet tick costs no style work. */
const written = new WeakMap<HTMLElement, Record<string, string>>();
function put(el: HTMLElement, prop: string, value: string) {
  let w = written.get(el);
  if (!w) written.set(el, (w = {}));
  if (w[prop] === value) return;
  w[prop] = value;
  el.style.setProperty(prop, value);
}
function putData(el: HTMLElement, key: string, value: string) {
  if (el.dataset[key] !== value) el.dataset[key] = value;
}

/** Any CSS colour as rgba with the given alpha; canvases don't all read color-mix(). */
function withAlpha(color: string, a: number): string {
  const c = document.createElement("canvas").getContext("2d");
  if (!c) return color;
  c.fillStyle = color;
  const v = c.fillStyle; // normalised to #rrggbb or rgba(...)
  if (v.startsWith("#")) {
    const n = parseInt(v.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  const m = v.match(/[\d.]+/g);
  return m ? `rgba(${m[0]}, ${m[1]}, ${m[2]}, ${a})` : color;
}

function rangeStart(r: Range, now: number): number {
  const d = new Date(now);
  const back = (m: number) => new Date(d.getFullYear(), d.getMonth() - m, d.getDate()).getTime();
  if (r === "1D") return now - 86_400_000;
  if (r === "5D") return now - 5 * 86_400_000;
  if (r === "1M") return back(1);
  if (r === "3M") return back(3);
  if (r === "6M") return back(6);
  if (r === "YTD") return new Date(d.getFullYear(), 0, 1).getTime();
  if (r === "1Y") return back(12);
  if (r === "5Y") return back(60);
  return -Infinity;
}

function span(ms: number): string {
  const m = Math.round(Math.abs(ms) / 60_000);
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${Math.round(m / 1440)}d`;
}

/** What members see: no grid, no position zone, no volume; fills on. */
const VIEW_CFG = { volume: false, fills: true, zone: false, grid: false, log: false };

/**
 * The desk's chart. With `viewer` it's the read-only chart of the Community page: Yazan's
 * position, stop and target as plain tags, his fills, and nothing that trades, draws or configures.
 */
/** A finished trade, drawn as plain tags on the viewer's chart. */
export type TradeMarks = { side: 1 | -1; qty: number; entry: number; exit?: number; stop?: number; target?: number };

export function Chart({
  viewer = false,
  focus,
  until,
  marks,
  shadow = false,
  who,
}: {
  /** the owner's desk: Yazan's live levels in his own colour, behind the owner's book */
  shadow?: boolean;
  /** whose book to draw: Yazan's (the viewer's default) or the seated one */
  who?: "his" | "mine";
  viewer?: boolean;
  /** bring this stretch of time into view (a past trade) */
  focus?: { from: number; to: number };
  /** freeze the chart: no bars after this moment */
  until?: number;
  /** draw these levels instead of the live position */
  marks?: TradeMarks;
} = {}) {
  const sym = useDesk((st) => st.settings.sym);
  const tf = useDesk((st) => st.settings.tf);
  const pick = useDesk((st) => st.pick);
  const whose = who ?? (viewer ? "his" : "mine");
  const whoseRef = useRef(whose);
  whoseRef.current = whose;
  const seat = useDesk((st) => st.seat);
  const pos = useDesk((st) => bookOf(st, whose).positions[sym]);
  const orders = useDesk(useShallow((st) => bookOf(st, whose).orders.filter((o) => o.sym === sym)));
  // Yazan's open trade in this market (he trades the mini, the owner its micro)
  const hisPos = useDesk((st) => (shadow && st.seat === "owner" ? Object.values(hisBook(st).positions).find((p) => p && INSTRUMENTS[p.sym].under === INSTRUMENTS[sym].under) : undefined));
  const hisOrders = useDesk(useShallow((st) => (shadow && st.seat === "owner" ? hisBook(st).orders.filter((o) => INSTRUMENTS[o.sym].under === INSTRUMENTS[sym].under && (o.role === "stop" || o.role === "target")) : [])));
  const alerts = useDesk(useShallow((st) => st.alerts.filter((a) => a.sym === sym)));
  const ticket = useDesk((st) => st.ticket);
  const tQty = useDesk((st) => st.settings.qty[sym]);
  const [dStop, dTarget, dFollowStop, dFollowTarget, dTarget2, dFollowTarget2] = useDesk(
    useShallow((st) => {
      const e = ticketExits(st, sym);
      const px = { stop: st.ticket.stopPx, target: st.ticket.targetPx, target2: st.ticket.target2Px };
      const exact = (w: "stop" | "target" | "target2") => st.ticket.pxSym === sym && st.settings.exitUnits[w][0] === "price" && px[w] !== null;
      return [e.stop, e.target, !exact("stop"), !exact("target"), st.settings.qty[sym] >= 2 ? e.target2 : null, !exact("target2")] as const;
    }),
  );
  const log = useDesk((st) => st.settings.chart.log);
  const chartCfg = useDesk((st) => st.settings.chart);
  const rail = useDraw((st) => st.rail);
  const tool = useDraw((st) => st.tool);
  const drawCount = useDraw((st) => st.byUnder[INSTRUMENTS[sym].under].length);
  const selId = useDraw((st) => (st.hidden ? null : st.selected));
  const selKind = useDraw((st) => (st.selected ? st.byUnder[INSTRUMENTS[sym].under].find((d) => d.id === st.selected)?.kind ?? null : null));
  const selHidden = useDraw((st) => (st.selected ? !!st.byUnder[INSTRUMENTS[sym].under].find((d) => d.id === st.selected)?.hidden : false));
  const selPos = useDraw(
    useShallow((st) => {
      const d = st.selected ? st.byUnder[INSTRUMENTS[sym].under].find((x) => x.id === st.selected) : undefined;
      return d && (d.kind === "long" || d.kind === "short") ? [d.colors?.text, d.colors?.up, d.colors?.down] : null;
    }),
  );
  const inst = INSTRUMENTS[sym];

  const [auto, setAuto] = useState(true);
  const [range, setRange] = useState<Range | null>(null);
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const [settings, setSettingsOpen] = useState(false);
  const [text, setText] = useState<null | { x: number; y: number; at: Pt; id?: string; value: string }>(null);
  const textRef = useRef<HTMLInputElement>(null);
  const textOpen = text !== null;
  // focus once the click that placed it has finished, or the browser takes focus back
  useEffect(() => {
    if (!textOpen) return;
    const id = window.setTimeout(() => textRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [textOpen]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overRef = useRef<HTMLCanvasElement>(null);
  const lineEls = useRef(new Map<string, HTMLDivElement>());
  const ruleEls = useRef(new Map<string, HTMLDivElement>());
  const leg = useRef<Record<string, HTMLElement | null>>({});
  const v = useRef({
    bw: K.DEFAULT_BW,
    off: 0,
    lo: 0,
    hi: 1,
    auto: true,
    fitted: false,
    n: 0,
    pendingRange: null as Range | null,
    range: null as Range | null,
    mx: -1,
    my: -1,
    inside: false,
    region: "plot" as "plot" | "price" | "time",
    drag: null as Drag | null,
    draft: null as null | { tool: TwoPoint; a: Pt; b: Pt },
    measure: null as null | { a: Pt; b: Pt },
    zoom: null as null | { x0: number; y0: number; x1: number; y1: number },
    hover: null as string | null,
    lineDrag: null as null | { id: string; price: number },
    /** the community page asked to see a stretch of time (a past trade) */
    pendingFocus: null as null | { from: number; to: number },
    frame: null as K.Frame | null,
    raf: 0,
    base: true,
    over: true,
    flash: 0,
    lastPx: 0,
    ink: null as Ink | null,
    /** how much of the chart's extras show (1) or have faded out (0) as the plot gets short */
    fo: 1,
    /** where the selected drawing was grabbed, for placing its pop-up on long lines */
    selX: 0,
    selY: 0,
    popW: 0,
    popH: 0,
  });

  /* ---------- lines on the chart, from the book ---------- */
  const lines = useMemo<Line[]>(() => {
    const out: Line[] = [];
    if (hisPos) {
      out.push({ id: "h-entry", price: hisPos.avg, kind: "his", title: `Yazan ${hisPos.qty > 0 ? "long" : "short"} ${Math.abs(hisPos.qty)}`, drag: false });
      for (const o of hisOrders) out.push({ id: `h-${o.id}`, price: o.role === "stop" ? o.stop! : o.limit!, kind: "his", title: o.role === "stop" ? "His stop" : "His target", drag: false });
    }
    if (viewer && marks) {
      const pnl = (p: number) => money((p - marks.entry) * marks.side * marks.qty * inst.pv);
      out.push({ id: "m-entry", price: marks.entry, kind: "entry", title: `${marks.side > 0 ? "Long" : "Short"} ${marks.qty}`, drag: false });
      if (marks.target !== undefined) out.push({ id: "m-target", price: marks.target, kind: "target", title: "Target", value: pnl(marks.target), tone: "pos", drag: false });
      if (marks.stop !== undefined) out.push({ id: "m-stop", price: marks.stop, kind: "stop", title: "Stop", value: pnl(marks.stop), tone: "neg", drag: false });
      if (marks.exit !== undefined) {
        const v = (marks.exit - marks.entry) * marks.side * marks.qty * inst.pv;
        out.push({ id: "m-exit", price: marks.exit, kind: "exit", title: "Exit", value: money(v), tone: v >= 0 ? "pos" : "neg", drag: false });
      }
      return out;
    }
    if (viewer) {
      if (pos) {
        out.push({ id: "entry", price: pos.avg, kind: "entry", title: `${pos.qty > 0 ? "Long" : "Short"} ${Math.abs(pos.qty)}`, drag: false });
        for (const o of orders) {
          if (o.role !== "stop" && o.role !== "target") continue;
          const p = o.role === "stop" ? o.stop! : o.limit!;
          const pnl = (p - pos.avg) * pos.qty * inst.pv;
          out.push({ id: o.id, price: p, kind: o.role, title: o.role === "stop" ? "Stop" : "Target", value: money(pnl), tone: pnl >= 0 ? "pos" : "neg", drag: false });
        }
      }
      return out;
    }
    if (pos) {
      const dir = Math.sign(pos.qty);
      out.push({ id: "entry", price: pos.avg, kind: "entry", title: `${dir > 0 ? "Long" : "Short"} ${Math.abs(pos.qty)}`, drag: false });
      for (const o of orders) {
        if (o.role !== "stop" && o.role !== "target") continue;
        const p = o.role === "stop" ? o.stop! : o.limit!;
        const pnl = (p - pos.avg) * pos.qty * inst.pv;
        const moved = seat === "trader" && p !== o.told && p !== o.quiet;
        out.push({ id: o.id, price: p, kind: o.role, title: o.role === "stop" ? (o.type === "TRAIL" ? "Trail" : "Stop") : "Target", value: money(pnl), tone: pnl >= 0 ? "pos" : "neg", order: o, moved, drag: true });
      }
    }
    for (const o of orders) {
      if (o.role === "stop" || o.role === "target") continue;
      const p = o.type === "LMT" ? o.limit : o.stop;
      if (p === undefined) continue;
      out.push({ id: o.id, price: p, kind: "order", title: `${o.side > 0 ? "Buy" : "Sell"} ${o.type === "LMT" ? "lmt" : o.type === "STP" ? "stp" : o.type === "STPLMT" ? "stp lmt" : "trail"} ${o.qty}`, order: o, drag: o.type !== "TRAIL" });
    }
    for (const a of alerts) out.push({ id: a.id, price: a.price, kind: "alert", title: "Alert", alertId: a.id, drag: true });
    // the ticket's limit or stop order, with its exits, before it's sent: drag any of them
    const dp = ticket.type === "LMT" ? ticket.limit : ticket.type === "STP" ? ticket.stop : null;
    if (dp !== null) {
      const side = ticket.side;
      const legPnl = (p: number) => (p - dp) * side * tQty * inst.pv;
      out.push({ id: "d-entry", price: dp, kind: side > 0 ? "dbuy" : "dsell", title: `${side > 0 ? "Buy" : "Sell"} ${tQty}`, value: ticket.type === "LMT" ? "Limit" : "Stop", draft: "entry", drag: true });
      if (dTarget !== null) out.push({ id: "d-target", price: dTarget, kind: "dtarget", title: dTarget2 !== null ? "TP1" : "TP", value: money(legPnl(dTarget) / (dTarget2 !== null ? 2 : 1)), tone: "pos", draft: "target", follows: dFollowTarget, drag: true });
      if (dTarget2 !== null) out.push({ id: "d-target2", price: dTarget2, kind: "dtarget", title: "TP2", value: money(legPnl(dTarget2) / 2), tone: "pos", draft: "target2", follows: dFollowTarget2, drag: true });
      if (dStop !== null) out.push({ id: "d-stop", price: dStop, kind: "dstop", title: "SL", value: money(legPnl(dStop)), tone: "neg", draft: "stop", follows: dFollowStop, drag: true });
    }
    return out;
  }, [viewer, marks, hisPos, hisOrders, seat, pos, orders, alerts, inst.pv, ticket, tQty, dStop, dTarget, dFollowStop, dFollowTarget, dTarget2, dFollowTarget2]);
  const linesRef = useRef(lines);
  linesRef.current = lines;

  /* ---------- scheduling ---------- */
  const paint = useRef<() => void>(() => {});
  const invalidate = useCallback((base: boolean) => {
    const st = v.current;
    if (base) st.base = true;
    st.over = true;
    if (!st.raf) st.raf = requestAnimationFrame(() => paint.current());
  }, []);

  const readInk = () => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const cs = getComputedStyle(wrap);
    const g = (n: string) => cs.getPropertyValue(n).trim();
    v.current.ink = {
      line: g("--text-strong"),
      fill: withAlpha(g("--text"), 0.07),
      text: g("--text-strong"),
      dim: g("--dim"),
      pos: g("--blue"),
      neg: g("--ember"),
      bg: g("--page") || g("--bg"),
      sans: getComputedStyle(document.body).fontFamily,
      mono: cs.fontFamily,
      b1: g("--cv-dither-1"),
      b2: g("--cv-dither-2"),
      blue: g("--blue"),
      ember: g("--ember"),
      strong: g("--text-strong"),
      muted: g("--muted"),
      tl: g("--tl"),
      e1: g("--cv-ember-1"),
      e2: g("--cv-ember-2"),
    };
  };

  /** What drawings need from the desk right now: fib levels, the ticket size, the tape. */
  const drawCtx = (): K.DrawCtx => {
    const ds = useDesk.getState();
    const sy = ds.settings.sym;
    const ins = INSTRUMENTS[sy];
    return { fib: useDraw.getState().fib, qty: ds.settings.qty[sy], pv: ins.pv, tick: ins.tick, last: ds.quotes[sy].last };
  };

  /* ---------- the frame: bars, scales and geometry ---------- */
  const frame = (): K.Frame | null => {
    const wrap = wrapRef.current;
    const m = getMarket();
    if (!wrap || !m) return null;
    const st = v.current;
    const ds = useDesk.getState();
    const symNow = ds.settings.sym;
    const ins = INSTRUMENTS[symNow];
    const sec = tfSec(ds.settings.tf);
    let bars = m.bars(ins.under, sec);
    const cap = untilRef.current;
    if (cap !== undefined && bars.length && bars[bars.length - 1].t > cap) {
      let lo = 0;
      let hi = bars.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (bars[mid].t <= cap) lo = mid + 1;
        else hi = mid;
      }
      bars = bars.slice(0, Math.max(1, lo));
    }
    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    if (!W || !H || !bars.length) return null;
    const plotW = W - K.AXIS_W;
    const plotH = H - K.TIME_H;
    const n = bars.length;

    if (st.pendingRange) {
      const from = rangeStart(st.pendingRange, Date.now());
      let i = n - 1;
      while (i > 0 && bars[i - 1].t >= from) i--;
      const count = n - i;
      st.bw = Math.max(K.MIN_BW, Math.min(K.MAX_BW, plotW / (count + K.padBars(plotW / count) + 1)));
      st.off = 0;
      st.auto = true;
      st.fitted = false;
      st.range = st.pendingRange;
      st.pendingRange = null;
    }
    if (st.pendingFocus) {
      // bring a stretch of time (a past trade) to the middle of the chart, with room around it
      const { from, to } = st.pendingFocus;
      let i0 = 0;
      while (i0 < n - 1 && bars[i0].t < from) i0++;
      let i1 = n - 1;
      while (i1 > 0 && bars[i1].t > to) i1--;
      const count = Math.max(48, Math.round(Math.max(1, i1 - i0 + 1) * 2.6));
      st.bw = Math.max(K.MIN_BW, Math.min(K.MAX_BW, plotW / count));
      const L0 = (i0 + i1) / 2 + plotW / st.bw / 2 - K.padBars(st.bw) - 0.5;
      st.off = Math.max(0, n - 1 - L0);
      st.auto = true;
      st.fitted = false;
      st.range = null;
      st.n = n;
      st.pendingFocus = null;
    }
    // hold the view still when scrolled back and a new bar arrives
    if (st.n && n > st.n && st.off > 0.5) st.off += n - st.n;
    st.n = n;
    const visible = plotW / st.bw;
    const pad = K.padBars(st.bw);
    st.off = Math.max(-visible * 0.6, Math.min(n - 3, st.off));
    const L = n - 1 - st.off;
    const first = Math.max(0, Math.floor(L - visible + pad) - 1);
    const last = Math.min(n - 1, Math.ceil(L));
    const volOn = !viewer && ds.settings.chart.volume && st.bw >= 2;
    const volTop = volOn ? plotH - Math.round(plotH * K.VOL_FRAC) : plotH;
    const pTop = 40;
    const pBot = (volOn ? volTop : plotH) - 18;
    const logOn = !viewer && ds.settings.chart.log;

    if (st.auto) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = first; i <= last; i++) {
        if (bars[i].l < lo) lo = bars[i].l;
        if (bars[i].h > hi) hi = bars[i].h;
      }
      if (!Number.isFinite(lo)) {
        const q = ds.quotes[symNow].last;
        lo = q - 10;
        hi = q + 10;
      }
      if (last >= n - 2) {
        const span0 = Math.max(hi - lo, ins.tick * 16);
        for (const l of linesRef.current) {
          const p = st.lineDrag?.id === l.id ? st.lineDrag.price : l.price;
          if (p > lo - span0 * 0.6 && p < hi + span0 * 0.6) {
            lo = Math.min(lo, p);
            hi = Math.max(hi, p);
          }
        }
      }
      const padP = Math.max((hi - lo) * 0.08, ins.tick * 4);
      const tLo = logOn ? lo / (1 + (padP / hi) * 1.2) : lo - padP;
      const tHi = hi + padP;
      if (!st.fitted) {
        st.lo = tLo;
        st.hi = tHi;
        st.fitted = true;
      } else {
        st.lo += (tLo - st.lo) * 0.3;
        st.hi += (tHi - st.hi) * 0.3;
        if (Math.abs(tLo - st.lo) > ins.tick * 0.05 || Math.abs(tHi - st.hi) > ins.tick * 0.05) st.base = true;
      }
    }
    if (logOn && st.lo <= 0) st.lo = Math.max(1, st.hi / 4);
    const f: K.Frame = { W, H, plotW, plotH, pTop, pBot, volTop, bw: st.bw, pad, L, lo: st.lo, hi: st.hi, log: logOn, bars, dur: sec * 1000, first, last };
    st.frame = f;
    return f;
  };

  /**
   * The backing store grows in steps and is kept while the plot changes size, so a chart
   * that's resizing in motion (full screen, the blotter rising) repaints every frame without
   * reallocating its canvases every frame. Whatever lies past the plot is clipped.
   */
  const sizeCanvas = (c: HTMLCanvasElement, W: number, H: number) => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const step = (n: number) => Math.ceil(n / 160) * 160;
    const cw = Number(c.dataset.w) || 0;
    const ch = Number(c.dataset.h) || 0;
    if (cw < W || ch < H || cw > step(W) * 1.6 || ch > step(H) * 1.6 || c.dataset.dpr !== String(dpr)) {
      const w = step(W);
      const h = step(H);
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      c.dataset.w = String(w);
      c.dataset.h = String(h);
      c.dataset.dpr = String(dpr);
    }
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  };

  /* ---------- base layer: everything that moves with data or the view ---------- */
  const drawBase = (f: K.Frame) => {
    const st = v.current;
    const canvas = baseRef.current!;
    const C = st.ink!;
    const ctx = sizeCanvas(canvas, f.W, f.H);
    ctx.clearRect(0, 0, f.W, f.H);
    const ds = useDesk.getState();
    const symNow = ds.settings.sym;
    const ins = INSTRUMENTS[symNow];
    const cfg = viewer ? VIEW_CFG : ds.settings.chart;
    const quote = ds.quotes[symNow];
    const sec = tfSec(ds.settings.tf);
    const { bars, first, last, plotW, plotH } = f;
    const bodyW = Math.max(1, Math.round(f.bw * 0.64));
    const yl = Math.round(K.yOf(f, quote.last));

    // as the blotter rises over the chart, the extras (legend, tags, drawings, tools) fade out
    // well before they could crowd each other, then the chart itself goes
    const fo = Math.max(0, Math.min(1, (plotH - 90) / 80));
    const fc = Math.max(0, Math.min(1, (plotH - 10) / 50));
    st.fo = fo;
    const body = wrapRef.current?.parentElement;
    if (body) {
      put(body, "--fit", fo.toFixed(3));
      put(body, "--fit-c", fc.toFixed(3));
      putData(body, "fit", fo <= 0.02 ? "0" : "1");
    }

    ctx.font = `10.5px ${C.mono}`;
    ctx.textBaseline = "middle";

    // grid and price labels
    const step = K.priceStep(f.lo, f.hi, f.pBot - f.pTop);
    const levels: number[] = [];
    for (let p = Math.ceil(f.lo / step) * step; p <= f.hi; p += step) levels.push(p);
    ctx.fillStyle = C.tl;
    if (cfg.grid) for (const p of levels) {
      const y = Math.round(K.yOf(f, p));
      if (y > 4 && y < f.pBot + 8) ctx.fillRect(0, y, plotW, 1);
    }
    ctx.fillRect(plotW, 0, 1, plotH);
    ctx.fillRect(0, plotH, f.W, 1);
    if (f.volTop < plotH) ctx.fillRect(0, f.volTop - 1, plotW, 1);
    ctx.fillStyle = C.dim;
    ctx.textAlign = "left";
    for (const p of levels) {
      const y = Math.round(K.yOf(f, p));
      if (y < 8 || y > plotH - 8 || Math.abs(y - yl) < 14) continue;
      ctx.fillText(fmt(p), plotW + 12, y);
    }

    // time labels
    ctx.textAlign = "center";
    for (const tk of K.timeTicks(f, sec)) {
      const x = Math.round(tk.x);
      ctx.fillStyle = C.tl;
      ctx.fillRect(x, plotH, 1, 5);
      ctx.fillStyle = tk.strong ? C.text : C.dim;
      ctx.fillText(tk.text, x, plotH + 15);
    }

    // clip the plot so nothing spills onto the axes
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, plotW, plotH);
    ctx.clip();

    // the open position, as a dithered zone between entry and the tape
    const posNow = bookOf(ds, whoseRef.current).positions[symNow];
    if (cfg.zone && posNow) {
      let ei = last;
      while (ei > 0 && bars[ei].t > posNow.openedAt) ei--;
      const x0 = Math.max(0, Math.round(K.xOf(f, ei)));
      const x1 = Math.round(plotW - 2);
      const ya = K.yOf(f, posNow.avg);
      const yb = K.yOf(f, quote.last);
      const top = Math.max(f.pTop - 6, Math.min(ya, yb));
      const bot = Math.min(f.pBot + 6, Math.max(ya, yb));
      const win = (quote.last - posNow.avg) * Math.sign(posNow.qty) >= 0;
      const pA = new Path2D();
      const pB = new Path2D();
      const cell = 3;
      if (x1 > x0 && bot > top) {
        for (let y = Math.floor(top / cell) * cell; y < bot; y += cell) {
          const near = 1 - Math.abs(y - yb) / Math.max(1, bot - top);
          for (let x = Math.floor(x0 / cell) * cell; x < x1; x += cell) {
            const fade = Math.min(1, (x - x0) / 90);
            const I = (0.03 + 0.24 * near * near) * (0.35 + 0.65 * fade);
            if (I > (BAYER4[((y / cell) & 3) * 4 + ((x / cell) & 3)] + 0.5) / 16) (I > 0.3 ? pB : pA).rect(x, y, 2, 2);
          }
        }
      }
      ctx.fillStyle = win ? C.b1 : C.e1;
      ctx.fill(pA);
      ctx.fillStyle = win ? C.b2 : C.e2;
      ctx.fill(pB);
    }

    const lineMode = f.bw < 2;
    // volume, as slats that thin out toward the top
    if (f.volTop < plotH) {
      const volH = plotH - f.volTop - 6;
      let vmax = 1;
      for (let i = first; i <= last; i++) if (bars[i].v > vmax) vmax = bars[i].v;
      const LEVELS = [0.42, 0.3, 0.21, 0.14];
      const up = LEVELS.map(() => new Path2D());
      const dn = LEVELS.map(() => new Path2D());
      for (let i = first; i <= last; i++) {
        const b = bars[i];
        const h = (b.v / vmax) * volH;
        const x0 = Math.round(K.xOf(f, i)) - Math.floor(bodyW / 2);
        const set = b.c >= b.o ? up : dn;
        for (let y = plotH - 3; plotH - 1 - y <= h; y -= 3) set[Math.min(3, Math.floor(((plotH - 1 - y) / volH) * 4))].rect(x0, y, bodyW, 2);
      }
      LEVELS.forEach((a, k) => {
        ctx.globalAlpha = a;
        ctx.fillStyle = C.blue;
        ctx.fill(up[k]);
        ctx.fillStyle = C.ember;
        ctx.fill(dn[k]);
      });
      ctx.globalAlpha = 1;
    }

    if (lineMode) {
      // far out: a line with the band's dithered glow beneath, as on the landing page
      K.lineGlow(ctx, f, C, f.pBot + 16);
      ctx.beginPath();
      let started = false;
      for (let i = first; i <= last; i++) {
        const x = K.xOf(f, i);
        const y = K.yOf(f, bars[i].c);
        if (started) ctx.lineTo(x, y);
        else {
          ctx.moveTo(x, y);
          started = true;
        }
      }
      ctx.strokeStyle = C.blue;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      ctx.stroke();
    } else {
      const upP = new Path2D();
      const dnP = new Path2D();
      for (let i = first; i <= last; i++) {
        const b = bars[i];
        const x = Math.round(K.xOf(f, i));
        const path = b.c >= b.o ? upP : dnP;
        const yh = Math.round(K.yOf(f, b.h));
        const ylo = Math.round(K.yOf(f, b.l));
        path.rect(x, yh, 1, Math.max(1, ylo - yh));
        const yo = K.yOf(f, b.o);
        const yc = K.yOf(f, b.c);
        path.rect(x - Math.floor(bodyW / 2), Math.round(Math.min(yo, yc)), bodyW, Math.max(1, Math.round(Math.abs(yc - yo))));
      }
      ctx.fillStyle = C.blue;
      ctx.fill(upP);
      ctx.fillStyle = C.ember;
      ctx.fill(dnP);
    }

    // executions: an arrow under the bar for a buy, over it for a sell
    if (cfg.fills && f.bw >= 3) {
      const fills = bookOf(ds, whoseRef.current).fills;
      const t0 = bars[first]?.t ?? 0;
      const halo = new Path2D();
      const buys = new Path2D();
      const sells = new Path2D();
      const tri = (path: Path2D, x: number, y: number, up: boolean, r: number) => {
        path.moveTo(x - r, up ? y + r * 0.8 : y - r * 0.8);
        path.lineTo(x + r, up ? y + r * 0.8 : y - r * 0.8);
        path.lineTo(x, up ? y - r : y + r);
        path.closePath();
      };
      const seen = new Map<string, number>();
      for (const fl of fills) {
        if (fl.sym !== symNow || fl.at < t0) continue;
        const i = Math.floor(K.idxOfTime(f, fl.at));
        if (i < first || i > last) continue;
        const upw = fl.side > 0;
        const key = `${i}${upw ? "b" : "s"}`;
        const k = seen.get(key) ?? 0;
        seen.set(key, k + 1);
        const x = Math.round(K.xOf(f, i)) + 0.5;
        const y = upw ? Math.round(K.yOf(f, bars[i].l)) + 9 + k * 11 : Math.round(K.yOf(f, bars[i].h)) - 9 - k * 11;
        if (y < 0 || y > f.pBot + 14) continue;
        tri(halo, x, y, upw, 6.5);
        tri(upw ? buys : sells, x, y, upw, 4.5);
      }
      ctx.fillStyle = C.bg;
      ctx.fill(halo);
      ctx.fillStyle = C.blue;
      ctx.fill(buys);
      ctx.fillStyle = C.ember;
      ctx.fill(sells);
    }

    // drawings
    const dr = useDraw.getState();
    const mine = dr.byUnder[ins.under];
    const dc = drawCtx();
    if (!dr.hidden && fo > 0 && !viewer) {
      for (const d of mine) {
        // a hidden drawing only shows, faintly, while the tools are open or it's selected
        if (d.hidden && !dr.rail && d.id !== dr.selected) continue;
        ctx.globalAlpha = fo * (d.hidden ? 0.26 : 1);
        K.paintDrawing(ctx, f, d, C, d.id === dr.selected, dc);
      }
      ctx.globalAlpha = 1;
    }

    // the bracket a hovered deal button would send
    if (ds.preview && ds.ticket.type === "MKT" && !viewer) {
      const side = ds.preview;
      const look = { ...ds, ticket: { ...ds.ticket, side } };
      const entry = ticketEntry(look, symNow);
      const ex = ticketExits(look, symNow);
      const rows: { p: number; label: string; color: string }[] = [{ p: entry, label: side > 0 ? "Buy" : "Sell", color: C.strong }];
      if (ex.stop !== null) rows.push({ p: ex.stop, label: "Stop", color: C.ember });
      if (ex.target !== null) rows.push({ p: ex.target, label: "Target", color: C.blue });
      ctx.font = `10px ${C.mono}`;
      ctx.textAlign = "right";
      for (const r of rows) {
        const y = Math.round(K.yOf(f, r.p)) + 0.5;
        ctx.strokeStyle = r.color;
        ctx.globalAlpha = 0.7 * fo;
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(plotW, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = fo;
        ctx.fillStyle = r.color;
        ctx.fillText(`${r.label.toUpperCase()} ${fmt(r.p)}`, plotW - 10, y - 8);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = "left";
    }
    ctx.restore();

    // axis tags for horizontal and vertical lines
    if (!dr.hidden && fo > 0 && !viewer) {
      ctx.font = `10.5px ${C.mono}`;
      ctx.globalAlpha = fo;
      for (const d of mine) {
        if (d.hidden) continue;
        if (d.kind === "hline") {
          const y = K.yOf(f, d.a.p);
          if (y < 0 || y > plotH) continue;
          ctx.fillStyle = C.bg;
          K.roundRect(ctx, plotW + 5, y - 10, K.AXIS_W - 10, 20, 5);
          ctx.fill();
          ctx.strokeStyle = C.strong;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = C.strong;
          ctx.textAlign = "left";
          ctx.fillText(fmt(d.a.p), plotW + 12, y + 0.5);
        } else if (d.kind === "vline") {
          const x = K.xOfTime(f, d.a.t);
          if (x < 0 || x > plotW) continue;
          const label = K.fullTime(d.a.t, sec);
          const tw = ctx.measureText(label).width + 16;
          ctx.fillStyle = C.strong;
          K.roundRect(ctx, x - tw / 2, plotH + 4, tw, 18, 5);
          ctx.fill();
          ctx.fillStyle = C.bg;
          ctx.textAlign = "center";
          ctx.fillText(label, x, plotH + 13.5);
        }
      }
      ctx.globalAlpha = 1;
    }

    // the tape (a frozen chart of a past trade has no live price)
    if (untilRef.current === undefined) {
    if (quote.last !== st.lastPx) {
      st.flash = performance.now();
      st.lastPx = quote.last;
      window.setTimeout(() => invalidate(true), 440);
    }
    ctx.fillStyle = C.text;
    ctx.globalAlpha = 0.55;
    for (let x = 0; x < plotW; x += 5) ctx.fillRect(x, yl, 2, 1);
    ctx.globalAlpha = 1;
    const flashing = performance.now() - st.flash < 420;
    ctx.fillStyle = flashing ? (quote.dir > 0 ? C.blue : C.ember) : C.strong;
    K.roundRect(ctx, plotW + 5, yl - 10, K.AXIS_W - 10, 20, 5);
    ctx.fill();
    ctx.fillStyle = C.bg;
    ctx.textAlign = "left";
    ctx.font = `10.5px ${C.mono}`;
    ctx.fillText(fmt(quote.last), plotW + 12, yl + 0.5);
    }

    // order, position and alert lines (DOM): tags that would overlap gather into a stack
    const placed: { el: HTMLDivElement; y: number }[] = [];
    const draftEntry = linesRef.current.find((x) => x.draft === "entry");
    const entryShift = draftEntry && st.lineDrag?.id === draftEntry.id ? st.lineDrag.price - draftEntry.price : 0;
    for (const l of linesRef.current) {
      const el = lineEls.current.get(l.id);
      if (!el) continue;
      const p = st.lineDrag?.id === l.id ? st.lineDrag.price : l.follows ? l.price + entryShift : l.price;
      const y = K.yOf(f, p);
      const cy = Math.max(f.pTop - 8, Math.min(f.pBot + 8, y));
      const tf = `translateY(${cy.toFixed(1)}px)`;
      put(el, "transform", tf);
      putData(el, "off", y < f.pTop - 8 ? "up" : y > f.pBot + 8 ? "down" : "");
      const rule = ruleEls.current.get(l.id);
      if (rule) put(rule, "transform", tf);
      placed.push({ el, y: cy });
      if (st.lineDrag?.id === l.id) {
        const px = el.querySelector<HTMLElement>("[data-px]");
        if (px) px.textContent = fmt(p);
        const val = el.querySelector<HTMLElement>("[data-val]");
        if (val && l.draft && l.draft !== "entry" && draftEntry) {
          const t = useDesk.getState().ticket;
          val.textContent = money((p - draftEntry.price) * t.side * ds.settings.qty[symNow] * ins.pv);
        } else if (val && posNow) val.textContent = money((p - posNow.avg) * posNow.qty * ins.pv);
      }
      if (l.kind === "entry" && posNow && l.id === "entry") {
        const live = el.querySelector<HTMLElement>("[data-live]");
        const pnl = ((posNow.qty > 0 ? quote.bid : quote.ask) - posNow.avg) * posNow.qty * ins.pv;
        if (live) {
          const txt = money(pnl);
          if (live.textContent !== txt) live.textContent = txt;
          putData(live, "tone", pnl >= 0 ? "pos" : "neg");
        }
      }
    }
    placed.sort((a, b) => a.y - b.y);
    const TAG = 30;
    let groups = placed.map((it) => ({ items: [it], top: it.y - TAG / 2 }));
    for (let merged = true; merged; ) {
      merged = false;
      for (let i = 0; i < groups.length - 1; i++) {
        const a = groups[i];
        const b = groups[i + 1];
        if (a.top + a.items.length * TAG > b.top) {
          const items = [...a.items, ...b.items];
          const mid = items.reduce((sum, it) => sum + it.y, 0) / items.length;
          groups = [...groups.slice(0, i), { items, top: mid - (items.length * TAG) / 2 }, ...groups.slice(i + 2)];
          merged = true;
          break;
        }
      }
    }
    for (const g of groups) {
      const top = Math.max(30, Math.min(plotH - 4 - g.items.length * TAG, g.top));
      g.items.forEach((it, k) => {
        const dy = Math.round(top + k * TAG + TAG / 2 - it.y);
        put(it.el, "--dy", `${dy}px`);
        put(it.el, "--ady", `${Math.abs(dy)}px`);
        putData(it.el, "dir", dy < -2 ? "up" : dy > 2 ? "down" : "");
      });
    }
  };

  /* ---------- overlay: crosshair, drafts, handles ---------- */
  const drawOver = (f: K.Frame) => {
    const st = v.current;
    const C = st.ink!;
    const ctx = sizeCanvas(overRef.current!, f.W, f.H);
    ctx.clearRect(0, 0, f.W, f.H);
    const ds = useDesk.getState();
    const symNow = ds.settings.sym;
    const ins = INSTRUMENTS[symNow];
    const sec = tfSec(ds.settings.tf);
    const dr = useDraw.getState();
    ctx.font = `10.5px ${C.mono}`;
    ctx.textBaseline = "middle";

    // drafts and transient boxes
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, f.plotW, f.plotH);
    ctx.clip();
    const draft = st.draft;
    if (draft && draft.tool !== "measure" && draft.tool !== "zoom") K.paintDrawing(ctx, f, { id: "draft", kind: draft.tool, a: draft.a, b: draft.b } as Drawing, C, true, drawCtx());
    if (st.drag?.kind === "brush") K.paintDrawing(ctx, f, { id: "draft", kind: "brush", pts: st.drag.pts }, C, true);
    const meas = draft?.tool === "measure" ? draft : st.measure;
    if (meas) {
      const ax = K.xOfTime(f, meas.a.t);
      const bx = K.xOfTime(f, meas.b.t);
      const ay = K.yOf(f, meas.a.p);
      const by = K.yOf(f, meas.b.p);
      const dp = meas.b.p - meas.a.p;
      const up = dp >= 0;
      ctx.fillStyle = up ? C.blue : C.ember;
      ctx.globalAlpha = 0.12;
      ctx.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
      ctx.globalAlpha = 1;
      ctx.strokeStyle = up ? C.blue : C.ember;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      const bars = Math.round(K.idxOfTime(f, meas.b.t) - K.idxOfTime(f, meas.a.t));
      const ticks = Math.round(dp / ins.tick);
      const l1 = `${up ? "+" : "−"}${fmt(Math.abs(dp))} (${up ? "+" : "−"}${Math.abs((dp / meas.a.p) * 100).toFixed(2)}%) · ${Math.abs(ticks)} ticks`;
      const l2 = `${up ? "+" : "−"}$${fmt(Math.abs(ticks) * ins.tick * ins.pv)} per contract · ${Math.abs(bars)} bars, ${span(meas.b.t - meas.a.t)}`;
      ctx.font = `10.5px ${C.mono}`;
      const w = Math.max(ctx.measureText(l1).width, ctx.measureText(l2).width) + 20;
      const lx = Math.min(Math.max(8, (ax + bx) / 2 - w / 2), f.plotW - w - 8);
      const ly = Math.max(8, Math.min(f.plotH - 50, (up ? Math.min(ay, by) - 46 : Math.max(ay, by) + 8)));
      ctx.fillStyle = up ? C.blue : C.ember;
      K.roundRect(ctx, lx, ly, w, 40, 8);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.textAlign = "left";
      ctx.fillText(l1, lx + 10, ly + 13);
      ctx.globalAlpha = 0.85;
      ctx.fillText(l2, lx + 10, ly + 28);
      ctx.globalAlpha = 1;
    }
    if (st.zoom) {
      const z = st.zoom;
      ctx.fillStyle = C.text;
      ctx.globalAlpha = 0.06;
      ctx.fillRect(Math.min(z.x0, z.x1), Math.min(z.y0, z.y1), Math.abs(z.x1 - z.x0), Math.abs(z.y1 - z.y0));
      ctx.globalAlpha = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = C.muted;
      ctx.strokeRect(Math.min(z.x0, z.x1) + 0.5, Math.min(z.y0, z.y1) + 0.5, Math.abs(z.x1 - z.x0), Math.abs(z.y1 - z.y0));
      ctx.setLineDash([]);
    }
    // the hovered or selected drawing, lifted
    const mine = dr.byUnder[ins.under];
    const sel = dr.hidden || viewer ? undefined : mine.find((d) => d.id === dr.selected);
    if (!dr.hidden && st.fo > 0 && !viewer) {
      const hot = mine.find((d) => d.id === st.hover && d.id !== dr.selected);
      if (hot) {
        ctx.globalAlpha = st.fo * (hot.hidden ? 0.45 : 1);
        K.paintDrawing(ctx, f, hot, C, true, drawCtx());
        ctx.globalAlpha = st.fo;
      }
      if (sel && !dr.locked) {
        ctx.globalAlpha = st.fo;
        for (const h of K.handlesOf(f, sel)) {
          ctx.fillStyle = C.bg;
          ctx.strokeStyle = K.accentOf(sel, C);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(h.x, h.y, 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // the selected drawing's pop-up rides just above it (below, if there's no room)
    const pop = popRef.current;
    if (pop) {
      const moving = st.drag?.kind === "move" || st.drag?.kind === "handle";
      if (sel && !moving) {
        const b = K.boxOf(ctx, f, sel, C.sans, dr.fib);
        if (!st.popW) {
          st.popW = pop.offsetWidth;
          st.popH = pop.offsetHeight;
        }
        const cx = sel.kind === "hline" ? st.selX : (Math.max(0, b.x0) + Math.min(f.plotW, b.x1)) / 2;
        const top = sel.kind === "vline" ? st.selY : b.y0;
        const bot = sel.kind === "vline" ? st.selY : b.y1;
        let y = top - 12 - st.popH;
        if (y < 6) y = bot + 12;
        y = Math.max(6, Math.min(f.plotH - st.popH - 6, y));
        const x = Math.max(6, Math.min(f.plotW - st.popW - 6, cx - st.popW / 2));
        put(pop, "transform", `translate(${Math.round(x)}px, ${Math.round(y)}px)`);
      }
      putData(pop, "on", sel && !moving ? "1" : "");
    }

    // crosshair
    const busy = st.drag && (st.drag.kind === "pan" || st.drag.kind === "scaleX" || st.drag.kind === "scaleY");
    const showX = st.inside && !busy && st.mx >= 0 && st.mx < f.plotW && st.my >= 0 && st.my < f.H;
    let hb: number = f.last;
    if (showX) {
      hb = Math.max(f.first, Math.min(f.last, Math.round(K.iOfX(f, st.mx))));
      const cx = Math.round(K.xOf(f, Math.round(K.iOfX(f, st.mx))));
      const inPlot = st.my < f.plotH;
      ctx.fillStyle = C.text;
      ctx.globalAlpha = 0.35;
      for (let y = 0; y < f.plotH; y += 5) ctx.fillRect(cx, y, 1, 2);
      if (inPlot) for (let x = 0; x < f.plotW; x += 5) ctx.fillRect(x, Math.round(st.my), 2, 1);
      ctx.globalAlpha = 1;
      if (inPlot) {
        const p = K.pOfY(f, st.my);
        ctx.fillStyle = C.muted;
        K.roundRect(ctx, f.plotW + 5, st.my - 10, K.AXIS_W - 10, 20, 5);
        ctx.fill();
        ctx.fillStyle = C.bg;
        ctx.textAlign = "left";
        ctx.fillText(fmt(snap(symNow, p)), f.plotW + 12, st.my + 0.5);
      }
      const label = K.fullTime(K.timeOfIdx(f, Math.round(K.iOfX(f, st.mx))), sec);
      const tw = ctx.measureText(label).width + 16;
      ctx.fillStyle = C.muted;
      K.roundRect(ctx, Math.max(0, Math.min(f.plotW - tw, cx - tw / 2)), f.plotH + 4, tw, 18, 5);
      ctx.fill();
      ctx.fillStyle = C.bg;
      ctx.textAlign = "center";
      ctx.fillText(label, Math.max(tw / 2, Math.min(f.plotW - tw / 2, cx)), f.plotH + 13.5);
    }

    // the legend follows the crosshair, without React
    const b = f.bars[hb];
    if (b) {
      const L = leg.current;
      const txt = (el: HTMLElement | null, s2: string) => {
        if (el && el.textContent !== s2) el.textContent = s2;
      };
      txt(L.time, showX || untilRef.current !== undefined ? K.fullTime(b.t, sec) : "Now");
      txt(L.o, fmt(b.o));
      txt(L.h, fmt(b.h));
      txt(L.l, fmt(b.l));
      txt(L.c, fmt(b.c));
      if (L.c) putData(L.c, "tone", b.c >= b.o ? "pos" : "neg");
      txt(L.v, b.v >= 1e6 ? `${(b.v / 1e6).toFixed(2)}M` : b.v >= 1000 ? `${(b.v / 1000).toFixed(1)}k` : String(b.v));
    }

    // the pick-a-price ghost line
    const ghost = lineEls.current.get("ghost");
    if (ghost) {
      const show = !!ds.pick && st.inside && st.mx < f.plotW && st.my > 0 && st.my < f.pBot + 10;
      put(ghost, "opacity", show ? "1" : "0");
      if (show) {
        const p = snap(symNow, K.pOfY(f, st.my));
        put(ghost, "transform", `translateY(${K.yOf(f, p).toFixed(1)}px)`);
        const px = ghost.querySelector<HTMLElement>("[data-px]");
        const label = fmt(p);
        if (px && px.textContent !== label) px.textContent = label;
      }
    }
  };

  paint.current = () => {
    const st = v.current;
    st.raf = 0;
    if (!st.ink) readInk();
    if (!st.ink) return;
    const wantBase = st.base;
    st.base = false;
    st.over = false;
    const f = frame();
    if (!f) return;
    if (wantBase) drawBase(f);
    drawOver(f);
    if (st.base) invalidate(true); // still easing into a new scale
  };

  /* ---------- data, theme and size ---------- */
  useEffect(() => {
    startDrawings();
    const wrap = wrapRef.current;
    if (!wrap) return;
    // repaint inside the resize itself: while panels slide (fullscreen, the blotter) the
    // chart is redrawn at its new size in the same frame, never shown stretched
    const ro = new ResizeObserver(() => {
      const st = v.current;
      st.base = true;
      st.over = true;
      if (st.raf) {
        cancelAnimationFrame(st.raf);
        st.raf = 0;
      }
      paint.current();
    });
    ro.observe(wrap);
    const offTheme = onThemeChange(() =>
      requestAnimationFrame(() => {
        readInk();
        invalidate(true);
      }),
    );
    const unDesk = useDesk.subscribe((a, b) => {
      if (a.quotes !== b.quotes || a.positions !== b.positions || a.orders !== b.orders || a.fills !== b.fills || a.alerts !== b.alerts || a.settings !== b.settings || a.preview !== b.preview) invalidate(true);
      else if (a.pick !== b.pick) invalidate(false);
    });
    const unDraw = useDraw.subscribe(() => invalidate(true));
    return () => {
      ro.disconnect();
      offTheme();
      unDesk();
      unDraw();
      cancelAnimationFrame(v.current.raf);
      v.current.raf = 0;
    };
  }, [invalidate]);

  // lines re-rendered: place them
  useEffect(() => invalidate(true), [lines, invalidate]);

  // a past trade: pick a timeframe that fits it, then bring its stretch of time to the middle
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const untilRef = useRef(until);
  untilRef.current = until;
  const focusKey = focus ? `${focus.from}:${focus.to}` : "";
  useEffect(() => {
    const fo = focusRef.current;
    if (!viewer || !fo) return;
    const st = v.current;
    const dur = Math.max(60_000, fo.to - fo.from);
    const old = Date.now() - fo.from > 9 * 86_400_000; // minute bars go back ten days
    const want = (old ? [1800, 3600, 86400] : [60, 300, 900, 1800, 3600]).find((sec) => dur / 1000 / sec <= 70) ?? 3600;
    const tfNext = TIMEFRAMES.find((t) => t.sec === want)?.id ?? "5m";
    st.pendingFocus = fo;
    if (useDesk.getState().settings.tf !== tfNext) setSettings({ tf: tfNext });
    invalidate(true);
  }, [viewer, focusKey, invalidate]);

  // a new pop-up (or one that gained a button) is measured again, then placed
  useLayoutEffect(() => {
    v.current.popW = 0;
    invalidate(false);
  }, [selId, selKind, invalidate]);

  // a new market or timeframe starts fitted and current
  useEffect(() => {
    const st = v.current;
    // a frozen chart keeps its trade in view through timeframe changes
    if (!st.pendingFocus && focusRef.current) st.pendingFocus = focusRef.current;
    if (!st.pendingRange && !st.pendingFocus) {
      st.bw = K.DEFAULT_BW;
      st.range = null;
      setRange(null);
    }
    st.off = 0;
    st.auto = true;
    st.fitted = false;
    st.n = 0;
    st.draft = null;
    st.measure = null;
    setAuto(true);
    invalidate(true);
  }, [sym, tf, invalidate]);

  /* ---------- view changes ---------- */
  const manual = (st = v.current) => {
    if (st.auto) {
      st.auto = false;
      setAuto(false);
    }
  };
  const clearRange = (st = v.current) => {
    if (st.range) {
      st.range = null;
      setRange(null);
    }
  };
  const resetView = () => {
    const st = v.current;
    st.bw = K.DEFAULT_BW;
    st.off = 0;
    st.auto = true;
    st.fitted = false;
    st.measure = null;
    setAuto(true);
    clearRange();
    invalidate(true);
  };
  const applyRange = (r: Range) => {
    const spec = RANGES.find((x) => x.id === r)!;
    const st = v.current;
    st.pendingRange = r;
    setRange(r);
    setAuto(true);
    if (useDesk.getState().settings.tf !== spec.tf) setSettings({ tf: spec.tf });
    invalidate(true);
  };
  const zoomAt = (x: number, k: number) => {
    const st = v.current;
    const f = st.frame;
    if (!f) return;
    const i0 = K.iOfX(f, x);
    const bw = Math.max(K.MIN_BW, Math.min(K.MAX_BW, st.bw * k));
    const pad = K.padBars(bw);
    // keep the bar under the pointer where it is
    const L = i0 + (f.plotW - x) / bw - pad - 0.5;
    st.bw = bw;
    st.off = f.bars.length - 1 - L;
    clearRange();
    invalidate(true);
  };

  /* ---------- pointer ---------- */
  const local = (e: { clientX: number; clientY: number }) => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const regionAt = (x: number, y: number) => {
    const f = v.current.frame;
    if (!f) return "plot" as const;
    if (x >= f.plotW) return "price" as const;
    if (y >= f.plotH) return "time" as const;
    return "plot" as const;
  };
  const ptAt = (x: number, y: number): Pt => {
    const f = v.current.frame!;
    const i = Math.round(K.iOfX(f, x));
    let p = K.pOfY(f, y);
    if (useDraw.getState().magnet && i >= 0 && i < f.bars.length) {
      const b = f.bars[i];
      let dist = 16;
      for (const q of [b.o, b.h, b.l, b.c]) {
        const d = Math.abs(K.yOf(f, q) - y);
        if (d < dist) {
          dist = d;
          p = q;
        }
      }
    }
    return { t: K.timeOfIdx(f, i), p: snap(useDesk.getState().settings.sym, p) };
  };
  const under = () => INSTRUMENTS[useDesk.getState().settings.sym].under;
  const hitAt = (x: number, y: number): Drawing | null => {
    const st = v.current;
    const f = st.frame;
    const dr = useDraw.getState();
    if (!f || dr.hidden || viewer || st.fo <= 0.02) return null;
    const ctx = overRef.current!.getContext("2d")!;
    const mine = dr.byUnder[under()];
    for (let i = mine.length - 1; i >= 0; i--) {
      const d = mine[i];
      if (d.hidden && !dr.rail && d.id !== dr.selected) continue;
      if (K.hits(ctx, f, d, x, y, st.ink?.sans ?? "sans-serif", dr.fib)) return d;
    }
    return null;
  };
  const handleAt = (x: number, y: number): { d: Drawing; idx: number } | null => {
    const st = v.current;
    const f = st.frame;
    const dr = useDraw.getState();
    if (!f || !dr.selected || dr.hidden || dr.locked) return null;
    const d = dr.byUnder[under()].find((z) => z.id === dr.selected);
    if (!d) return null;
    const hs = K.handlesOf(f, d);
    for (let i = 0; i < hs.length; i++) if (Math.hypot(hs[i].x - x, hs[i].y - y) < 8) return { d, idx: i };
    return null;
  };
  const finish = (d: Drawing) => {
    v.current.selX = v.current.mx;
    v.current.selY = v.current.my;
    addDrawing(under(), d);
    if (!useDraw.getState().keep) setTool("cursor");
  };
  const commitTwo = (toolNow: TwoPoint, a: Pt, b: Pt) => {
    const st = v.current;
    const f = st.frame!;
    if (toolNow === "measure") {
      st.measure = { a, b };
      if (!useDraw.getState().keep) setTool("cursor");
      return;
    }
    if (toolNow === "zoom") {
      const i0 = K.idxOfTime(f, Math.min(a.t, b.t));
      const i1 = K.idxOfTime(f, Math.max(a.t, b.t));
      const count = Math.max(4, i1 - i0 + 1);
      st.bw = Math.max(K.MIN_BW, Math.min(K.MAX_BW, f.plotW / (count + K.padBars(f.plotW / count))));
      st.off = f.bars.length - 1 - i1;
      st.lo = Math.min(a.p, b.p);
      st.hi = Math.max(a.p, b.p);
      if (st.hi - st.lo < INSTRUMENTS[useDesk.getState().settings.sym].tick * 4) st.hi = st.lo + INSTRUMENTS[useDesk.getState().settings.sym].tick * 4;
      manual();
      clearRange();
      setTool("cursor");
      invalidate(true);
      return;
    }
    if (a.t === b.t && a.p === b.p) return;
    finish({ id: drawId(), kind: toolNow, a, b } as Drawing);
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    const st = v.current;
    const { x, y } = local(e);
    if (menu) setMenu(null);
    const region = regionAt(x, y);
    const target = e.currentTarget as Element;
    if (region === "price") {
      target.setPointerCapture(e.pointerId);
      st.drag = { kind: "scaleY", y, lo: st.lo, hi: st.hi };
      manual();
      return;
    }
    if (region === "time") {
      target.setPointerCapture(e.pointerId);
      st.drag = { kind: "scaleX", x, bw: st.bw, off: st.off };
      return;
    }
    const ds = useDesk.getState();
    if (ds.pick && !viewer) {
      const f = st.frame;
      if (f && y < f.pBot + 10) {
        const price = snap(ds.settings.sym, K.pOfY(f, y));
        const tk = ds.ticket;
        if (ds.pick === "stop" && tk.type === "STPLMT" && tk.stop !== null && tk.limit !== null) setTicket({ stop: price, limit: snap(ds.settings.sym, price + (tk.limit - tk.stop)) });
        else setTicket({ [ds.pick]: price });
        setPick(null);
      }
      return;
    }
    if (text) return;
    const dr = useDraw.getState();
    const toolNow = viewer ? (e.shiftKey ? "measure" : "cursor") : e.shiftKey && dr.tool === "cursor" ? "measure" : dr.tool;
    st.measure = null;

    if (toolNow !== "cursor") {
      const p = ptAt(x, y);
      if (TWO.includes(toolNow as TwoPoint)) {
        const two = toolNow as TwoPoint;
        if (st.draft && st.draft.tool === two) {
          // second click of click-click placement
          commitTwo(two, st.draft.a, p);
          st.draft = null;
          invalidate(true);
          return;
        }
        target.setPointerCapture(e.pointerId);
        st.draft = { tool: two, a: p, b: p };
        st.drag = { kind: "draw", tool: two, x0: x, y0: y };
        if (two === "zoom") st.zoom = { x0: x, y0: y, x1: x, y1: y };
        invalidate(false);
        return;
      }
      if (toolNow === "hline" || toolNow === "vline") {
        finish({ id: drawId(), kind: toolNow, a: p });
        return;
      }
      if (toolNow === "long" || toolNow === "short") {
        const f = st.frame!;
        const ds = useDesk.getState();
        const sy = ds.settings.sym;
        const tk = INSTRUMENTS[sy].tick;
        const dir = toolNow === "long" ? 1 : -1;
        const i = Math.round(K.idxOfTime(f, p.t));
        // sized to be workable at this zoom, at the ticket's usual reward-to-risk
        const sT = ds.settings.stopTicks[sy];
        const tT = ds.settings.targetTicks[sy];
        const stopDist = Math.max(sT * tk, (f.hi - f.lo) * 0.08);
        finish({
          id: drawId(),
          kind: toolNow,
          a: p,
          t2: K.timeOfIdx(f, i + Math.max(12, Math.round(150 / st.bw))),
          target: snap(sy, p.p + dir * stopDist * (tT / sT)),
          stop: snap(sy, p.p - dir * stopDist),
        });
        return;
      }
      if (toolNow === "arrow") {
        const f = st.frame!;
        const i = Math.max(0, Math.min(f.bars.length - 1, Math.round(K.iOfX(f, x))));
        const b = f.bars[i];
        const upArrow = y > K.yOf(f, (b.h + b.l) / 2);
        finish({ id: drawId(), kind: "arrow", a: { t: p.t, p: upArrow ? b.l : b.h }, up: upArrow });
        return;
      }
      if (toolNow === "text") {
        setText({ x, y, at: p, value: "" });
        return;
      }
      if (toolNow === "brush") {
        target.setPointerCapture(e.pointerId);
        st.drag = { kind: "brush", pts: [{ t: K.timeAtX(st.frame!, x), p: K.pOfY(st.frame!, y) }] };
        return;
      }
    }

    // the cursor: grab a handle, a drawing, or the chart itself
    const h = handleAt(x, y);
    if (h) {
      target.setPointerCapture(e.pointerId);
      st.drag = { kind: "handle", orig: h.d, idx: h.idx };
      return;
    }
    const hit = hitAt(x, y);
    if (hit) {
      selectDrawing(hit.id);
      st.selX = x;
      st.selY = y;
      if (dr.locked) return invalidate(false); // locked: it can be picked (hide, delete), not moved
      target.setPointerCapture(e.pointerId);
      st.drag = { kind: "move", orig: hit, x0: x, y0: y };
      return;
    }
    if (dr.selected) selectDrawing(null);
    target.setPointerCapture(e.pointerId);
    st.drag = { kind: "pan", x, y, off: st.off, lo: st.lo, hi: st.hi };
  };

  const onMove = (e: React.PointerEvent) => {
    const st = v.current;
    const { x, y } = local(e);
    st.mx = x;
    st.my = y;
    st.inside = true;
    const f = st.frame;
    const d = st.drag;
    const wrap = wrapRef.current!;
    if (!f) return invalidate(false);
    if (d?.kind === "pan") {
      st.off = d.off + (x - d.x) / st.bw;
      if (Math.abs(y - d.y) > 2 || !st.auto) {
        // grabbing the chart moves price too, as on TradingView
        if (st.auto && Math.abs(y - d.y) > 6) manual();
        if (!st.auto) {
          if (f.log) {
            const k = Math.exp(((y - d.y) / (f.pBot - f.pTop)) * (Math.log(d.hi) - Math.log(d.lo)));
            st.lo = d.lo * k;
            st.hi = d.hi * k;
          } else {
            const dp = ((y - d.y) / (f.pBot - f.pTop)) * (d.hi - d.lo);
            st.lo = d.lo + dp;
            st.hi = d.hi + dp;
          }
        }
      }
      if (Math.abs(x - d.x) > 2) clearRange();
      wrap.style.cursor = "grabbing";
      return invalidate(true);
    }
    if (d?.kind === "scaleY") {
      const k = Math.exp((y - d.y) * 0.005);
      if (f.log) {
        const mid = (Math.log(d.hi) + Math.log(d.lo)) / 2;
        const half = ((Math.log(d.hi) - Math.log(d.lo)) / 2) * k;
        st.lo = Math.exp(mid - half);
        st.hi = Math.exp(mid + half);
      } else {
        const mid = (d.hi + d.lo) / 2;
        const half = ((d.hi - d.lo) / 2) * k;
        st.lo = mid - half;
        st.hi = mid + half;
      }
      return invalidate(true);
    }
    if (d?.kind === "scaleX") {
      st.bw = Math.max(K.MIN_BW, Math.min(K.MAX_BW, d.bw * Math.exp((x - d.x) * 0.006)));
      st.off = d.off;
      clearRange();
      return invalidate(true);
    }
    if (d?.kind === "draw") {
      const p = ptAt(x, y);
      if (st.draft) st.draft.b = p;
      if (st.zoom) {
        st.zoom.x1 = x;
        st.zoom.y1 = y;
      }
      return invalidate(false);
    }
    if (d?.kind === "brush") {
      const lastP = d.pts[d.pts.length - 1];
      if (Math.abs(K.xOfTime(f, lastP.t) - x) + Math.abs(K.yOf(f, lastP.p) - y) > 3) d.pts.push({ t: K.timeAtX(f, x), p: K.pOfY(f, y) });
      return invalidate(false);
    }
    if (d?.kind === "move") {
      const di = Math.round((x - d.x0) / st.bw);
      const dp = K.pOfY(f, y) - K.pOfY(f, d.y0);
      replaceDrawing(under(), K.shifted(f, d.orig, di, snap(useDesk.getState().settings.sym, dp)));
      return;
    }
    if (d?.kind === "handle") {
      const p = ptAt(x, y);
      const o = d.orig;
      let next: Drawing = o;
      if (o.kind === "hline") next = { ...o, a: { ...o.a, p: p.p } };
      else if (o.kind === "vline") next = { ...o, a: { ...o.a, t: p.t } };
      else if (o.kind === "trend" || o.kind === "ray" || o.kind === "rect" || o.kind === "fib") next = d.idx === 0 ? { ...o, a: p } : { ...o, b: p };
      else if (o.kind === "long" || o.kind === "short") {
        // entry stays between its stop and target; each exit stays on its own side
        const dir = o.kind === "long" ? 1 : -1;
        const tk = INSTRUMENTS[useDesk.getState().settings.sym].tick;
        if (d.idx === 0) next = (o.target - p.p) * dir > 0 && (p.p - o.stop) * dir > 0 ? { ...o, a: p } : { ...o, a: { ...o.a, t: p.t } };
        else if (d.idx === 1) next = { ...o, t2: p.t > o.a.t ? p.t : o.t2 };
        else if (d.idx === 2) next = { ...o, target: (p.p - o.a.p) * dir >= tk ? p.p : o.a.p + dir * tk };
        else next = { ...o, stop: (o.a.p - p.p) * dir >= tk ? p.p : o.a.p - dir * tk };
      }
      replaceDrawing(under(), next);
      return;
    }
    // hovering
    if (st.draft) st.draft.b = ptAt(x, y);
    const region = regionAt(x, y);
    st.region = region;
    let cursor = region === "price" ? "ns-resize" : region === "time" ? "ew-resize" : useDesk.getState().pick ? "copy" : "crosshair";
    if (region === "plot" && useDraw.getState().tool === "cursor" && !useDesk.getState().pick) {
      const prev = st.hover;
      if (handleAt(x, y)) cursor = "move";
      const hit = hitAt(x, y);
      st.hover = hit?.id ?? null;
      if (hit && cursor !== "move") cursor = "pointer";
      if (prev !== st.hover) invalidate(false);
    }
    if (wrap.style.cursor !== cursor) wrap.style.cursor = cursor;
    invalidate(false);
  };

  const onUp = (e: React.PointerEvent) => {
    const st = v.current;
    const d = st.drag;
    st.drag = null;
    if (!d) return;
    const { x, y } = local(e);
    if (d.kind === "draw") {
      const moved = Math.hypot(x - d.x0, y - d.y0) > 5;
      st.zoom = null;
      if (moved && st.draft) {
        commitTwo(d.tool, st.draft.a, ptAt(x, y));
        st.draft = null;
      }
      // a click without a drag leaves the draft open for a second click
    } else if (d.kind === "brush") {
      if (d.pts.length > 1) finish({ id: drawId(), kind: "brush", pts: d.pts });
    }
    wrapRef.current!.style.cursor = "";
    invalidate(true);
  };

  const onLeave = () => {
    const st = v.current;
    st.inside = false;
    st.hover = null;
    invalidate(false);
  };

  const onDouble = (e: React.MouseEvent) => {
    const { x, y } = local(e);
    const region = regionAt(x, y);
    const st = v.current;
    if (region === "price") {
      st.auto = true;
      st.fitted = false;
      setAuto(true);
      return invalidate(true);
    }
    if (region === "time") {
      st.bw = K.DEFAULT_BW;
      st.off = 0;
      clearRange();
      return invalidate(true);
    }
    const hit = hitAt(x, y);
    if (hit?.kind === "text") {
      const f = st.frame!;
      setText({ x: K.xOfTime(f, hit.a.t), y: K.yOf(f, hit.a.p), at: hit.a, id: hit.id, value: hit.text });
      return;
    }
    if (!hit) resetView();
  };

  const onMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (viewer) return;
    const st = v.current;
    const f = st.frame;
    if (!f) return;
    const { x, y } = local(e);
    if (regionAt(x, y) !== "plot") return;
    const ds = useDesk.getState();
    const i = Math.round(K.iOfX(f, x));
    const t = K.timeOfIdx(f, i);
    setMenu({ x, y, price: snap(ds.settings.sym, K.pOfY(f, y)), t, label: K.fullTime(t, tfSec(ds.settings.tf)) });
  };

  // wheel: zoom time around the pointer, scale price over the axis, pan sideways
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const st = v.current;
      const f = st.frame;
      if (!f) return;
      const { x, y } = local(e);
      if (regionAt(x, y) === "price") {
        const k = Math.exp(e.deltaY * 0.0015);
        const mid = (st.hi + st.lo) / 2;
        const half = ((st.hi - st.lo) / 2) * k;
        st.lo = mid - half;
        st.hi = mid + half;
        manual();
        return invalidate(true);
      }
      if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        st.off += e.deltaX / st.bw;
        clearRange();
        return invalidate(true);
      }
      zoomAt(Math.min(x, f.plotW), Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    };
    wrap.addEventListener("wheel", wheel, { passive: false });
    return () => wrap.removeEventListener("wheel", wheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc and Delete belong to the chart first while it's in the middle of something
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      const st = v.current;
      const dr = useDraw.getState();
      if (e.key === "Escape") {
        if (st.draft || st.measure || st.drag) {
          st.draft = null;
          st.measure = null;
          st.zoom = null;
          st.drag = null;
        } else if (dr.selected) selectDrawing(null);
        else if (dr.tool !== "cursor") setTool("cursor");
        else return;
        e.stopImmediatePropagation();
        e.preventDefault();
        invalidate(true);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && dr.selected) {
        removeDrawing(INSTRUMENTS[useDesk.getState().settings.sym].under, dr.selected);
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [invalidate]);

  /* ---------- dragging order and alert lines ---------- */
  const startDrag = (e: React.PointerEvent, l: Line) => {
    if (!l.drag) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    v.current.lineDrag = { id: l.id, price: l.price };
  };
  const moveDrag = (e: React.PointerEvent, l: Line) => {
    const st = v.current;
    if (st.lineDrag?.id !== l.id || !st.frame) return;
    e.stopPropagation();
    const { y } = local(e);
    st.lineDrag.price = snap(sym, K.pOfY(st.frame, y));
    st.inside = false;
    invalidate(true);
  };
  const endDrag = (e: React.PointerEvent, l: Line) => {
    const st = v.current;
    if (st.lineDrag?.id !== l.id) return;
    e.stopPropagation();
    const p = st.lineDrag.price;
    st.lineDrag = null;
    if (p !== l.price) {
      if (l.order) moveOrder(l.order.id, p);
      if (l.alertId) moveAlert(l.alertId, p);
      if (l.draft === "entry") setTicket(useDesk.getState().ticket.type === "LMT" ? { limit: p } : { stop: p });
      if (l.draft === "stop" || l.draft === "target" || l.draft === "target2") setExitPrice(l.draft, p);
    }
    invalidate(true);
  };

  const hasStop = orders.some((o) => o.role === "stop");
  const hasTarget = orders.some((o) => o.role === "target");
  const textCommit = () => {
    if (!text) return;
    const value = text.value.trim();
    if (value) {
      if (text.id) replaceDrawing(inst.under, { id: text.id, kind: "text", a: text.at, text: value });
      else finish({ id: drawId(), kind: "text", a: text.at, text: value });
    }
    setText(null);
  };

  return (
    <div className={s.chart} data-chart="" data-viewer={viewer ? "" : undefined}>
      <ChartBar viewer={viewer} frozen={until !== undefined} />
      <div className={s.chartBody} data-chart-body="">
        {rail && !viewer && (
          <ToolRail
            count={drawCount}
            onClear={() => {
              const n = clearDrawings(inst.under);
              if (n) useDesk.setState({ toasts: [...useDesk.getState().toasts, { id: `c${Date.now()}`, tone: "plain", title: `Removed ${n} drawing${n > 1 ? "s" : ""}`, at: Date.now() }] });
            }}
          />
        )}
        <div
          ref={wrapRef}
          className={`${s.plot} ${pick && !viewer ? s.picking : ""} ${tool !== "cursor" && !viewer ? s.drawing : ""}`}
          data-plot=""
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={onLeave}
          onDoubleClick={onDouble}
          onContextMenu={onMenu}
        >
          <canvas ref={baseRef} className={s.canvas} aria-label={`${inst.code} chart`} role="img" />
          <canvas ref={overRef} className={s.canvas} aria-hidden="true" />

          <div className={s.legend}>
            <button
              type="button"
              className={s.railToggle}
              aria-pressed={rail}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => toggleDraw("rail")}
              title={rail ? "Hide drawing tools" : "Drawing tools"}
              aria-label="Drawing tools"
            >
              <ToolsIcon />
            </button>
            <div className={s.legRow}>
            <span className={s.legName}>
              {inst.name} · {tf}
            </span>
            <span className={s.legTime} ref={(el) => void (leg.current.time = el)} />
            <span>
              <i>O</i>
              <b ref={(el) => void (leg.current.o = el)} />
            </span>
            <span>
              <i>H</i>
              <b ref={(el) => void (leg.current.h = el)} />
            </span>
            <span>
              <i>L</i>
              <b ref={(el) => void (leg.current.l = el)} />
            </span>
            <span>
              <i>C</i>
              <b className={s.legC} ref={(el) => void (leg.current.c = el)} />
            </span>
            <span>
              <i>V</i>
              <b ref={(el) => void (leg.current.v = el)} />
            </span>
            </div>
          </div>

          {/* rules first, tags after: every tag sits above every line */}
          {lines.map((l) => (
            <div
              key={`r${l.id}`}
              ref={(el) => {
                if (el) ruleEls.current.set(l.id, el);
                else ruleEls.current.delete(l.id);
              }}
              className={`${s.line} ${s[`line_${l.kind}`]} ${l.drag ? s.lineDrag : ""}`}
              onPointerDown={(e) => startDrag(e, l)}
              onPointerMove={(e) => moveDrag(e, l)}
              onPointerUp={(e) => endDrag(e, l)}
              style={{ right: K.AXIS_W } as CSSProperties}
            >
              <span className={s.lineRule} />
            </div>
          ))}
          {lines.map((l) => (
            <div
              key={l.id}
              ref={(el) => {
                if (el) lineEls.current.set(l.id, el);
                else lineEls.current.delete(l.id);
              }}
              className={`${s.line} ${s.lineTagRow} ${s[`line_${l.kind}`]} ${l.drag ? s.lineDrag : ""}`}
              onPointerDown={(e) => startDrag(e, l)}
              onPointerMove={(e) => moveDrag(e, l)}
              onPointerUp={(e) => endDrag(e, l)}
              style={{ right: K.AXIS_W } as CSSProperties}
            >
              <span className={s.lineLink} aria-hidden="true" />
              <span className={s.lineTag}>
                {l.kind === "alert" && (
                  <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M4 11V7a4 4 0 0 1 8 0v4l1.3 1.5H2.7z M6.5 14h3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                  </svg>
                )}
                <b>{l.title}</b>
                <span data-px>{fmt(l.price)}</span>
                {l.value && (
                  <em data-val className={l.tone === "pos" ? s.pos : s.neg}>
                    {l.value}
                  </em>
                )}
                {l.kind === "entry" && l.id === "entry" && <em data-live className={s.liveVal} />}
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
                {(l.order || l.alertId || l.draft) && (
                  <button
                    type="button"
                    className={s.lineX}
                    aria-label={l.draft === "entry" ? "Back to a market order" : l.draft ? `Remove the ${l.draft === "stop" ? "stop loss" : l.draft === "target2" ? "second target" : "take profit"}` : `Cancel ${l.title}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => {
                      if (l.draft === "entry") setTicket({ type: "MKT" });
                      else if (l.draft === "stop") setSettings({ stopOn: false });
                      else if (l.draft === "target") setSettings({ targetOn: false });
                      else if (l.draft === "target2") setSettings({ target2On: false });
                      else if (l.order) cancelOrder(l.order.id);
                      else removeAlert(l.alertId!);
                    }}
                  >
                    ×
                  </button>
                )}
                {l.moved && l.order && (
                  <span className={s.lineNotify} onPointerDown={(e) => e.stopPropagation()}>
                    <button type="button" onClick={() => notifyMove(l.order!.id)} title={`Tell members the ${l.kind} is now ${fmt(l.price)}`}>
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M4 11V7.2a4 4 0 0 1 8 0V11l1.3 1.5H2.7z" />
                        <path d="M6.6 14.2a1.6 1.6 0 0 0 2.8 0" />
                      </svg>
                      Notify
                    </button>
                    <button type="button" className={s.lineNotifyX} onClick={() => dismissMove(l.order!.id)} aria-label="Don't notify this move">
                      ×
                    </button>
                  </span>
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
            style={{ right: K.AXIS_W, opacity: 0 }}
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
          {text && (
            <input
              ref={textRef}
              className={s.textEdit}
              style={{ transform: `translate(${text.x}px, ${text.y - 13}px)` }}
              value={text.value}
              placeholder="Text"
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => setText({ ...text, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") textCommit();
                if (e.key === "Escape") setText(null);
              }}
              onBlur={() => {
                if (document.activeElement !== textRef.current) textCommit();
              }}
            />
          )}
          {selId && selKind && !viewer && (
            <DrawPop
              ref={popRef}
              kind={selKind}
              hidden={selHidden}
              colors={selPos ? { text: selPos[0], up: selPos[1], down: selPos[2], defUp: v.current.ink?.pos ?? "#4DA3FF", defDown: v.current.ink?.neg ?? "#FF2EC4" } : undefined}
              onHide={() => toggleHidden(inst.under, selId)}
              onDelete={() => removeDrawing(inst.under, selId)}
              onColor={(which, hex) => restyle(inst.under, selId, { [which]: hex })}
              onLimit={() => {
                const d = useDraw.getState().byUnder[inst.under].find((x) => x.id === selId);
                if (d && (d.kind === "long" || d.kind === "short")) {
                  ticketFromPosition(d.kind === "long" ? 1 : -1, d.a.p, d.stop, d.target);
                  selectDrawing(null);
                }
              }}
            />
          )}
          <Toaster inline />
          {menu && (
            <ChartMenu
              at={menu}
              sym={sym}
              drawings={drawCount}
              onClose={() => setMenu(null)}
              onCopy={() => {
                void navigator.clipboard?.writeText(fmt(menu.price).replace(/,/g, ""));
                useDesk.setState({ toasts: [...useDesk.getState().toasts, { id: `p${Date.now()}`, tone: "plain", title: `Copied ${fmt(menu.price)}`, at: Date.now() }] });
              }}
              onOrder={(side, kind) => {
                const ds = useDesk.getState();
                const qty = ds.settings.qty[sym];
                if (kind === "LMT") placeOrder({ sym, side, qty, type: "LMT", limit: menu.price, bracket: true });
                else placeOrder({ sym, side, qty, type: "STP", stop: menu.price, bracket: true });
              }}
              onAlert={() => addAlert(sym, menu.price)}
              onHLine={() => {
                v.current.selX = menu.x;
                addDrawing(inst.under, { id: drawId(), kind: "hline", a: { t: menu.t, p: menu.price } });
              }}
              onVLine={() => {
                v.current.selY = menu.y;
                addDrawing(inst.under, { id: drawId(), kind: "vline", a: { t: menu.t, p: menu.price } });
              }}
              onClear={() => clearDrawings(inst.under)}
              onReset={resetView}
              onSettings={() => setSettingsOpen(true)}
            />
          )}
          {settings && <ChartSettings onClose={() => setSettingsOpen(false)} />}
        </div>
      </div>
      <div className={s.ranges}>
        <div className={s.rangeList} role="group" aria-label="Date range">
          {RANGES.map((r) => (
            <button key={r.id} type="button" aria-pressed={range === r.id} title={r.label} onClick={() => applyRange(r.id)}>
              {r.id}
            </button>
          ))}
        </div>
        <div className={s.scaleBtns}>
          <button
            type="button"
            aria-pressed={auto}
            title="Auto scale: fit price to the bars on screen"
            onClick={() => {
              const st = v.current;
              st.auto = !st.auto;
              if (st.auto) st.fitted = false;
              setAuto(st.auto);
              invalidate(true);
            }}
          >
            A
          </button>
          <button type="button" aria-pressed={log} title="Logarithmic scale" onClick={() => setSettings({ chart: { ...chartCfg, log: !log } })}>
            L
          </button>
          <button type="button" aria-pressed={settings} title="Chart settings" aria-label="Chart settings" onClick={() => setSettingsOpen((x) => !x)}>
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.25" />
              <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
