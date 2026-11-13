import { create } from "zustand";
import { INSTRUMENTS, SYMS, TIMEFRAMES, snap, tickValue, type Sym, type Timeframe } from "./instruments";
import { Market, nyClock, sessionDay, type Band, type Pin, type Pins, type Quote } from "./market";

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
  /** the bracket set around the fill: a distance in ticks, or an exact price typed on the ticket */
  attach?: { stopTicks?: number; targetTicks?: number; stopPx?: number; targetPx?: number };
  /** members are told when this order is placed and when it fills */
  notify?: { note?: string };
  /** a stop or target: the price members were last told, and a price he chose not to announce */
  told?: number;
  quiet?: number;
  /** placed by the follow agent for this trade of Yazan's */
  follows?: string;
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
  /** opened with a notification: its exits are announced too */
  notify?: boolean;
  /** where the stop and target last sat, kept for the record once the trade is over */
  stop?: number;
  target?: number;
  /** the owner's book: the trade of Yazan's this one follows */
  follows?: string;
};
export type Phase = "before" | "during" | "after";
export type Note = { id: string; tradeId: string | null; sym: Sym; phase: Phase; text: string; at: number; edits: { text: string; at: number }[] };
export type Toast = { id: string; tone: "pos" | "neg" | "plain"; title: string; body?: string; at: number };

/** What members are sent: entries, working orders, fills, moved stops and targets, exits. */
export type NoticeKind = "entry" | "order" | "fill" | "stop" | "target" | "exit";
export type Notice = {
  id: string;
  kind: NoticeKind;
  sym: Sym;
  at: number;
  side?: Side;
  qty?: number;
  price?: number;
  type?: OrderType;
  stop?: number;
  target?: number;
  /** a moved stop or target: what members were told before */
  was?: number;
  pnl?: number;
  why?: string;
  note?: string;
  tradeId?: string;
};

/** Units an exit can be typed in or read back as. */
export type ExitUnit = "price" | "ticks" | "usd" | "pts";
export const EXIT_UNITS: { id: ExitUnit; label: string }[] = [
  { id: "price", label: "Price" },
  { id: "ticks", label: "Ticks" },
  { id: "usd", label: "USD" },
  { id: "pts", label: "Points" },
];

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
  panels: { pnl: boolean; markets: boolean };
  /** the blotter is showing; its height and the right column's width are in `layout` */
  blotter: boolean;
  layout: { blot: number; right: number };
  chart: { volume: boolean; fills: boolean; zone: boolean; grid: boolean; log: boolean };
  /** each exit is typed in one unit and read back in another, as on TradingView */
  exitUnits: { stop: [ExitUnit, ExitUnit]; target: [ExitUnit, ExitUnit] };
};

export type Alert = { id: string; sym: Sym; price: number; above: boolean; at: number };

export type Ticket = {
  type: OrderType;
  /** the side the big button sends; picked with the Sell and Buy tiles */
  side: Side;
  limit: number | null;
  stop: number | null;
  trail: number;
  /** exits typed or dragged to an exact price; null follows the tick distance in settings */
  stopPx: number | null;
  targetPx: number | null;
  /** the market those exact prices were set on */
  pxSym: Sym | null;
};

/** Whose book is on the desk: Yazan's (members read it too), or the owner's own. */
export type Seat = "trader" | "owner";
/** Everything that belongs to one account. */
export type Book = Pick<DeskState, "positions" | "orders" | "fills" | "trades" | "notes" | "alerts" | "settings" | "ticket" | "start">;

export type DeskState = {
  ready: boolean;
  seat: Seat;
  /** the book that isn't seated: Yazan's while the owner's is up, so both keep working */
  other: Book | null;
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
  /** what members have been sent, newest last */
  notices: Notice[];
  /** the chart fills the window; the order column and blotter step aside */
  full: boolean;
  alerts: Alert[];
  /** a deal button is hovered: the chart previews that side's bracket */
  preview: 0 | 1 | -1;
  tick: number;
};

export const ACCOUNT = { name: "Paper-01", start: 100_000 };
export const OWNER_ACCOUNT = { name: "Account 1", start: 150_000 };
const KEY = "altron-desk-v1";
const OWNER_KEY = "altron-desk-owner-v1";
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
  panels: { pnl: false, markets: false },
  blotter: true,
  layout: { blot: 158, right: 300 },
  chart: { volume: true, fills: true, zone: true, grid: true, log: false },
  exitUnits: { stop: ["price", "usd"], target: ["price", "usd"] },
};

const blankQuote = (): Quote => ({ last: 0, bid: 0, ask: 0, prev: 0, hi: 0, lo: 0, dir: 0, at: 0 });

export const useDesk = create<DeskState>(() => ({
  ready: false,
  seat: "trader",
  other: null,
  quotes: { NQ: blankQuote(), ES: blankQuote(), MNQ: blankQuote(), MES: blankQuote() },
  positions: {},
  orders: [],
  fills: [],
  trades: [],
  notes: [],
  start: ACCOUNT.start,
  settings: DEFAULT_SETTINGS,
  ticket: { type: "MKT", side: 1, limit: null, stop: null, trail: 20, stopPx: null, targetPx: null, pxSym: null },
  armedUntil: 0,
  toasts: [],
  thread: null,
  pick: null,
  shortcuts: false,
  notices: [],
  full: false,
  alerts: [],
  preview: 0,
  tick: 0,
}));

let market: Market | null = null;
export const getMarket = () => market;

let seq = 0;
const fmtPrice = (p: number) => p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

type Draft = Pick<DeskState, "positions" | "orders" | "fills" | "trades" | "notes" | "toasts" | "notices"> & {
  /** whose book this is: only Yazan's tells members anything */
  who?: Seat;
  /** the book that isn't on screen fills without pop-ups */
  mute?: boolean;
};

function draft(): Draft {
  const s = get();
  return { positions: { ...s.positions }, orders: s.orders.slice(), fills: s.fills.slice(), trades: s.trades.slice(), notes: s.notes.slice(), toasts: s.toasts.slice(), notices: s.notices.slice(), who: s.seat };
}

/** Yazan's book, wherever it sits: on the desk for him and for members, set aside while the owner's is up. */
export function hisBook(s: DeskState): Book {
  return s.seat === "owner" && s.other ? s.other : s;
}
/** "his" is Yazan's book; "mine" is whichever book is seated. */
export function bookOf(s: DeskState, who: "his" | "mine"): Book {
  return who === "his" ? hisBook(s) : s;
}

function fmtPx(p: number): string {
  return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtUsd(n: number): string {
  return (n < 0 ? "−" : "+") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pushToast(d: Draft, t: Omit<Toast, "id" | "at">) {
  if (d.mute) return;
  d.toasts = [...d.toasts.slice(-3), { ...t, id: uid("t"), at: Date.now() }];
}

/** Keeps a trade's record of where its stop and target sit. */
function syncExits(d: Draft, sym: Sym) {
  const pos = d.positions[sym];
  if (!pos) return;
  const stop = d.orders.find((o) => o.sym === sym && o.role === "stop")?.stop;
  const target = d.orders.find((o) => o.sym === sym && o.role === "target")?.limit;
  d.trades = d.trades.map((t) => (t.id === pos.tradeId && ((stop !== undefined && t.stop !== stop) || (target !== undefined && t.target !== target)) ? { ...t, stop: stop ?? t.stop, target: target ?? t.target } : t));
}

/** Sends a notice to members (kept here until the backend relays it) and says so on the desk. */
function publish(d: Draft, n: Omit<Notice, "id">) {
  if (d.who === "owner") return;
  const full: Notice = { ...n, id: uid("N") };
  d.notices = [...d.notices.slice(-299), full];
  const { head } = noticeText(full);
  pushToast(d, { tone: "plain", title: "Members notified", body: head });
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

  const wasTrade = pos?.tradeId;
  let closedQty = 0;
  if (!pos || pos.qty === 0) {
    const riskTicks = o.attach?.stopPx !== undefined ? Math.abs(price - o.attach.stopPx) / inst.tick : o.attach?.stopTicks;
    const t = openTrade(d, sym, side, qty, price, at, riskTicks);
    if (o.follows) updateTrade(d, t.id, (x) => ({ ...x, follows: o.follows }));
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
    closedQty = closing;
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
      const stopAt = o.attach.stopPx ?? (o.attach.stopTicks ? price - side * o.attach.stopTicks * inst.tick : undefined);
      const targetAt = o.attach.targetPx ?? (o.attach.targetTicks ? price + side * o.attach.targetTicks * inst.tick : undefined);
      if (stopAt !== undefined) {
        const p = snap(sym, stopAt);
        d.orders.push({ id: uid("o"), sym, side: (-side) as Side, qty: size, type: "STP", role: "stop", stop: p, oco, reduceOnly: true, at, told: p });
      }
      if (targetAt !== undefined) {
        const p = snap(sym, targetAt);
        d.orders.push({ id: uid("o"), sym, side: (-side) as Side, qty: size, type: "LMT", role: "target", limit: p, oco, reduceOnly: true, at, told: p });
      }
    }
  }
  // keep protective orders the same size as the position
  if (pos) {
    const size = Math.abs(pos.qty);
    d.orders = d.orders.map((x) => (x.sym === sym && x.reduceOnly && (x.role === "stop" || x.role === "target") ? { ...x, qty: size } : x));
  }

  syncExits(d, sym);

  // members hear about an exit from a trade they were told about
  if (closedQty && wasTrade && d.trades.find((t) => t.id === wasTrade)?.notify) {
    publish(d, { kind: "exit", sym, at, side, qty: closedQty, price, pnl, why: o.role === "stop" ? "stop" : o.role === "target" ? "target" : undefined, tradeId: wasTrade });
  }
  // and about an entry that was sent with a notification
  if (o.notify && pos && Math.sign(pos.qty) === side) {
    const stopO = d.orders.find((x) => x.sym === sym && x.role === "stop");
    const tgtO = d.orders.find((x) => x.sym === sym && x.role === "target");
    updateTrade(d, pos.tradeId, (t) => ({ ...t, notify: true }));
    publish(d, {
      kind: o.type === "MKT" ? "entry" : "fill",
      sym,
      at,
      side,
      qty,
      price,
      type: o.type,
      stop: stopO?.stop,
      target: tgtO?.limit,
      note: o.type === "MKT" ? o.notify.note : undefined,
      tradeId: pos.tradeId,
    });
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

/** True when two lists hold the same items in the same order. */
function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function sameBook(a: Draft["positions"], b: Draft["positions"]): boolean {
  if (a === b) return true;
  const ka = Object.keys(a) as Sym[];
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => a[k] === b[k]);
}

/** Only the parts of a draft that actually changed, so a quiet tick re-renders nothing. */
function changes(d: Draft, s: Draft): Partial<Draft> {
  const out: Partial<Draft> = {};
  if (!sameBook(d.positions, s.positions)) out.positions = d.positions;
  if (!sameList(d.orders, s.orders)) out.orders = d.orders;
  if (!sameList(d.fills, s.fills)) out.fills = d.fills;
  if (!sameList(d.trades, s.trades)) out.trades = d.trades;
  if (!sameList(d.notes, s.notes)) out.notes = d.notes;
  if (!sameList(d.toasts, s.toasts)) out.toasts = d.toasts;
  if (!sameList(d.notices, s.notices)) out.notices = d.notices;
  return out;
}

function commit(d: Draft) {
  set({ positions: d.positions, orders: d.orders, fills: d.fills, trades: d.trades, notes: d.notes, toasts: d.toasts, notices: d.notices });
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
  /** the ticket's exits, exact prices or tick distances; otherwise the settings' distances */
  exits?: Order["attach"];
  notify?: { note?: string };
  /** the follow agent's order, and the trade of Yazan's it follows */
  follows?: string;
};

export function placeOrder(input: OrderInput): void {
  const s = get();
  if (!s.ready || input.qty <= 0) return;
  const at = Date.now();
  const { settings } = s;
  const attach = input.exits
    ? input.exits
    : input.bracket
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
    attach: attach && (attach.stopTicks || attach.targetTicks || attach.stopPx !== undefined || attach.targetPx !== undefined) ? attach : undefined,
    notify: input.notify && s.seat === "trader" ? { note: input.notify.note?.trim() || undefined } : undefined,
    follows: input.follows,
    at,
  };
  const d = draft();
  const q = s.quotes[input.sym];
  if (o.type === "MKT") {
    applyFill(d, o, o.qty, o.side > 0 ? q.ask : q.bid, at);
  } else {
    d.orders = [...d.orders, o];
    if (o.notify) {
      const px = o.type === "LMT" ? o.limit : o.stop;
      const tk = INSTRUMENTS[o.sym].tick;
      const exit = (abs: number | undefined, ticks: number | undefined, dir: number) => (abs !== undefined ? snap(o.sym, abs) : ticks && px !== undefined ? snap(o.sym, px + dir * o.side * ticks * tk) : undefined);
      publish(d, { kind: "order", sym: o.sym, at, side: o.side, qty: o.qty, price: px, type: o.type, stop: exit(o.attach?.stopPx, o.attach?.stopTicks, -1), target: exit(o.attach?.targetPx, o.attach?.targetTicks, 1), note: o.notify.note });
    }
    work(d, input.sym, q, at);
    if (d.orders.includes(o)) pushToast(d, { tone: "plain", title: `Working ${o.side > 0 ? "buy" : "sell"} ${o.qty} ${INSTRUMENTS[o.sym].code}`, body: describe(o) });
  }
  commit(d);
}

/**
 * A fill at a known price and time: what the follow agent's orders did while this browser
 * wasn't looking. Goes on the seated book without a pop-up.
 */
export function fillAt(input: { sym: Sym; side: Side; qty: number; price: number; at: number; role?: Role; follows?: string; exits?: Order["attach"] }): void {
  if (!get().ready || input.qty <= 0) return;
  const o: Order = { id: uid("o"), sym: input.sym, side: input.side, qty: Math.round(input.qty), type: "LMT", role: input.role ?? "entry", limit: input.price, attach: input.exits, follows: input.follows, at: input.at };
  const d = draft();
  d.mute = true;
  applyFill(d, o, o.qty, snap(input.sym, input.price), input.at);
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
  if (o) {
    syncExits(d, o.sym);
    work(d, o.sym, get().quotes[o.sym], Date.now());
  }
  commit(d);
}

/** Tell members where a stop or target now sits. */
export function notifyMove(id: string) {
  const s = get();
  const o = s.orders.find((x) => x.id === id);
  if (!o || (o.role !== "stop" && o.role !== "target")) return;
  const price = o.role === "stop" ? o.stop : o.limit;
  if (price === undefined) return;
  const d = draft();
  d.orders = d.orders.map((x) => (x.id === id ? { ...x, told: price, quiet: undefined } : x));
  publish(d, { kind: o.role, sym: o.sym, at: Date.now(), price, was: o.told, side: o.side, qty: o.qty, tradeId: s.positions[o.sym]?.tradeId });
  commit(d);
}

/** Keep a move to himself; the button comes back if the line moves again. */
export function dismissMove(id: string) {
  set({ orders: get().orders.map((x) => (x.id === id ? { ...x, quiet: x.role === "stop" ? x.stop : x.limit } : x)) });
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
  syncExits(d, sym);
  commit(d);
}

/* notices: what members read --------------------------------------- */

const NY_TIME = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", second: "2-digit" });
/** New York wall-clock time to the second, as members see it. */
export const noticeTime = (ms: number) => `${NY_TIME.format(ms)} ET`;

/** "1 NQ mini", "5 MNQ micros". */
export function sizeWords(sym: Sym, qty: number): string {
  const inst = INSTRUMENTS[sym];
  const root = inst.code.replace(/[FGHJKMNQUVXZ]\d$/, "");
  return `${qty} ${root} ${inst.micro ? "micro" : "mini"}${qty === 1 ? "" : "s"}`;
}

export function noticeText(n: Notice): { head: string; body: string } {
  const px = (p?: number) => (p === undefined ? "" : fmtPx(p));
  const root = INSTRUMENTS[n.sym].code.replace(/[FGHJKMNQUVXZ]\d$/, "");
  const size = sizeWords(n.sym, n.qty ?? 1);
  const exits = [n.stop !== undefined ? `Stop ${px(n.stop)}` : "", n.target !== undefined ? `Target ${px(n.target)}` : ""].filter(Boolean).join(" · ");
  switch (n.kind) {
    case "entry":
      return { head: `${n.side! > 0 ? "Bought" : "Sold"} ${size} @ ${px(n.price)}`, body: exits || "No stop or target set" };
    case "fill":
      return { head: `Filled: ${n.side! > 0 ? "bought" : "sold"} ${size} @ ${px(n.price)}`, body: exits || "No stop or target set" };
    case "order":
      return { head: `${n.side! > 0 ? "Buy" : "Sell"} ${n.type === "STP" ? "stop" : "limit"} ${size} @ ${px(n.price)}`, body: exits ? `${exits} · working` : "Working" };
    case "stop":
    case "target":
      return { head: n.was === undefined ? `${root} ${n.kind} set at ${px(n.price)}` : `${root} ${n.kind} moved to ${px(n.price)}`, body: n.was === undefined ? "" : `Was ${px(n.was)}` };
    case "exit":
      return { head: `Closed ${n.side! < 0 ? "long" : "short"} ${size} @ ${px(n.price)}`, body: `${fmtUsd(n.pnl ?? 0)}${n.why ? ` · ${n.why} hit` : ""}` };
  }
}

/* the ticket -------------------------------------------------------- */

/** Where the ticket's order would come in: the typed price, or the touch for a market order. */
export function ticketEntry(s: Pick<DeskState, "ticket" | "quotes">, sym: Sym): number {
  const t = s.ticket;
  const q = s.quotes[sym];
  if (t.type === "LMT" && t.limit !== null) return t.limit;
  if (t.type === "STP" && t.stop !== null) return t.stop;
  return t.side > 0 ? q.ask : q.bid;
}

const usesExact = (s: Pick<DeskState, "ticket" | "settings">, sym: Sym, which: "stop" | "target") =>
  s.ticket.pxSym === sym && s.settings.exitUnits[which][0] === "price" && (which === "stop" ? s.ticket.stopPx : s.ticket.targetPx) !== null;

/** The ticket's stop and target as prices: exact where typed, otherwise their distance from the entry. */
export function ticketExits(s: Pick<DeskState, "ticket" | "quotes" | "settings">, sym: Sym): { stop: number | null; target: number | null } {
  const st = s.settings;
  const tk = INSTRUMENTS[sym].tick;
  const entry = ticketEntry(s, sym);
  const side = s.ticket.side;
  const stop = !st.stopOn ? null : usesExact(s, sym, "stop") ? s.ticket.stopPx! : snap(sym, entry - side * st.stopTicks[sym] * tk);
  const target = !st.targetOn ? null : usesExact(s, sym, "target") ? s.ticket.targetPx! : snap(sym, entry + side * st.targetTicks[sym] * tk);
  return { stop, target };
}

/** What a ticket order carries for its bracket. */
function ticketAttach(s: DeskState, sym: Sym): NonNullable<Order["attach"]> {
  const st = s.settings;
  const out: NonNullable<Order["attach"]> = {};
  if (st.stopOn) {
    if (usesExact(s, sym, "stop")) out.stopPx = s.ticket.stopPx!;
    else out.stopTicks = st.stopTicks[sym];
  }
  if (st.targetOn) {
    if (usesExact(s, sym, "target")) out.targetPx = s.ticket.targetPx!;
    else out.targetTicks = st.targetTicks[sym];
  }
  return out;
}

/** Why the ticket can't send right now, or null. */
export function ticketProblem(s: Pick<DeskState, "ticket" | "quotes" | "settings">, sym: Sym): string | null {
  const t = s.ticket;
  const q = s.quotes[sym];
  if (!q.last) return "Waiting for the market";
  if (t.type === "LMT" && t.limit === null) return "Set a limit price";
  if (t.type === "STP") {
    if (t.stop === null) return "Set a stop price";
    if (t.side > 0 && t.stop <= q.ask) return "A buy stop goes above the ask";
    if (t.side < 0 && t.stop >= q.bid) return "A sell stop goes below the bid";
  }
  const entry = ticketEntry(s, sym);
  const { stop, target } = ticketExits(s, sym);
  if (stop !== null && (entry - stop) * t.side <= 0) return `The stop must be ${t.side > 0 ? "below" : "above"} the entry`;
  if (target !== null && (target - entry) * t.side <= 0) return `The target must be ${t.side > 0 ? "above" : "below"} the entry`;
  return null;
}

/** Sets an exit from a price: dragged on the chart or typed in price. */
export function setExitPrice(which: "stop" | "target", price: number) {
  const s = get();
  const sym = s.settings.sym;
  const tk = INSTRUMENTS[sym].tick;
  const entry = ticketEntry(s, sym);
  const dir = which === "stop" ? -s.ticket.side : s.ticket.side;
  let p = snap(sym, price);
  if ((p - entry) * dir < tk) p = snap(sym, entry + dir * tk); // stays on its own side, a tick away at least
  if (s.settings.exitUnits[which][0] === "price") {
    const key = which === "stop" ? "stopPx" : "targetPx";
    const other = which === "stop" ? "targetPx" : "stopPx";
    setTicket({ [key]: p, pxSym: sym, ...(s.ticket.pxSym !== sym ? { [other]: null } : {}) });
  } else {
    setExitTicks(which, Math.abs(p - entry) / tk);
  }
}

function setExitTicks(which: "stop" | "target", ticks: number) {
  const st = get().settings;
  const key = which === "stop" ? "stopTicks" : "targetTicks";
  setSettings({ [key]: { ...st[key], [st.sym]: Math.max(1, Math.round(ticks)) } });
}

/** Sets an exit from a number typed in one of the units. */
export function setExitValue(which: "stop" | "target", unit: ExitUnit, value: number) {
  if (!Number.isFinite(value)) return;
  const s = get();
  const sym = s.settings.sym;
  const tk = INSTRUMENTS[sym].tick;
  if (unit === "price") return setExitPrice(which, value);
  const ticks = unit === "ticks" ? value : unit === "pts" ? value / tk : value / (tickValue(sym) * s.settings.qty[sym]);
  setExitTicks(which, Math.abs(ticks));
}

/** Picks the units an exit is typed in and read back as. Switching keeps the exit where it is. */
export function setExitUnits(which: "stop" | "target", units: [ExitUnit, ExitUnit]) {
  const s = get();
  const sym = s.settings.sym;
  const was = s.settings.exitUnits[which][0];
  if (was === "price" && units[0] !== "price" && usesExact(s, sym, which)) {
    const exact = (which === "stop" ? s.ticket.stopPx : s.ticket.targetPx)!;
    setExitTicks(which, Math.abs(exact - ticketEntry(s, sym)) / INSTRUMENTS[sym].tick);
  }
  if (units[0] === "price" && was !== "price") setTicket({ [which === "stop" ? "stopPx" : "targetPx"]: null });
  setSettings({ exitUnits: { ...get().settings.exitUnits, [which]: units } });
}

/** A long or short position drawn on the chart becomes the ticket's limit order, exits and all. */
export function ticketFromPosition(side: Side, entry: number, stop: number, target: number) {
  const s = get();
  const sym = s.settings.sym;
  const u = s.settings.exitUnits;
  setSettings({
    stopOn: true,
    targetOn: true,
    exitUnits: { stop: u.stop[0] === "price" ? u.stop : ["price", u.stop[0]], target: u.target[0] === "price" ? u.target : ["price", u.target[0]] },
  });
  setPick(null);
  setTicket({ type: "LMT", side, limit: snap(sym, entry), stopPx: snap(sym, stop), targetPx: snap(sym, target), pxSym: sym });
}

/** Sends what's on the ticket, with a notification to members when asked. */
export function sendTicket(notify?: { note?: string }) {
  const s = get();
  const sym = s.settings.sym;
  if (ticketProblem(s, sym)) return;
  const t = s.ticket;
  const base = { sym, side: t.side, qty: s.settings.qty[sym], exits: ticketAttach(s, sym), notify };
  if (t.type === "LMT") placeOrder({ ...base, type: "LMT", limit: t.limit! });
  else if (t.type === "STP") placeOrder({ ...base, type: "STP", stop: t.stop! });
  else placeOrder({ ...base, type: "MKT" });
  // the next order starts from market, its exits back on their distances
  set({ ticket: { ...get().ticket, type: "MKT", stopPx: null, targetPx: null, pxSym: null }, preview: 0 });
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
export function togglePanel(which: "pnl" | "markets", open?: boolean) {
  const s = get().settings;
  set({ settings: { ...s, panels: { ...s.panels, [which]: open ?? !s.panels[which] } } });
}
/* ------------------------------------------------------------------ */
/* price alerts                                                        */
/* ------------------------------------------------------------------ */

export function addAlert(sym: Sym, price: number) {
  const p = snap(sym, price);
  const last = get().quotes[sym].last;
  if (p === last) return;
  const a: Alert = { id: uid("a"), sym, price: p, above: p > last, at: Date.now() };
  set({ alerts: [...get().alerts, a], toasts: [...get().toasts, { id: uid("t"), tone: "plain", title: `Alert set at ${fmtPrice(p)}`, body: `${INSTRUMENTS[sym].code} · ${p > last ? "crossing up" : "crossing down"}`, at: Date.now() }] });
}
export function moveAlert(id: string, price: number) {
  const s = get();
  set({
    alerts: s.alerts.map((a) => {
      if (a.id !== id) return a;
      const p = snap(a.sym, price);
      return { ...a, price: p, above: p > s.quotes[a.sym].last };
    }),
  });
}
export function removeAlert(id: string) {
  set({ alerts: get().alerts.filter((a) => a.id !== id) });
}

let audio: AudioContext | null = null;
/** A soft two-note chime; quiet enough to live with. */
function chime() {
  try {
    audio = audio ?? new AudioContext();
    const t = audio.currentTime;
    [880, 1320].forEach((f, i) => {
      const o = audio!.createOscillator();
      const g = audio!.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t + i * 0.12);
      g.gain.linearRampToValueAtTime(0.06, t + i * 0.12 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 0.5);
      o.connect(g).connect(audio!.destination);
      o.start(t + i * 0.12);
      o.stop(t + i * 0.12 + 0.55);
    });
  } catch {
    /* no audio */
  }
}

export function setPreview(side: 0 | 1 | -1) {
  if (get().preview !== side) set({ preview: side });
}

export function toggleFull(on?: boolean) {
  set({ full: on ?? !get().full });
}
export function toggleBlotter(open?: boolean) {
  const s = get().settings;
  const next = open ?? !s.blotter;
  // coming back from out of sight: a working height, not one that hides the chart
  const blot = next && !s.blotter && s.layout.blot >= 10000 ? 158 : s.layout.blot;
  set({ settings: { ...s, blotter: next, layout: { ...s.layout, blot } } });
}
export function showShortcuts(v: boolean) {
  set({ shortcuts: v });
}

export function resetPaper() {
  // the owner's book resets on its own; members' notices are Yazan's
  if (get().seat === "owner") set({ positions: {}, orders: [], fills: [], trades: [], notes: [], thread: null });
  else set({ positions: {}, orders: [], fills: [], trades: [], notes: [], notices: [], thread: null });
}

/* ------------------------------------------------------------------ */
/* two books, one desk                                                 */
/* ------------------------------------------------------------------ */

const pickBook = (s: DeskState): Book => ({ positions: s.positions, orders: s.orders, fills: s.fills, trades: s.trades, notes: s.notes, alerts: s.alerts, settings: s.settings, ticket: s.ticket, start: s.start });

const BLANK_TICKET: Ticket = { type: "MKT", side: 1, limit: null, stop: null, trail: 20, stopPx: null, targetPx: null, pxSym: null };

function ownerBook(): Book {
  let saved: Partial<Book> | null = null;
  try {
    const raw = JSON.parse(localStorage.getItem(OWNER_KEY) ?? "null") as (Partial<Book> & { v?: number }) | null;
    if (raw?.v === 1) saved = raw;
  } catch {
    /* nothing saved */
  }
  const base: Settings = { ...DEFAULT_SETTINGS, sym: "MNQ", qty: { NQ: 1, ES: 1, MNQ: 4, MES: 4 }, layout: { ...DEFAULT_SETTINGS.layout, right: 340 } };
  return {
    positions: saved?.positions ?? {},
    orders: saved?.orders ?? [],
    fills: saved?.fills ?? [],
    trades: saved?.trades ?? [],
    notes: saved?.notes ?? [],
    alerts: saved?.alerts ?? [],
    start: saved?.start ?? OWNER_ACCOUNT.start,
    ticket: BLANK_TICKET,
    settings: saved?.settings
      ? {
          ...base,
          ...saved.settings,
          tf: TIMEFRAMES.some((x) => x.id === saved!.settings!.tf) ? saved.settings.tf : base.tf,
          panels: { pnl: false, markets: !!saved.settings.panels?.markets },
          layout: { ...base.layout, ...saved.settings.layout },
          chart: { ...base.chart, ...saved.settings.chart },
          exitUnits: { ...base.exitUnits, ...saved.settings.exitUnits },
        }
      : base,
  };
}

/** Put one account's book on the desk. The other keeps working behind it. */
export function sit(seat: Seat) {
  const s = get();
  if (!s.ready || s.seat === seat) return;
  const next = s.other ?? (seat === "owner" ? ownerBook() : null);
  if (!next) return;
  set({ ...next, other: pickBook(s), seat, armedUntil: 0, pick: null, preview: 0, thread: null, full: false, toasts: [] });
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

type Saved = Pick<DeskState, "positions" | "orders" | "fills" | "trades" | "notes" | "settings"> & { alerts?: Alert[]; notices?: Notice[] } & { prices?: { NQ: number; ES: number }; archive?: number; v: 1 };

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
  const his = hisBook(s);
  const data: Saved = {
    v: 1,
    positions: his.positions,
    orders: his.orders,
    fills: his.fills.slice(-400),
    trades: his.trades.slice(-300),
    notes: his.notes,
    alerts: his.alerts,
    notices: s.notices.slice(-300),
    settings: his.settings,
    prices: { NQ: market.quote("NQ").last, ES: market.quote("ES").last },
    archive: archived,
  };
  const mine = s.seat === "owner" ? pickBook(s) : s.other;
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    if (mine) localStorage.setItem(OWNER_KEY, JSON.stringify({ v: 1, positions: mine.positions, orders: mine.orders, fills: mine.fills.slice(-400), trades: mine.trades.slice(-300), notes: mine.notes, alerts: mine.alerts, settings: mine.settings, start: mine.start }));
  } catch {
    /* storage full or blocked */
  }
}

/** A first visit gets a short morning on the book, so nothing reads empty. */
function seed(): Partial<DeskState> {
  const m = market!;
  const now = Date.now();
  const d: Draft = { positions: {}, orders: [], fills: [], trades: [], notes: [], toasts: [], notices: [] };
  type Bars = ReturnType<Market["bars"]>;

  const trade = (sym: Sym, side: Side, qty: number, entryAgo: number, outcome: "win" | "loss" | "open", notes: [Phase, string, number][]) => {
    const inst = INSTRUMENTS[sym];
    const bars: Bars = m.bars(inst.under, 60);
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

/**
 * The simulated history is generated fresh on each visit; these pins make it pass
 * through every fill on the book, and keep each closed trade between its stop and
 * target until it ended, so a past trade replays on the chart the way it happened.
 */
function pinsOf(trades: Trade[], fills: Fill[]): Pins {
  const at: Partial<Record<"NQ" | "ES", Pin[]>> = {};
  const bands: Partial<Record<"NQ" | "ES", Band[]>> = {};
  for (const f of fills) (at[INSTRUMENTS[f.sym].under] ??= []).push({ t: f.at, p: f.price });
  for (const t of trades) {
    if (!t.closedAt || (t.stop === undefined && t.target === undefined)) continue;
    const long = t.side === "LONG";
    const lo = long ? (t.stop ?? -Infinity) : (t.target ?? -Infinity);
    const hi = long ? (t.target ?? Infinity) : (t.stop ?? Infinity);
    (bands[INSTRUMENTS[t.sym].under] ??= []).push({
      from: t.openedAt,
      to: t.closedAt,
      lo,
      hi,
    });
  }
  return { at, bands };
}

/** Bumped when the archive below changes, so a book gets it once. */
const ARCHIVE = 1;
let archived = 0;

/**
 * Ten closed trades from the sessions before today, read off the tape as it was
 * generated, so the record has some depth. Added once to any book.
 */
function archive(): Partial<DeskState> | null {
  const m = market!;
  const s = get();
  const d: Draft = {
    positions: s.positions,
    orders: s.orders,
    fills: s.fills.slice(),
    trades: s.trades.slice(),
    notes: s.notes.slice(),
    toasts: [],
    notices: s.notices,
  };
  const today = sessionDay(Date.now());
  type Want = "win" | "loss" | "up" | "down";
  // days back, New York minute of the day, market, size, how it went, notes
  const plan: [number, number, Sym, number, Want, string?, string?][] = [
    [1, 605, "NQ", 1, "win", "Opening drive holding above the overnight high. Long the first pullback.", "Paid at the target. Let it work."],
    [1, 820, "ES", 2, "loss", "Fading the push into the afternoon. Tight.", "Stopped. The push had more in it."],
    [2, 588, "NQ", 2, "win", "Gap and go. Long over the open print, wrong back in the gap."],
    [2, 680, "ES", 1, "up", undefined, "Took it off before lunch. Flat tape, small gain."],
    [3, 630, "ES", 2, "win", "Back to the mid after the morning flush."],
    [3, 855, "NQ", 1, "loss", "Breakdown of the afternoon range.", "Range held. Out at the stop."],
    [4, 582, "NQ", 1, "win"],
    [4, 860, "ES", 3, "down", "Into the afternoon, small and quick.", "Nothing happened. Scratched it."],
    [5, 612, "ES", 2, "win", "Retest of yesterday's value area high."],
    [5, 750, "NQ", 1, "loss"],
  ];
  const days = new Map<"NQ" | "ES", { keys: number[]; bars: ReturnType<Market["bars"]> }>();
  const dayList = (under: "NQ" | "ES") => {
    let hit = days.get(under);
    if (!hit) {
      const bars = m.bars(under, 60);
      const keys: number[] = [];
      for (const b of bars) {
        const k = sessionDay(b.t);
        if (k < today && keys[keys.length - 1] !== k) keys.push(k);
      }
      hit = { keys: keys.reverse(), bars };
      days.set(under, hit);
    }
    return hit;
  };
  const taken = (under: "NQ" | "ES", a: number, b: number) => d.trades.some((t) => INSTRUMENTS[t.sym].under === under && t.openedAt < b + 120_000 && (t.closedAt ?? Infinity) > a - 120_000);
  let made = 0;
  for (const [back, minute, sym, qty, want, before, after] of plan) {
    const inst = INSTRUMENTS[sym];
    const { keys, bars } = dayList(inst.under);
    const key = keys[back - 1];
    if (key === undefined) continue;
    // the regular session of that day, from the planned minute on
    const rth = (t: number) => sessionDay(t) === key && nyClock(t).min >= 570 && nyClock(t).min < 945;
    const start = bars.findIndex((b) => rth(b.t) && nyClock(b.t).min >= minute);
    if (start < 0) continue;
    const stopTicks = DEFAULT_SETTINGS.stopTicks[sym];
    const targetTicks = DEFAULT_SETTINGS.targetTicks[sym];
    let pick: {
      ei: number;
      xi: number;
      side: Side;
      entry: number;
      exit: number;
      stop: number;
      target: number;
      role: Role;
    } | null = null;
    for (let pass = 0; pass < 2 && !pick; pass++)
      for (let off = 0; off < 75 && !pick; off += 3) {
        const ei = start + off;
        if (ei >= bars.length - 60 || !rth(bars[ei].t)) break;
        for (const side of (off % 2 ? [-1, 1] : [1, -1]) as Side[]) {
          const eb = bars[ei];
          const entry = snap(sym, (eb.h + eb.l) / 2);
          const stop = snap(sym, entry - side * stopTicks * inst.tick);
          const target = snap(sym, entry + side * targetTicks * inst.tick);
          let xi = -1;
          let role: Role = "exit";
          for (let i = ei + 1; i < Math.min(bars.length - 2, ei + 150); i++) {
            const b = bars[i];
            const sHit = side > 0 ? b.l <= stop : b.h >= stop;
            const tHit = side > 0 ? b.h >= target : b.l <= target;
            if (sHit && tHit) break;
            if (sHit || tHit) {
              xi = i;
              role = sHit ? "stop" : "target";
              break;
            }
            if ((want === "up" || want === "down") && i === ei + (pass ? 20 : 40)) {
              xi = i;
              break;
            }
          }
          if (xi < 0 || sessionDay(bars[xi].t) !== key) continue;
          const exit = role === "stop" ? stop : role === "target" ? target : bars[xi].c;
          const gain = (exit - entry) * side;
          const ok = want === "win" ? role === "target" : want === "loss" ? role === "stop" : role === "exit" && (pass > 0 || (want === "up" ? gain > 0 : gain < 0)) && Math.abs(gain) < stopTicks * inst.tick * 0.6;
          if (!ok || taken(inst.under, bars[ei].t, bars[xi].t)) continue;
          pick = { ei, xi, side, entry, exit, stop, target, role };
          break;
        }
      }
    if (!pick) continue;
    const { ei, xi, side, entry, exit, stop, target, role } = pick;
    const openAt = bars[ei].t + 20_000;
    const closeAt = bars[xi].t + 30_000;
    const pnl = (exit - entry) * side * qty * inst.pv;
    const id = uid("T");
    d.trades.push({
      id,
      sym,
      side: side > 0 ? "LONG" : "SHORT",
      openedAt: openAt,
      closedAt: closeAt,
      qty,
      entryQty: qty,
      entryValue: entry * qty,
      exitQty: qty,
      exitValue: exit * qty,
      pnl,
      risk: stopTicks * tickValue(sym) * qty,
      stop,
      target,
    });
    d.fills.push({
      id: uid("F"),
      orderId: uid("o"),
      sym,
      side,
      qty,
      price: entry,
      at: openAt,
      tradeId: id,
      role: "entry",
      pnl: 0,
    });
    d.fills.push({
      id: uid("F"),
      orderId: uid("o"),
      sym,
      side: -side as Side,
      qty,
      price: exit,
      at: closeAt,
      tradeId: id,
      role,
      pnl,
    });
    if (before)
      d.notes.push({
        id: uid("n"),
        tradeId: id,
        sym,
        phase: "before",
        text: before,
        at: openAt - 3 * 60_000,
        edits: [],
      });
    if (after)
      d.notes.push({
        id: uid("n"),
        tradeId: id,
        sym,
        phase: "after",
        text: after,
        at: closeAt + 90_000,
        edits: [],
      });
    made++;
  }
  archived = ARCHIVE;
  if (!made) return null;
  d.trades.sort((a, b) => a.openedAt - b.openedAt);
  d.fills.sort((a, b) => a.at - b.at);
  d.notes.sort((a, b) => a.at - b.at);
  return { trades: d.trades, fills: d.fills, notes: d.notes };
}

let started = false;

export function startDesk() {
  if (started || typeof window === "undefined") return;
  started = true;
  const saved = load();
  market = new Market(saved?.prices, saved ? pinsOf(saved.trades ?? [], saved.fills ?? []) : {});
  archived = saved?.archive ?? 0;
  const base: Partial<DeskState> = saved
    ? {
        positions: saved.positions,
        orders: saved.orders,
        fills: saved.fills,
        trades: saved.trades,
        notes: saved.notes,
        alerts: saved.alerts ?? [],
        notices: saved.notices ?? [],
        settings: {
          ...DEFAULT_SETTINGS,
          ...saved.settings,
          tf: TIMEFRAMES.some((x) => x.id === saved.settings?.tf) ? saved.settings.tf : DEFAULT_SETTINGS.tf,
          panels: { pnl: !!saved.settings?.panels?.pnl, markets: !!saved.settings?.panels?.markets },
          layout: { ...DEFAULT_SETTINGS.layout, ...saved.settings?.layout },
          chart: { ...DEFAULT_SETTINGS.chart, ...saved.settings?.chart },
          exitUnits: { ...DEFAULT_SETTINGS.exitUnits, ...saved.settings?.exitUnits },
        },
      }
    : {};
  set({ quotes: readQuotes(), ready: true, ...base });
  if (!saved) set(seed());
  if (archived < ARCHIVE) {
    const more = archive();
    if (more) set(more);
  }
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
        Object.assign(patch, changes(d, s));
      }
      // the book behind the desk fills too, quietly
      const o = s.other;
      if (o?.orders.length) {
        const was: Draft = { positions: o.positions, orders: o.orders, fills: o.fills, trades: o.trades, notes: o.notes, toasts: [], notices: patch.notices ?? s.notices };
        const d: Draft = { positions: { ...o.positions }, orders: o.orders.slice(), fills: o.fills.slice(), trades: o.trades.slice(), notes: o.notes.slice(), toasts: [], notices: was.notices.slice(), who: s.seat === "owner" ? "trader" : "owner", mute: true };
        for (const sym of SYMS) if (d.orders.some((x) => x.sym === sym)) work(d, sym, quotes[sym], now);
        const { notices, toasts: _t, ...book } = changes(d, was);
        void _t;
        if (Object.keys(book).length) patch.other = { ...o, ...book };
        if (notices) patch.notices = notices;
      }
    }
    if (moved && s.alerts.length) {
      const quotes = patch.quotes ?? s.quotes;
      const hit = s.alerts.filter((a) => (a.above ? quotes[a.sym].last >= a.price : quotes[a.sym].last <= a.price));
      if (hit.length) {
        patch.alerts = s.alerts.filter((a) => !hit.includes(a));
        patch.toasts = [
          ...(patch.toasts ?? s.toasts),
          ...hit.map((a) => ({ id: uid("t"), tone: a.above ? ("pos" as const) : ("neg" as const), title: `${INSTRUMENTS[a.sym].code} crossed ${fmtPrice(a.price)}`, body: "Alert", at: now })),
        ];
        chime();
      }
    }
    if (s.armedUntil && s.armedUntil < now) patch.armedUntil = 0;
    if (s.toasts.length && now - s.toasts[0].at > 4200) patch.toasts = (patch.toasts ?? s.toasts).slice(1);
    set(patch);
  }, 250);

  // persist the book soon after it changes (never starved by a busy tape), and prices now and then
  let timer = 0;
  useDesk.subscribe((s, prev) => {
    if (s.positions === prev.positions && s.orders === prev.orders && s.trades === prev.trades && s.notes === prev.notes && s.settings === prev.settings && s.alerts === prev.alerts && s.notices === prev.notices && s.other === prev.other && s.start === prev.start)
      return;
    if (timer) return;
    timer = window.setTimeout(() => {
      timer = 0;
      save();
    }, 400);
  });
  window.setInterval(save, 15_000);
  window.addEventListener("pagehide", save);
}
