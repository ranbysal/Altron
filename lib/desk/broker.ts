import { INSTRUMENTS, SYMS, snap, tickValue, type Sym } from "./instruments";
import type { Quote } from "./market";
import type { Fill, Note, Notice, Order, OrderType, Phase, Position, Role, Seat, Side, Toast, Trade } from "./types";

/*
 * The paper broker: how orders fill against the tape, how positions, trades and brackets
 * follow, and what members are told. Pure functions over a book, so the same rules run in
 * the browser (instantly, for the person trading) and on the server (for real, for everyone).
 */

/** One account's records. */
export type BookData = {
  positions: Partial<Record<Sym, Position>>;
  orders: Order[];
  fills: Fill[];
  trades: Trade[];
  notes: Note[];
  notices: Notice[];
};

export type Draft = BookData & {
  toasts: Toast[];
  /** whose book this is: only Yazan's tells members anything */
  who?: Seat;
  /** the book that isn't on screen fills without pop-ups */
  mute?: boolean;
};

export function draftOf(b: BookData, who: Seat, toasts: Toast[] = [], mute = false): Draft {
  return { positions: { ...b.positions }, orders: b.orders.slice(), fills: b.fills.slice(), trades: b.trades.slice(), notes: b.notes.slice(), notices: b.notices.slice(), toasts: toasts.slice(), who, mute };
}

let seq = 0;
const salt = Math.random().toString(36).slice(2, 5);
/** Ids that don't collide between the browser and the server. */
export const uid = (p: string) => `${p}${Date.now().toString(36)}${salt}${(seq++).toString(36)}`;

export function fmtPx(p: number): string {
  return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function fmtUsd(n: number): string {
  return (n < 0 ? "−" : "+") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function pushToast(d: Draft, t: Omit<Toast, "id" | "at">) {
  if (d.mute) return;
  d.toasts = [...d.toasts.slice(-3), { ...t, id: uid("t"), at: Date.now() }];
}

/** Keeps a trade's record of where its stop and target sit. */
export function syncExits(d: Draft, sym: Sym) {
  const pos = d.positions[sym];
  if (!pos) return;
  const stop = d.orders.find((o) => o.sym === sym && o.role === "stop")?.stop;
  const target = d.orders.find((o) => o.sym === sym && o.role === "target")?.limit;
  d.trades = d.trades.map((t) => (t.id === pos.tradeId && ((stop !== undefined && t.stop !== stop) || (target !== undefined && t.target !== target)) ? { ...t, stop: stop ?? t.stop, target: target ?? t.target } : t));
}

/** Sends a notice to members (kept here until the backend relays it) and says so on the desk. */
export function publish(d: Draft, n: Omit<Notice, "id">) {
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

export function updateTrade(d: Draft, id: string, fn: (t: Trade) => Trade) {
  d.trades = d.trades.map((t) => (t.id === id ? fn(t) : t));
}

/** Apply one fill to the book. */
export function applyFill(d: Draft, o: Order, qty: number, price: number, at: number) {
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
      const target2At = o.attach.target2Px ?? (o.attach.target2Ticks ? price + side * o.attach.target2Ticks * inst.tick : undefined);
      if (stopAt !== undefined) {
        const p = snap(sym, stopAt);
        d.orders.push({ id: uid("o"), sym, side: (-side) as Side, qty: size, type: "STP", role: "stop", stop: p, oco, reduceOnly: true, at, told: p });
      }
      // two targets: half comes off at the first (a fixed size), the rest at the second
      const split = targetAt !== undefined && target2At !== undefined && size >= 2;
      if (targetAt !== undefined) {
        const p = snap(sym, targetAt);
        const q1 = split ? Math.floor(size / 2) : size;
        d.orders.push({ id: uid("o"), sym, side: (-side) as Side, qty: q1, type: "LMT", role: "target", limit: p, oco, reduceOnly: true, fixed: split || undefined, at, told: p });
      }
      if (split) {
        const p = snap(sym, target2At!);
        d.orders.push({ id: uid("o"), sym, side: (-side) as Side, qty: size - Math.floor(size / 2), type: "LMT", role: "target", limit: p, oco, reduceOnly: true, fixed: true, at, told: p, tag: "tp2" });
      }
    }
  }
  // keep protective orders the same size as the position
  if (pos) {
    const size = Math.abs(pos.qty);
    d.orders = d.orders.map((x) => (x.sym === sym && x.reduceOnly && !x.fixed && (x.role === "stop" || x.role === "target") ? { ...x, qty: size } : x));
  }

  syncExits(d, sym);

  // members hear about an exit from a trade they were told about
  if (closedQty && wasTrade && d.trades.find((t) => t.id === wasTrade)?.notify) {
    publish(d, { kind: "exit", sym, at, side, qty: closedQty, price, pnl, why: o.role === "stop" ? "stop" : o.role === "target" ? "target" : undefined, tradeId: wasTrade });
  }
  // and about an entry that was sent with a notification
  if (o.notify && pos && Math.sign(pos.qty) === side) {
    const stopO = d.orders.find((x) => x.sym === sym && x.role === "stop");
    const tgtO = d.orders.find((x) => x.sym === sym && x.role === "target" && x.tag !== "tp2");
    const tgt2 = d.orders.find((x) => x.sym === sym && x.role === "target" && x.tag === "tp2");
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
      target2: tgt2?.limit,
      note: o.type === "MKT" ? o.notify.note : undefined,
      tradeId: pos.tradeId,
    });
  }
}

/** Check working orders on one market against its quote. */
export function work(d: Draft, sym: Sym, q: Quote, at: number) {
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
      // one side of a bracket cancels the others, unless it only takes part of the position off
      const partial = o.reduceOnly && pos && qty < Math.abs(pos.qty);
      d.orders = d.orders.filter((x) => x !== o && (partial || !(o.oco && x.oco === o.oco)));
      applyFill(d, o, qty, px, at);
      again = true;
      break;
    }
  }
}


export function describe(o: Order): string {
  if (o.type === "LMT") return `Limit ${fmtPx(o.limit!)}`;
  if (o.type === "STP") return `Stop ${fmtPx(o.stop!)}`;
  if (o.type === "STPLMT") return `Stop ${fmtPx(o.stop!)} · limit ${fmtPx(o.limit!)}`;
  if (o.type === "TRAIL") return `Trail ${o.trail} pts${o.stop ? ` · ${fmtPx(o.stop)}` : ""}`;
  return "Market";
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
  const exits = [n.stop !== undefined ? `Stop ${px(n.stop)}` : "", n.target !== undefined ? (n.target2 !== undefined ? `Targets ${px(n.target)} and ${px(n.target2)}` : `Target ${px(n.target)}`) : ""].filter(Boolean).join(" · ");
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

/* ------------------------------------------------------------------ */
/* operations: everything a person or the agent can do to a book       */
/* ------------------------------------------------------------------ */

export type OrderInput = {
  sym: Sym;
  side: Side;
  qty: number;
  type: OrderType;
  limit?: number;
  stop?: number;
  trail?: number;
  /** exact prices or tick distances for the bracket set around the fill */
  exits?: Order["attach"];
  notify?: { note?: string };
  /** the follow agent's order, the trade of Yazan's it follows, and what it's for */
  follows?: string;
  tag?: string;
};
export type ExitInput = { sym: Sym; side: Side; qty: number; role: "stop" | "target"; price: number; follows?: string; tag?: string };
export type FillAtInput = { sym: Sym; side: Side; qty: number; price: number; at: number; role?: Role; follows?: string; exits?: Order["attach"] };

export type Op =
  | { op: "place"; id: string; input: OrderInput }
  | { op: "cancel"; id: string }
  | { op: "cancelAll"; sym?: Sym }
  | { op: "move"; id: string; price: number }
  | { op: "notifyMove"; id: string }
  | { op: "dismissMove"; id: string }
  | { op: "addBracket"; id: string; sym: Sym; role: "stop" | "target"; price: number }
  | { op: "close"; sym: Sym; pct: number }
  | { op: "flatten"; sym?: Sym }
  | { op: "exit"; id: string; input: ExitInput }
  | { op: "fillAt"; input: FillAtInput }
  | { op: "note"; id: string; text: string; sym: Sym; tradeId: string | null; phase: Phase }
  | { op: "editNote"; id: string; text: string }
  | { op: "reset" };

export type Ctx = { now: number; quotes: Record<Sym, Quote> };

/** Apply one operation to a draft. Returns false if it didn't apply. */
export function applyOp(d: Draft, x: Op, ctx: Ctx): boolean {
  const at = ctx.now;
  switch (x.op) {
    case "place": {
      const input = x.input;
      if (input.qty <= 0) return false;
      const attach = input.exits;
      const o: Order = {
        id: x.id,
        sym: input.sym,
        side: input.side,
        qty: Math.round(input.qty),
        type: input.type,
        role: "entry",
        limit: input.limit !== undefined ? snap(input.sym, input.limit) : undefined,
        stop: input.stop !== undefined ? snap(input.sym, input.stop) : undefined,
        trail: input.trail,
        attach: attach && (attach.stopTicks || attach.targetTicks || attach.stopPx !== undefined || attach.targetPx !== undefined) ? attach : undefined,
        notify: input.notify && d.who === "trader" ? { note: input.notify.note?.trim() || undefined } : undefined,
        follows: input.follows,
        tag: input.tag,
        at,
      };
      const q = ctx.quotes[input.sym];
      if (!q?.last) return false;
      if (o.type === "MKT") {
        applyFill(d, o, o.qty, o.side > 0 ? q.ask : q.bid, at);
      } else {
        d.orders = [...d.orders, o];
        if (o.notify) {
          const px = o.type === "LMT" ? o.limit : o.stop;
          const tk = INSTRUMENTS[o.sym].tick;
          const exit = (abs: number | undefined, ticks: number | undefined, dir: number) => (abs !== undefined ? snap(o.sym, abs) : ticks && px !== undefined ? snap(o.sym, px + dir * o.side * ticks * tk) : undefined);
          publish(d, { kind: "order", sym: o.sym, at, side: o.side, qty: o.qty, price: px, type: o.type, stop: exit(o.attach?.stopPx, o.attach?.stopTicks, -1), target: exit(o.attach?.targetPx, o.attach?.targetTicks, 1), target2: o.qty >= 2 ? exit(o.attach?.target2Px, o.attach?.target2Ticks, 1) : undefined, note: o.notify.note });
        }
        work(d, input.sym, q, at);
        if (d.orders.includes(o)) pushToast(d, { tone: "plain", title: `Working ${o.side > 0 ? "buy" : "sell"} ${o.qty} ${INSTRUMENTS[o.sym].code}`, body: describe(o) });
      }
      return true;
    }
    case "fillAt": {
      const i = x.input;
      if (i.qty <= 0) return false;
      const o: Order = { id: uid("o"), sym: i.sym, side: i.side, qty: Math.round(i.qty), type: "LMT", role: i.role ?? "entry", limit: i.price, attach: i.exits, follows: i.follows, at: i.at };
      const was = d.mute;
      d.mute = true;
      applyFill(d, o, o.qty, snap(i.sym, i.price), i.at);
      d.mute = was;
      return true;
    }
    case "exit": {
      const i = x.input;
      const pos = d.positions[i.sym];
      if (!pos || i.qty <= 0 || Math.sign(pos.qty) === i.side) return false;
      const p = snap(i.sym, i.price);
      const o: Order = {
        id: x.id,
        sym: i.sym,
        side: i.side,
        qty: Math.min(Math.round(i.qty), Math.abs(pos.qty)),
        type: i.role === "stop" ? "STP" : "LMT",
        role: i.role,
        stop: i.role === "stop" ? p : undefined,
        limit: i.role === "target" ? p : undefined,
        reduceOnly: true,
        fixed: true,
        follows: i.follows,
        tag: i.tag,
        at,
      };
      d.orders = [...d.orders, o];
      syncExits(d, i.sym);
      work(d, i.sym, ctx.quotes[i.sym], at);
      return true;
    }
    case "close": {
      const pos = d.positions[x.sym];
      if (!pos) return false;
      const size = Math.abs(pos.qty);
      const qty = x.pct >= 1 ? size : Math.max(1, Math.min(size, Math.round(size * x.pct)));
      return applyOp(d, { op: "place", id: uid("o"), input: { sym: x.sym, side: (-Math.sign(pos.qty)) as Side, qty, type: "MKT" } }, ctx);
    }
    case "flatten": {
      const syms = x.sym ? [x.sym] : SYMS;
      d.orders = d.orders.filter((o) => !syms.includes(o.sym));
      for (const s of syms) if (d.positions[s]) applyOp(d, { op: "close", sym: s, pct: 1 }, ctx);
      return true;
    }
    case "cancel":
      d.orders = d.orders.filter((o) => o.id !== x.id);
      return true;
    case "cancelAll":
      d.orders = d.orders.filter((o) => (x.sym ? o.sym !== x.sym : false) || (o.reduceOnly ?? false));
      return true;
    case "move": {
      d.orders = d.orders.map((o) => {
        if (o.id !== x.id) return o;
        const p = snap(o.sym, x.price);
        if (o.type === "LMT") return { ...o, limit: p };
        if (o.type === "STP" || o.type === "TRAIL") return { ...o, stop: p, trail: o.type === "TRAIL" ? Math.abs((o.anchor ?? p) - p) : o.trail };
        if (o.type === "STPLMT") {
          const gap = (o.limit ?? p) - (o.stop ?? p);
          return { ...o, stop: p, limit: p + gap };
        }
        return o;
      });
      const o = d.orders.find((y) => y.id === x.id);
      if (o) {
        syncExits(d, o.sym);
        work(d, o.sym, ctx.quotes[o.sym], at);
      }
      return true;
    }
    case "notifyMove": {
      const o = d.orders.find((y) => y.id === x.id);
      if (!o || (o.role !== "stop" && o.role !== "target")) return false;
      const price = o.role === "stop" ? o.stop : o.limit;
      if (price === undefined) return false;
      d.orders = d.orders.map((y) => (y.id === x.id ? { ...y, told: price, quiet: undefined } : y));
      publish(d, { kind: o.role, sym: o.sym, at, price, was: o.told, side: o.side, qty: o.qty, tradeId: d.positions[o.sym]?.tradeId });
      return true;
    }
    case "dismissMove":
      d.orders = d.orders.map((y) => (y.id === x.id ? { ...y, quiet: y.role === "stop" ? y.stop : y.limit } : y));
      return true;
    case "addBracket": {
      const pos = d.positions[x.sym];
      if (!pos || d.orders.some((o) => o.sym === x.sym && o.role === x.role)) return false;
      const dir = Math.sign(pos.qty);
      const inst = INSTRUMENTS[x.sym];
      const p = snap(x.sym, x.price);
      const sibling = d.orders.find((o) => o.sym === x.sym && (o.role === "stop" || o.role === "target"));
      const oco = sibling?.oco ?? uid("O");
      const o: Order = {
        id: x.id,
        sym: x.sym,
        side: (-dir) as Side,
        qty: Math.abs(pos.qty),
        type: x.role === "stop" ? "STP" : "LMT",
        role: x.role,
        stop: x.role === "stop" ? p : undefined,
        limit: x.role === "target" ? p : undefined,
        oco,
        reduceOnly: true,
        at,
      };
      d.orders = [...d.orders.map((y) => (y === sibling ? { ...y, oco } : y)), o];
      // a stop added later still defines the trade's risk
      if (x.role === "stop") updateTrade(d, pos.tradeId, (t) => (t.risk ? t : { ...t, risk: Math.abs(pos.avg - p) * inst.pv * Math.abs(pos.qty) }));
      syncExits(d, x.sym);
      return true;
    }
    case "note": {
      const body = x.text.trim();
      if (!body) return false;
      d.notes = [...d.notes, { id: x.id, tradeId: x.tradeId, sym: x.sym, phase: x.phase, text: body, at, edits: [] }];
      return true;
    }
    case "editNote": {
      const body = x.text.trim();
      if (!body) return false;
      d.notes = d.notes.map((n) => (n.id === x.id && n.text !== body ? { ...n, text: body, edits: [...n.edits, { text: n.text, at }] } : n));
      return true;
    }
    case "reset":
      d.positions = {};
      d.orders = [];
      d.fills = [];
      d.trades = [];
      d.notes = [];
      if (d.who !== "owner") d.notices = [];
      return true;
  }
}

/** Work every market's resting orders against its quote. */
export function workAll(d: Draft, quotes: Record<Sym, Quote>, at: number) {
  for (const s of SYMS) if (d.orders.some((o) => o.sym === s)) work(d, s, quotes[s], at);
}
