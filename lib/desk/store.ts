import { create } from "zustand";
import { INSTRUMENTS, SYMS, snap, tickValue, type Sym, type Timeframe } from "./instruments";
import { Market, nyClock, type Quote } from "./market";

/**
 * Yazan's paper account: one account, four contracts, every order type the
 * desk offers. Orders fill against the simulated tape; trades, notes and
 * settings persist in the browser until the Supabase backend is connected
 * (see supabase/schema.sql for the tables this maps onto).
 */

export type Side = 1 | -1;
export type OrderType = "MKT" | "LMT" | "STP" | "STPLMT" | "TRAIL";
export type Role = "entry" | "stop" | "target" | "exit";

export type Order = {
  id: string;
  sym: Sym;
  side: Side;
  qty: number;
  type: OrderType;
  role: Role;
  limit?: number;
  stop?: number;
  trail?: number; // points
  anchor?: number;
  oco?: string;
  reduceOnly?: boolean;
  attach?: { stopTicks?: number; targetTicks?: number };
  at: number;
};

export type Fill = { id: string; orderId: string; sym: Sym; side: Side; qty: number; price: number; at: number; tradeId: string; role: Role; pnl: number };
export type Position = { sym: Sym; qty: number; avg: number; openedAt: number; tradeId: string };
export type Trade = {
  id: string;
  sym: Sym;
  side: "LONG" | "SHORT";
  openedAt: number;
  closedAt?: number;
  qty: number;
  entryQty: number;
  entryValue: number;
  exitQty: number;
  exitValue: number;
  pnl: number;
  risk?: number;
};
export type Phase = "before" | "during" | "after";
export type Note = { id: string; tradeId: string | null; sym: Sym; phase: Phase; text: string; at: number; edits: { text: string; at: number }[] };
export type Toast = { id: string; tone: "pos" | "neg" | "plain"; title: string; body?: string; at: number };

export type Settings = {
  sym: Sym;
  tf: Timeframe;
  qty: Record<Sym, number>;
  sizes: { mini: number[]; micro: number[] };
  stopOn: boolean;
  targetOn: boolean;
  stopTicks: Record<Sym, number>;
  targetTicks: Record<Sym, number>;
  hotkeys: boolean;
  panels: { instant: boolean; pnl: boolean; markets: boolean };
  blotter: boolean;
};

export type Ticket = { type: OrderType; limit: number | null; stop: number | null; trail: number };

export type DeskState = {
  ready: boolean;
  quotes: Record<Sym, Quote>;
  positions: Partial<Record<Sym, Position>>;
  orders: Order[];
  fills: Fill[];
  trades: Trade[];
  notes: Note[];
  start: number;
  settings: Settings;
  ticket: Ticket;
  armedUntil: number;
  toasts: Toast[];
  thread: string | null;
  pick: null | "limit" | "stop";
  shortcuts: boolean;
  /** the notes pop-up; always starts closed */
  notesOpen: boolean;
  tick: number;
};

export const ACCOUNT = { name: "Paper-01", start: 100_000 };
const KEY = "altron-desk-v1";
const ARM_MS = 60_000;

const DEFAULT_SETTINGS: Settings = {
  sym: "NQ",
  tf: "1m",
  qty: { NQ: 1, ES: 1, MNQ: 5, MES: 5 },
  sizes: { mini: [1, 2, 3, 5], micro: [1, 5, 10, 20] },
  stopOn: true,
  targetOn: true,
  stopTicks: { NQ: 80, ES: 24, MNQ: 80, MES: 24 },
  targetTicks: { NQ: 160, ES: 48, MNQ: 160, MES: 48 },
  hotkeys: true,
  panels: { instant: false, pnl: false, markets: false },
  blotter: true,
};

const blankQuote = (): Quote => ({ last: 0, bid: 0, ask: 0, prev: 0, hi: 0, lo: 0, dir: 0, at: 0 });

export const useDesk = create<DeskState>(() => ({
  ready: false,
  quotes: { NQ: blankQuote(), ES: blankQuote(), MNQ: blankQuote(), MES: blankQuote() },
  positions: {},
  orders: [],
  fills: [],
  trades: [],
  notes: [],
  start: ACCOUNT.start,
  settings: DEFAULT_SETTINGS,
  ticket: { type: "MKT", limit: null, stop: null, trail: 20 },
  armedUntil: 0,
  toasts: [],
  thread: null,
  pick: null,
  shortcuts: false,
  notesOpen: false,
  tick: 0,
}));

let market: Market | null = null;
export const getMarket = () => market;

let seq = 0;
const uid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;
const set = useDesk.setState;
const get = useDesk.getState;

/* ------------------------------------------------------------------ */
/* quotes                                                              */
/* ------------------------------------------------------------------ */

function readQuotes(): Record<Sym, Quote> {
  const nq = market!.quote("NQ");
  const es = market!.quote("ES");
  return { NQ: nq, MNQ: nq, ES: es, MES: es };
}

export function mid(sym: Sym): number {
  return get().quotes[sym].last;
}

/* ------------------------------------------------------------------ */
/* fills, positions and trades                                         */
/* ------------------------------------------------------------------ */

type Draft = Pick<DeskState, "positions" | "orders" | "fills" | "trades" | "notes" | "toasts">;

function draft(): Draft {
  const s = get();
  return { positions: { ...s.positions }, orders: s.orders.slice(), fills: s.fills.slice(), trades: s.trades.slice(), notes: s.notes.slice(), toasts: s.toasts.slice() };
}

function fmtPx(p: number): string {
  return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtUsd(n: number): string {
  return (n < 0 ? "−" : "+") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pushToast(d: Draft, t: Omit<Toast, "id" | "at">) {
  d.toasts = [...d.toasts.slice(-3), { ...t, id: uid("t"), at: Date.now() }];
}

function openTrade(d: Draft, sym: Sym, side: Side, qty: number, price: number, at: number, riskTicks?: number): Trade {
  const t: Trade = {
    id: uid("T"),
    sym,
    side: side > 0 ? "LONG" : "SHORT",
    openedAt: at,
    qty,
    entryQty: qty,
    entryValue: price * qty,
    exitQty: 0,
    exitValue: 0,
    pnl: 0,
    risk: riskTicks ? riskTicks * tickValue(sym) * qty : undefined,
  };
  d.trades = [...d.trades, t];
  // notes written for the next trade on this market now belong to it
  d.notes = d.notes.map((n) => (n.tradeId === null && n.sym === sym ? { ...n, tradeId: t.id } : n));
  return t;
}

function updateTrade(d: Draft, id: string, fn: (t: Trade) => Trade) {
  d.trades = d.trades.map((t) => (t.id === id ? fn(t) : t));
}

/** Apply one fill to the book. */
function applyFill(d: Draft, o: Order, qty: number, price: number, at: number) {
  const sym = o.sym;
  const inst = INSTRUMENTS[sym];
  const side = o.side;
  let pos = d.positions[sym];
  let tradeId = pos?.tradeId ?? "";
  let pnl = 0;

  if (!pos || pos.qty === 0) {
    const t = openTrade(d, sym, side, qty, price, at, o.attach?.stopTicks);
    tradeId = t.id;
    pos = { sym, qty: side * qty, avg: price, openedAt: at, tradeId };
  } else if (Math.sign(pos.qty) === side) {
    const q = Math.abs(pos.qty);
    pos = { ...pos, qty: pos.qty + side * qty, avg: (pos.avg * q + price * qty) / (q + qty) };
    const size = Math.abs(pos.qty);
    updateTrade(d, pos.tradeId, (t) => ({ ...t, qty: Math.max(t.qty, size), entryQty: t.entryQty + qty, entryValue: t.entryValue + price * qty }));
  } else {
    const dir = Math.sign(pos.qty);
    const q = Math.abs(pos.qty);
    const closing = Math.min(q, qty);
    pnl = (price - pos.avg) * dir * closing * inst.pv;
    updateTrade(d, pos.tradeId, (t) => ({ ...t, pnl: t.pnl + pnl, exitQty: t.exitQty + closing, exitValue: t.exitValue + price * closing }));
    const left = q - closing;
    if (left > 0) {
      pos = { ...pos, qty: dir * left };
    } else {
      updateTrade(d, pos.tradeId, (t) => ({ ...t, closedAt: at }));
      const closed = d.trades.find((t) => t.id === pos!.tradeId)!;
      pushToast(d, {
        tone: closed.pnl >= 0 ? "pos" : "neg",
        title: `Closed ${closed.side.toLowerCase()} ${inst.code}`,
        body: `${fmtUsd(closed.pnl)}${closed.risk ? ` · ${(closed.pnl / closed.risk >= 0 ? "+" : "−") + Math.abs(closed.pnl / closed.risk).toFixed(1)}R` : ""}`,
      });
      // brackets and exits for a flat market are done
      d.orders = d.orders.filter((x) => !(x.sym === sym && x.reduceOnly));
      pos = undefined;
      const flip = qty - closing;
      if (flip > 0) {
        const t = openTrade(d, sym, side, flip, price, at);
        pos = { sym, qty: side * flip, avg: price, openedAt: at, tradeId: t.id };
      }
    }
  }

  d.positions[sym] = pos;
  if (!pos) delete d.positions[sym];
  d.fills = [...d.fills.slice(-400), { id: uid("F"), orderId: o.id, sym, side, qty, price, at, tradeId, role: o.role, pnl }];

  const verb = side > 0 ? "Bought" : "Sold";
  const why = o.role === "stop" ? "Stop" : o.role === "target" ? "Target" : o.type === "MKT" ? "Market" : o.type === "LMT" ? "Limit" : o.type === "TRAIL" ? "Trailing stop" : "Stop";
  pushToast(d, { tone: "plain", title: `${verb} ${qty} ${inst.code}`, body: `@ ${fmtPx(price)} · ${why}` });

  // entry with a bracket: set the stop and target around the fill
  if (pos && o.attach && Math.sign(pos.qty) === side) {
    const existing = d.orders.some((x) => x.sym === sym && (x.role === "stop" || x.role === "target"));
    if (!existing) {
      const oco = uid("O");
      const size = Math.abs(pos.qty);
      if (o.attach.stopTicks) {
        d.orders.push({ id: uid("o"), sym, side: (-side) as Side, qty: size, type: "STP", role: "stop", stop: snap(sym, price - side * o.attach.stopTicks * inst.tick), oco, reduceOnly: true, at });
      }
      if (o.attach.targetTicks) {
        d.orders.push({ id: uid("o"), sym, side: (-side) as Side, qty: size, type: "LMT", role: "target", limit: snap(sym, price + side * o.attach.targetTicks * inst.tick), oco, reduceOnly: true, at });
      }
    }
  }
  // keep protective orders the same size as the position
  if (pos) {
    const size = Math.abs(pos.qty);
    d.orders = d.orders.map((x) => (x.sym === sym && x.reduceOnly && (x.role === "stop" || x.role === "target") ? { ...x, qty: size } : x));
  }
}

/** Check working orders on one market against its quote. */
function work(d: Draft, sym: Sym, q: Quote, at: number) {
  let guard = 0;
  let again = true;
  while (again && guard++ < 8) {
    again = false;
    for (const o of d.orders.filter((x) => x.sym === sym)) {
      if (!d.orders.includes(o)) continue;
      const pos = d.positions[sym];
      if (o.reduceOnly && (!pos || Math.sign(pos.qty) === o.side)) {
        d.orders = d.orders.filter((x) => x !== o);
        continue;
      }
      let px: number | null = null;
      if (o.type === "LMT") {
        if (o.side > 0 && q.ask <= o.limit!) px = Math.min(o.limit!, q.ask);
        if (o.side < 0 && q.bid >= o.limit!) px = Math.max(o.limit!, q.bid);
      } else if (o.type === "STP") {
        if (o.side > 0 && q.ask >= o.stop!) px = q.ask;
        if (o.side < 0 && q.bid <= o.stop!) px = q.bid;
      } else if (o.type === "STPLMT") {
        const hit = o.side > 0 ? q.ask >= o.stop! : q.bid <= o.stop!;
        if (hit) {
          const lim: Order = { ...o, type: "LMT" };
          d.orders = d.orders.map((x) => (x === o ? lim : x));
          again = true;
          continue;
        }
      } else if (o.type === "TRAIL") {
        const ref = o.side < 0 ? q.bid : q.ask;
        const anchor = o.anchor === undefined ? ref : o.side < 0 ? Math.max(o.anchor, ref) : Math.min(o.anchor, ref);
        const stop = snap(sym, anchor - (o.side < 0 ? 1 : -1) * o.trail!);
        if ((o.side < 0 && q.bid <= stop) || (o.side > 0 && q.ask >= stop)) px = ref;
        else if (anchor !== o.anchor || stop !== o.stop) d.orders = d.orders.map((x) => (x === o ? { ...o, anchor, stop } : x));
      }
      if (px === null) continue;
      const qty = o.reduceOnly && pos ? Math.min(o.qty, Math.abs(pos.qty)) : o.qty;
      d.orders = d.orders.filter((x) => x !== o && !(o.oco && x.oco === o.oco));
      applyFill(d, o, qty, px, at);
      again = true;
      break;
    }
  }
}

function commit(d: Draft) {
  set({ positions: d.positions, orders: d.orders, fills: d.fills, trades: d.trades, notes: d.notes, toasts: d.toasts });
}

/* ------------------------------------------------------------------ */
/* public actions                                                      */
/* ------------------------------------------------------------------ */

export type OrderInput = {
  sym: Sym;
  side: Side;
  qty: number;
  type: OrderType;
  limit?: number;
  stop?: number;
  trail?: number;
  bracket?: boolean;
};

export function placeOrder(input: OrderInput): void {
  const s = get();
  if (!s.ready || input.qty <= 0) return;
  const at = Date.now();
  const { settings } = s;
  const attach = input.bracket
    ? { stopTicks: settings.stopOn ? settings.stopTicks[input.sym] : undefined, targetTicks: settings.targetOn ? settings.targetTicks[input.sym] : undefined }
    : undefined;
  const o: Order = {
    id: uid("o"),
    sym: input.sym,
    side: input.side,
    qty: Math.round(input.qty),
    type: input.type,
    role: "entry",
    limit: input.limit !== undefined ? snap(input.sym, input.limit) : undefined,
    stop: input.stop !== undefined ? snap(input.sym, input.stop) : undefined,
    trail: input.trail,
    attach: attach && (attach.stopTicks || attach.targetTicks) ? attach : undefined,
    at,
  };
  const d = draft();
  const q = s.quotes[input.sym];
  if (o.type === "MKT") {
    applyFill(d, o, o.qty, o.side > 0 ? q.ask : q.bid, at);
  } else {
    d.orders = [...d.orders, o];
    work(d, input.sym, q, at);
    if (d.orders.includes(o)) pushToast(d, { tone: "plain", title: `Working ${o.side > 0 ? "buy" : "sell"} ${o.qty} ${INSTRUMENTS[o.sym].code}`, body: describe(o) });
  }
  commit(d);
}

export function describe(o: Order): string {
  if (o.type === "LMT") return `Limit ${fmtPx(o.limit!)}`;
  if (o.type === "STP") return `Stop ${fmtPx(o.stop!)}`;
  if (o.type === "STPLMT") return `Stop ${fmtPx(o.stop!)} · limit ${fmtPx(o.limit!)}`;
  if (o.type === "TRAIL") return `Trail ${o.trail} pts${o.stop ? ` · ${fmtPx(o.stop)}` : ""}`;
  return "Market";
}

/** One click, no confirmation: used by the instant panel and hotkeys. */
export function instant(sym: Sym, side: Side, qty: number, bracket = false) {
  placeOrder({ sym, side, qty, type: "MKT", bracket });
}

/** Close part of the open position (sells a long, buys back a short). */
export function closePercent(sym: Sym, pct: number) {
  const pos = get().positions[sym];
  if (!pos) return;
  const size = Math.abs(pos.qty);
  const qty = pct >= 1 ? size : Math.max(1, Math.min(size, Math.round(size * pct)));
  placeOrder({ sym, side: (-Math.sign(pos.qty)) as Side, qty, type: "MKT" });
}

export function flatten(sym?: Sym) {
  const syms = sym ? [sym] : SYMS;
  set({ orders: get().orders.filter((o) => !syms.includes(o.sym)) });
  for (const x of syms) if (get().positions[x]) closePercent(x, 1);
}

export function cancelOrder(id: string) {
  set({ orders: get().orders.filter((o) => o.id !== id) });
}

export function cancelAll(sym?: Sym) {
  set({ orders: get().orders.filter((o) => (sym ? o.sym !== sym : false) || (o.reduceOnly ?? false)) });
}

/** Drag a line on the chart: move a working order or a bracket leg. */
export function moveOrder(id: string, price: number) {
  const d = draft();
  d.orders = d.orders.map((o) => {
    if (o.id !== id) return o;
    const p = snap(o.sym, price);
    if (o.type === "LMT") return { ...o, limit: p };
    if (o.type === "STP" || o.type === "TRAIL") return { ...o, stop: p, trail: o.type === "TRAIL" ? Math.abs((o.anchor ?? p) - p) : o.trail };
    if (o.type === "STPLMT") {
      const gap = (o.limit ?? p) - (o.stop ?? p);
      return { ...o, stop: p, limit: p + gap };
    }
    return o;
  });
  const o = d.orders.find((x) => x.id === id);
  if (o) work(d, o.sym, get().quotes[o.sym], Date.now());
  commit(d);
}

/** Add a stop or target to an open position that doesn't have one. */
export function addBracket(sym: Sym, role: "stop" | "target", price?: number) {
  const s = get();
  const pos = s.positions[sym];
  if (!pos || s.orders.some((o) => o.sym === sym && o.role === role)) return;
  const dir = Math.sign(pos.qty);
  const inst = INSTRUMENTS[sym];
  const ticks = role === "stop" ? s.settings.stopTicks[sym] : s.settings.targetTicks[sym];
  const p = snap(sym, price ?? (role === "stop" ? pos.avg - dir * ticks * inst.tick : pos.avg + dir * ticks * inst.tick));
  const sibling = s.orders.find((o) => o.sym === sym && (o.role === "stop" || o.role === "target"));
  const oco = sibling?.oco ?? uid("O");
  const o: Order = {
    id: uid("o"),
    sym,
    side: (-dir) as Side,
    qty: Math.abs(pos.qty),
    type: role === "stop" ? "STP" : "LMT",
    role,
    stop: role === "stop" ? p : undefined,
    limit: role === "target" ? p : undefined,
    oco,
    reduceOnly: true,
    at: Date.now(),
  };
  const d = draft();
  d.orders = [...d.orders.map((x) => (x === sibling ? { ...x, oco } : x)), o];
  // a stop added later still defines the trade's risk
  if (role === "stop") updateTrade(d, pos.tradeId, (t) => (t.risk ? t : { ...t, risk: Math.abs(pos.avg - p) * inst.pv * Math.abs(pos.qty) }));
  commit(d);
}

/* notes ------------------------------------------------------------- */

export function postNote(text: string, sym: Sym, tradeId: string | null, phase: Phase) {
  const body = text.trim();
  if (!body) return;
  set({ notes: [...get().notes, { id: uid("n"), tradeId, sym, phase, text: body, at: Date.now(), edits: [] }] });
}

export function editNote(id: string, text: string) {
  const body = text.trim();
  if (!body) return;
  set({
    notes: get().notes.map((n) => (n.id === id && n.text !== body ? { ...n, text: body, edits: [...n.edits, { text: n.text, at: Date.now() }] } : n)),
  });
}

/* settings, lock, ui ------------------------------------------------ */

export function setSettings(patch: Partial<Settings>) {
  set({ settings: { ...get().settings, ...patch } });
}
export function setTicket(patch: Partial<Ticket>) {
  set({ ticket: { ...get().ticket, ...patch } });
}
export function selectSym(sym: Sym) {
  set({ settings: { ...get().settings, sym }, ticket: { ...get().ticket, limit: null, stop: null }, pick: null });
}
export function arm() {
  set({ armedUntil: Date.now() + ARM_MS });
}
export function disarm() {
  set({ armedUntil: 0 });
}
/** Any instant action keeps the panel armed a little longer. */
export function keepArmed() {
  if (get().armedUntil > Date.now()) set({ armedUntil: Date.now() + ARM_MS });
}
export function dismissToast(id: string) {
  set({ toasts: get().toasts.filter((t) => t.id !== id) });
}
export function setThread(id: string | null) {
  set({ thread: id });
}
export function setPick(p: DeskState["pick"]) {
  set({ pick: p });
}
export function togglePanel(which: "instant" | "pnl" | "markets", open?: boolean) {
  const s = get().settings;
  set({ settings: { ...s, panels: { ...s.panels, [which]: open ?? !s.panels[which] } } });
}
export function toggleNotes(open?: boolean) {
  set({ notesOpen: open ?? !get().notesOpen });
}
export function toggleBlotter(open?: boolean) {
  const s = get().settings;
  set({ settings: { ...s, blotter: open ?? !s.blotter } });
}
export function showShortcuts(v: boolean) {
  set({ shortcuts: v });
}

export function resetPaper() {
  set({ positions: {}, orders: [], fills: [], trades: [], notes: [], thread: null });
}

/* ------------------------------------------------------------------ */
/* derived numbers                                                     */
/* ------------------------------------------------------------------ */

export function openPnl(s: Pick<DeskState, "positions" | "quotes">, sym?: Sym): number {
  let sum = 0;
  for (const x of sym ? [sym] : SYMS) {
    const p = s.positions[x];
    if (!p) continue;
    const q = s.quotes[x];
    const mark = p.qty > 0 ? q.bid : q.ask;
    sum += (mark - p.avg) * p.qty * INSTRUMENTS[x].pv;
  }
  return sum;
}

/** The futures day: it opens with Globex at 6:00 PM New York time. */
export function dayStart(now = Date.now()): number {
  const { min } = nyClock(now);
  const midnight = Math.floor(now / 60000) * 60000 - min * 60000;
  return min >= 18 * 60 ? midnight + 18 * 3_600_000 : midnight - 6 * 3_600_000;
}

export function realizedSince(trades: Trade[], since: number): number {
  return trades.reduce((a, t) => a + ((t.closedAt ?? Date.now()) >= since ? t.pnl : 0), 0);
}

/* ------------------------------------------------------------------ */
/* boot, tape and persistence                                          */
/* ------------------------------------------------------------------ */

type Saved = Pick<DeskState, "positions" | "orders" | "fills" | "trades" | "notes" | "settings"> & { prices?: { NQ: number; ES: number }; v: 1 };

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Saved;
    return s.v === 1 ? s : null;
  } catch {
    return null;
  }
}

function save() {
  const s = get();
  if (!s.ready || !market) return;
  const data: Saved = {
    v: 1,
    positions: s.positions,
    orders: s.orders,
    fills: s.fills.slice(-400),
    trades: s.trades.slice(-300),
    notes: s.notes,
    settings: s.settings,
    prices: { NQ: market.quote("NQ").last, ES: market.quote("ES").last },
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage full or blocked */
  }
}

/** A first visit gets a short morning on the book, so nothing reads empty. */
function seed(): Partial<DeskState> {
  const m = market!;
  const now = Date.now();
  const d: Draft = { positions: {}, orders: [], fills: [], trades: [], notes: [], toasts: [] };
  type Bars = ReturnType<Market["bars"]>;

  const trade = (sym: Sym, side: Side, qty: number, entryAgo: number, outcome: "win" | "loss" | "open", notes: [Phase, string, number][]) => {
    const inst = INSTRUMENTS[sym];
    const bars: Bars = m.bars(inst.under, 1);
    const n = bars.length;
    const stopTicks = DEFAULT_SETTINGS.stopTicks[sym];
    const targetTicks = DEFAULT_SETTINGS.targetTicks[sym];
    let ei = n - 1 - entryAgo;
    let stopT = stopTicks;
    let tgtT = targetTicks;
    if (outcome === "open") {
      // a recent entry that is a little in profit now, with the stop tucked past the
      // swing since (never tighter than the default) and the target at least 2R out,
      // so nothing on the tape has touched the bracket yet
      const last = bars[n - 1].c;
      let best = -1;
      let score = Infinity;
      for (let i = n - 45; i < n - 12; i++) {
        const e = snap(sym, (bars[i].h + bars[i].l) / 2);
        let hi = -Infinity;
        let lo = Infinity;
        for (let j = i; j < n; j++) {
          hi = Math.max(hi, bars[j].h);
          lo = Math.min(lo, bars[j].l);
        }
        const against = side > 0 ? e - lo : hi - e;
        const toward = side > 0 ? hi - e : e - lo;
        const stopD = Math.max(stopTicks * inst.tick, against + 6 * inst.tick);
        const tgtD = Math.max(2 * stopD, toward + 8 * inst.tick);
        const gain = (last - e) * side;
        if (gain <= 0) continue;
        const sc = Math.abs(gain / stopD - 0.4) + Math.abs(n - i - 25) / 120;
        if (sc < score) {
          score = sc;
          best = i;
          stopT = Math.round(stopD / inst.tick);
          tgtT = Math.round(tgtD / inst.tick);
        }
      }
      ei = best >= 0 ? best : n - 3;
    }
    const eb = bars[ei];
    const entry = snap(sym, (eb.h + eb.l) / 2);
    const tAt = eb.t + 20_000;
    // a "before" note's number is how many minutes ahead of the entry it was written
    for (const [phase, text, ahead] of notes) if (phase === "before") d.notes.push({ id: uid("n"), tradeId: null, sym, phase, text, at: tAt - ahead * 60_000, edits: [] });
    const o: Order = { id: uid("o"), sym, side, qty, type: "MKT", role: "entry", attach: { stopTicks: stopT, targetTicks: tgtT }, at: tAt };
    applyFill(d, o, qty, entry, tAt);
    const tradeId = d.positions[sym]!.tradeId;
    let closeAt = now;
    if (outcome !== "open") {
      const goal = outcome === "win" ? entry + side * targetTicks * inst.tick * 0.8 : entry - side * stopTicks * inst.tick;
      let xi = Math.min(n - 2, ei + 30);
      for (let i = ei + 1; i < Math.min(n - 2, ei + 90); i++) {
        const reached = outcome === "win" ? (side > 0 ? bars[i].h >= goal : bars[i].l <= goal) : side > 0 ? bars[i].l <= goal : bars[i].h >= goal;
        if (reached) {
          xi = i;
          break;
        }
      }
      const xb = bars[xi];
      const reachedGoal = outcome === "win" ? (side > 0 ? xb.h >= goal : xb.l <= goal) : side > 0 ? xb.l <= goal : xb.h >= goal;
      const exit = snap(sym, reachedGoal ? goal : xb.c);
      closeAt = xb.t + 40_000;
      d.orders = d.orders.filter((x) => x.sym !== sym);
      applyFill(d, { ...o, id: uid("o"), side: (-side) as Side, role: outcome === "win" ? "target" : "stop", attach: undefined }, qty, exit, closeAt);
    }
    const span = Math.max(1, closeAt - tAt);
    for (const [phase, text, frac] of notes) {
      if (phase === "before") continue;
      const when = phase === "after" ? closeAt + 60_000 * frac : tAt + span * frac;
      d.notes.push({ id: uid("n"), tradeId, sym, phase, text, at: Math.min(now - 30_000, when), edits: [] });
    }
  };

  trade("ES", -1, 2, 170, "win", [
    ["before", "Failed auction at the highs. Short back to the mid, out if it reclaims.", 6],
    ["during", "Halfway there. Leaving the stop where it is.", 0.5],
    ["after", "Paid near the mid. Clean.", 1],
  ]);
  trade("NQ", 1, 1, 110, "loss", [
    ["before", "Testing the overnight low from above. Small size.", 3],
    ["after", "Wrong. It never held, and that was the plan if it broke.", 2],
  ]);
  // the open trade goes with the last half hour, so it starts a little in profit
  const nq = m.bars("NQ", 1);
  const up = nq[nq.length - 1].c >= nq[Math.max(0, nq.length - 30)].c;
  trade(
    "NQ",
    up ? 1 : -1,
    2,
    30,
    "open",
    up
      ? [
          ["before", "Reclaim of the overnight high on volume. Wrong below the swing low.", 4],
          ["during", "Holding. Stop stays under the low.", 0.6],
        ]
      : [
          ["before", "Rejected at the overnight high. Short while it stays under, wrong above the swing high.", 4],
          ["during", "Holding. Stop stays over the high.", 0.6],
        ],
  );
  d.notes.sort((a, b) => a.at - b.at);
  return { positions: d.positions, orders: d.orders, fills: d.fills, trades: d.trades, notes: d.notes };
}

let started = false;

export function startDesk() {
  if (started || typeof window === "undefined") return;
  started = true;
  const saved = load();
  market = new Market(saved?.prices);
  const base: Partial<DeskState> = saved
    ? { positions: saved.positions, orders: saved.orders, fills: saved.fills, trades: saved.trades, notes: saved.notes, settings: { ...DEFAULT_SETTINGS, ...saved.settings, panels: { ...DEFAULT_SETTINGS.panels, ...saved.settings?.panels } } }
    : {};
  set({ quotes: readQuotes(), ready: true, ...base });
  if (!saved) set(seed());
  set({ toasts: [] });

  window.setInterval(() => {
    if (!market) return;
    const now = Date.now();
    const moved = market.step(now);
    const s = get();
    const patch: Partial<DeskState> = { tick: s.tick + 1 };
    if (moved) {
      const quotes = readQuotes();
      patch.quotes = quotes;
      if (s.orders.length) {
        const d = draft();
        for (const sym of SYMS) if (d.orders.some((o) => o.sym === sym)) work(d, sym, quotes[sym], now);
        Object.assign(patch, { positions: d.positions, orders: d.orders, fills: d.fills, trades: d.trades, notes: d.notes, toasts: d.toasts });
      }
    }
    if (s.armedUntil && s.armedUntil < now) patch.armedUntil = 0;
    if (s.toasts.length && now - s.toasts[0].at > 4200) patch.toasts = (patch.toasts ?? s.toasts).slice(1);
    set(patch);
  }, 250);

  // persist the book when it changes, and prices now and then
  let timer = 0;
  useDesk.subscribe((s, prev) => {
    if (s.positions === prev.positions && s.orders === prev.orders && s.trades === prev.trades && s.notes === prev.notes && s.settings === prev.settings) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(save, 400);
  });
  window.setInterval(save, 15_000);
  window.addEventListener("pagehide", save);
}
