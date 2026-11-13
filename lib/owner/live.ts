"use client";

import { useEffect, useMemo, useState } from "react";
import { INSTRUMENTS } from "@/lib/desk/instruments";
import { getMarket, hisBook, sizeWords, useDesk, type Fill, type Order, type Position, type Trade } from "@/lib/desk/store";
import { currentTrade, dirOf, entryOf, exitOf, stopOf, targetOf } from "@/lib/community/trades";
import { fmt } from "@/lib/format";
import { ACCOUNTS, HIS_ROOM, LEVELS, MICRO_VALUE, MODE_LABEL, microsFor, planLive, type Mode, type Outlook, type Result, type Settings } from "./replay";

/*
 * What our side does with Yazan's trade, live or just closed: the agent's plan for it, and
 * then what the owner's own book actually holds (the agent's orders, anything the owner
 * placed or closed by hand). Shared by Follow, the Desk and the agent, so all three read
 * the same numbers.
 */

/** He trades the minis; we follow in the micros of the same market. */
export const MICRO_OF = { NQ: "MNQ", ES: "MES" } as const;
export type OursState = "Deciding" | "Working" | "In" | "Closed" | "Not filled" | "Standing by";

export type Tranche = { level: number; price: number; filledAt: number | null };
export type Step = { at: number; text: string; short: string; sub?: string; done: boolean };

export type Plan = {
  trade: Trade;
  live: boolean;
  dir: 1 | -1;
  code: string;
  entry: number;
  stop: number;
  target?: number;
  exit?: number;
  D: number;
  mode: Mode;
  reason: string;
  look: Outlook[];
  ratio: number;
  share: number;
  placed: number;
  tranches: Tranche[];
  /** micros per order, per account */
  accounts: { id: string; name: string; room: number; micros: number }[];
  /** micros per order across every account */
  per: number;
  filled: Tranche[];
  /** micros held */
  qty: number;
  avg: number | null;
  /** open P&L while live, the result once closed */
  pnl: number;
  /** what's lost if every order fills and his stop is hit */
  worst: number;
  /** what our risk is as a share of our room */
  ourShare: number;
  steps: Step[];
  /** our own trade in the book once the agent (or the owner) has one on; null before that */
  own: Trade | null;
  /** our position is still open */
  ownLive: boolean;
  state: OursState;
  /** the owner closed it himself, ahead of Yazan */
  byHand: boolean;
};

type Base = Omit<Plan, "steps" | "own" | "ownLive" | "state" | "byHand">;

function stepsOf(p: Base, now: number, last: number, hand?: { at: number; price: number }): Step[] {
  const t = p.trade;
  const out: Step[] = [
    { at: t.openedAt, short: "His entry", text: `Yazan ${p.dir > 0 ? "bought" : "sold"} ${sizeWords(t.sym, t.qty)} at ${fmt(p.entry)}`, done: true },
    { at: t.openedAt + 3_000, short: "Brief", text: "Brief built", sub: `His risk is ${Math.round(p.share * 100)}% of his room. ${p.look[0]?.n ?? 0} similar trades to learn from`, done: true },
    { at: p.placed, short: "Plan", text: `${MODE_LABEL[p.mode]}, ${p.per} micros an order`, sub: p.reason, done: true },
    ...p.filled.filter((x) => x.level > 0).map((x, k) => ({ at: x.filledAt!, short: `Add ${k + 1}`, text: `Add filled at ${fmt(x.price)}`, done: true })),
  ];
  if (hand) out.push({ at: hand.at, short: "You out", text: `You closed at ${fmt(hand.price)}`, sub: "The agent pulled what was still working", done: true });
  const end = Math.min(t.closedAt ?? Infinity, hand?.at ?? Infinity);
  for (const [ms, label, short] of [
    [60_000, "Check at one minute", "1 min"],
    [240_000, "Check at four minutes", "4 min"],
  ] as const) {
    const at = t.openedAt + ms;
    if (at > end) continue;
    const done = now >= at;
    out.push({ at, short, text: label, sub: done ? (ms === 60_000 ? `Price ${fmt(last)}. His stop and size unchanged, the plan holds` : "Orders left working until he exits or moves his stop") : undefined, done });
  }
  if (t.closedAt) {
    const x = exitOf(t);
    out.push({ at: t.closedAt, short: hand ? "His exit" : "Exit", text: `He closed at ${x !== undefined ? fmt(x) : "market"}${hand || !p.filled.length ? "" : ", and so did we"}`, done: true });
  }
  return out.sort((a, b) => a.at - b.at);
}

export function planFor(trade: Trade, orders: Order[], result: Result, settings: Settings, now: number, last: number): Plan {
  const inst = INSTRUMENTS[trade.sym];
  const live = !trade.closedAt;
  const dir = dirOf(trade) as 1 | -1;
  const entry = entryOf(trade);
  const stop = stopOf(trade, orders) ?? entry - dir * inst.tick * 80;
  const target = targetOf(trade, orders);
  const exit = exitOf(trade);
  const D = Math.abs(entry - stop) || inst.tick * 40;
  const lead = ACCOUNTS.find((a) => a.lead) ?? ACCOUNTS[0];
  const leadSt = result.accounts[lead.id];
  const leadRoom = leadSt.balance - leadSt.floor;
  const pl = planLive(inst.under === "NQ", trade.side, leadRoom, settings);
  const share = (trade.risk ?? D * inst.pv * trade.qty) / HIS_ROOM;
  const pv = MICRO_VALUE[inst.under];
  const placed = trade.openedAt + 7_000;
  const until = trade.closedAt ?? now;

  // how far the tape went against him while our orders were working, and when
  const bars = getMarket()?.bars(inst.under, 1) ?? [];
  const firstAt = new Map<number, number>();
  let i = bars.length;
  while (i > 0 && bars[i - 1].t >= placed - 1000) i--;
  for (; i < bars.length && bars[i].t <= until; i++) {
    const b = bars[i];
    const against = dir > 0 ? (entry - b.l) / D : (b.h - entry) / D;
    for (const d of LEVELS[pl.mode]) if (!firstAt.has(d) && against + 1e-9 >= d) firstAt.set(d, b.t);
  }
  const tick = inst.tick;
  const tranches: Tranche[] = LEVELS[pl.mode].map((d) => ({ level: d, price: Math.round((entry - dir * d * D) / tick) * tick, filledAt: d === 0 ? placed : (firstAt.get(d) ?? null) }));
  const accounts = ACCOUNTS.map((a) => {
    const x = result.accounts[a.id];
    const room = x.balance - x.floor;
    const budget = Math.min(share * settings.follow, settings.maxRisk) * room;
    return { id: a.id, name: a.name, room, micros: microsFor(budget, D, pv, pl.mode) };
  });
  const per = accounts.reduce((acc, x) => acc + x.micros, 0);
  const filled = tranches.filter((x) => x.filledAt !== null);
  const qty = per * filled.length;
  const avg = filled.length ? filled.reduce((acc, x) => acc + x.price, 0) / filled.length : null;
  const mark = live ? last : (exit ?? last);
  const pnl = filled.reduce((acc, x) => acc + per * (mark - x.price) * dir * pv, 0);
  const worst = tranches.reduce((acc, x) => acc + per * Math.abs(x.price - stop) * pv, 0);
  const room = accounts.reduce((acc, x) => acc + x.room, 0);
  const base: Base = { trade, live, dir, code: INSTRUMENTS[MICRO_OF[inst.under]].code, entry, stop, target, exit, D, mode: pl.mode, reason: pl.reason, look: pl.look, ratio: pl.ratio, share, placed, tranches, accounts, per, filled, qty, avg, pnl, worst, ourShare: room ? worst / room : 0 };
  const state: OursState = now < placed ? "Deciding" : !filled.length ? (live ? "Working" : "Not filled") : live ? "In" : "Closed";
  return { ...base, steps: stepsOf(base, now, last), own: null, ownLive: false, state, byHand: false };
}

/** The plan, corrected by what the owner's book really did with it. */
export function withBook(plan: Plan, mine: { trades: Trade[]; fills: Fill[]; orders: Order[]; positions: Partial<Record<string, Position>> }, now: number, last: number): Plan {
  const inst = INSTRUMENTS[plan.trade.sym];
  const sym = MICRO_OF[inst.under];
  const own = [...mine.trades].reverse().find((x) => x.follows === plan.trade.id) ?? null;
  const working = mine.orders.filter((o) => o.follows === plan.trade.id && o.role === "entry").length;
  const room = plan.accounts.reduce((a, x) => a + x.room, 0);
  if (!own) {
    // nothing of ours has filled: the plan stands, with whatever is really working
    const state: OursState = now < plan.placed ? "Deciding" : working ? "Working" : plan.live ? "Standing by" : "Not filled";
    const tranches = plan.tranches.map((x) => ({ ...x, filledAt: null }));
    const base: Base = { ...plan, tranches, filled: [], qty: 0, avg: null, pnl: 0 };
    return { ...base, steps: stepsOf(base, now, last), own: null, ownLive: false, state, byHand: false };
  }
  const pos = mine.positions[sym];
  const ownLive = !own.closedAt && pos?.tradeId === own.id;
  const ins = mine.fills.filter((x) => x.tradeId === own.id && x.side === plan.dir).sort((a, b) => a.at - b.at);
  const tranches = plan.tranches.map((x, k) => ({ ...x, price: ins[k]?.price ?? x.price, filledAt: ins[k]?.at ?? null }));
  const filled = tranches.filter((x) => x.filledAt !== null);
  const pv = MICRO_VALUE[inst.under];
  const qty = ownLive ? Math.abs(pos!.qty) : own.qty;
  const avg = own.entryQty ? own.entryValue / own.entryQty : null;
  const pnl = own.pnl + (ownLive ? (last - pos!.avg) * pos!.qty * pv : 0);
  const stop = ownLive ? (mine.orders.find((o) => o.sym === sym && o.role === "stop")?.stop ?? plan.stop) : (own.stop ?? plan.stop);
  const worst = ownLive ? Math.abs(pos!.avg - stop) * Math.abs(pos!.qty) * pv + mine.orders.filter((o) => o.follows === plan.trade.id && o.role === "entry").reduce((a, o) => a + o.qty * Math.abs((o.limit ?? stop) - stop) * pv, 0) : plan.worst;
  const outs = mine.fills.filter((x) => x.tradeId === own.id && x.side !== plan.dir);
  const byHand = !!own.closedAt && (!plan.trade.closedAt || own.closedAt < plan.trade.closedAt - 1500);
  const hand = byHand && outs.length ? { at: own.closedAt!, price: outs[outs.length - 1].price } : undefined;
  const base: Base = { ...plan, tranches, filled, qty, avg, pnl, worst, ourShare: room ? worst / room : 0 };
  const state: OursState = ownLive ? "In" : "Closed";
  return { ...base, steps: stepsOf(base, now, last, hand), own, ownLive, state, byHand };
}

export function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

/** The trade the owner's pages lead with (his open one, else his last) and our plan for it. */
const NONE: never[] = [];
const NO_BOOK = {};

export function useFollowPlan(result: Result, settings: Settings) {
  const now = useNow(1000);
  const seated = useDesk((x) => x.seat === "owner");
  const trades = useDesk((x) => hisBook(x).trades);
  const orders = useDesk((x) => hisBook(x).orders);
  const ready = useDesk((x) => x.ready) && seated;
  // the owner's own book is the seated one
  const myTrades = useDesk((x) => (x.seat === "owner" ? x.trades : NONE));
  const myFills = useDesk((x) => (x.seat === "owner" ? x.fills : NONE));
  const myOrders = useDesk((x) => (x.seat === "owner" ? x.orders : NONE));
  const myPositions = useDesk((x) => (x.seat === "owner" ? x.positions : NO_BOOK));
  const trade = currentTrade(trades);
  const last = useDesk((x) => (trade ? x.quotes[trade.sym].last : 0));
  const sec = Math.floor(now / 1000);
  const plan = useMemo(
    () => (ready && trade ? withBook(planFor(trade, orders, result, settings, sec * 1000, last), { trades: myTrades, fills: myFills, orders: myOrders, positions: myPositions }, sec * 1000, last) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, trade, orders, result, settings, sec, myTrades, myFills, myOrders, myPositions],
  );
  return { trade, plan, now, ready };
}
