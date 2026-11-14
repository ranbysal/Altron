import { INSTRUMENTS, tickValue, type Sym } from "@/lib/desk/instruments";
import type { Market, Quote } from "@/lib/desk/market";
import type { BookData, Op } from "@/lib/desk/broker";
import { uid } from "@/lib/desk/broker";
import type { Order, Trade } from "@/lib/desk/types";
import { MICRO, type Action, type Advice, type His, type Under, type World } from "./engine";

/*
 * What the follow engine sees, built from the two books and the tape, and how what it decides
 * becomes operations on the owner's book. No browser, no store: the server builds the same world.
 */

export const entryOf = (t: Trade) => t.entryValue / Math.max(1, t.entryQty);
export const exitOf = (t: Trade) => (t.exitQty ? t.exitValue / t.exitQty : undefined);
export const dirOf = (t: Trade): 1 | -1 => (t.side === "LONG" ? 1 : -1);

export function stopOf(t: Trade, orders: Order[]): number | undefined {
  if (!t.closedAt) {
    const o = orders.find((x) => x.sym === t.sym && x.role === "stop");
    if (o?.stop !== undefined) return o.stop;
  }
  if (t.stop !== undefined) return t.stop;
  if (t.risk) {
    const tk = INSTRUMENTS[t.sym].tick;
    const ticks = t.risk / (tickValue(t.sym) * Math.max(1, t.entryQty));
    return Math.round((entryOf(t) - dirOf(t) * ticks * tk) / tk) * tk;
  }
  return undefined;
}

/** His targets, nearest first: every target order he has working, or the one he last had. */
export function hisTargets(t: Trade, orders: Order[]): number[] {
  const xs = !t.closedAt ? orders.filter((o) => o.sym === t.sym && o.role === "target" && o.limit !== undefined).map((o) => o.limit!) : t.target !== undefined ? [t.target] : [];
  const e = entryOf(t);
  return [...new Set(xs)].sort((a, b) => Math.abs(a - e) - Math.abs(b - e));
}

/** One of Yazan's trades, the way the engine reads it. */
export function hisOf(t: Trade, orders: Order[]): His {
  return { id: t.id, under: INSTRUMENTS[t.sym].under as Under, dir: dirOf(t), qty: t.qty, entry: entryOf(t), openedAt: t.openedAt, closedAt: t.closedAt, exit: exitOf(t), targets: hisTargets(t, orders), stop: stopOf(t, orders) };
}

export function openPnlOf(positions: BookData["positions"], quotes: Record<Sym, Quote>): number {
  let sum = 0;
  for (const p of Object.values(positions)) {
    if (!p) continue;
    const q = quotes[p.sym];
    const mark = p.qty > 0 ? q.bid : q.ask;
    sum += (mark - p.avg) * p.qty * INSTRUMENTS[p.sym].pv;
  }
  return sum;
}

const MICROS: Sym[] = ["MNQ", "MES"];

export function worldFrom(x: {
  now: number;
  his: BookData;
  mine: BookData;
  start: number;
  quotes: Record<Sym, Quote>;
  market: Market | null;
  following: boolean;
  news: { name: string; at: number } | null;
  advice: Advice[];
  ai: boolean;
}): World {
  const { now, his, mine, quotes, market: m } = x;
  const recent = [...his.trades].sort((a, b) => a.openedAt - b.openedAt).slice(-6);
  const hs = recent.map((t) => hisOf(t, his.orders));
  const latest = hs[hs.length - 1];
  const under: Under = latest?.under ?? "NQ";
  const msym = MICRO[under].sym as Sym;
  const results: Record<string, number> = {};
  for (const t of mine.trades) if (t.follows && t.closedAt) results[t.follows] = (results[t.follows] ?? 0) + t.pnl;
  const tradeOf = new Map(mine.trades.map((t) => [t.id, t]));
  return {
    now,
    last: quotes[msym].last,
    bars: (m?.bars(under, 60) ?? []).slice(-30).map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c })),
    ticks: (m?.bars(under, 1) ?? []).filter((b) => b.t >= now - 6 * 60_000).map((b) => ({ t: b.t, p: b.c })),
    his: hs,
    mine: {
      positions: MICROS.flatMap((s) => {
        const p = mine.positions[s];
        return p ? [{ under: INSTRUMENTS[s].under as Under, qty: p.qty, avg: p.avg, follows: tradeOf.get(p.tradeId)?.follows }] : [];
      }),
      orders: mine.orders.filter((o) => MICROS.includes(o.sym)).map((o) => ({ id: o.id, side: o.side, qty: o.qty, price: (o.role === "stop" || o.type === "STP" ? o.stop : o.limit) ?? 0, follows: o.follows, tag: o.tag })),
      fills: mine.fills.filter((f) => MICROS.includes(f.sym) && tradeOf.get(f.tradeId)?.follows !== undefined).slice(-40).map((f) => ({ under: INSTRUMENTS[f.sym].under as Under, side: f.side, qty: f.qty, price: f.price, at: f.at, role: f.role })),
      balance: x.start + mine.trades.reduce((a, t) => a + t.pnl, 0),
      open: openPnlOf(mine.positions, quotes),
      results,
    },
    following: x.following,
    news: x.news,
    advice: x.advice,
    ai: x.ai,
  };
}

/** What the engine decided, as operations on the owner's book. */
export function opsOf(a: Action): Op[] {
  if (a.kind === "enter") return [{ op: "place", id: uid("o"), input: { sym: MICRO[a.under].sym as Sym, side: a.side, qty: a.qty, type: a.type, limit: a.type === "LMT" ? a.price : undefined, follows: a.his, tag: "entry" } }];
  if (a.kind === "exit") return [{ op: "exit", id: uid("o"), input: { sym: MICRO[a.under].sym as Sym, side: a.side, qty: a.qty, role: a.role, price: a.price, follows: a.his, tag: a.tag } }];
  if (a.kind === "cancel") return [{ op: "cancel", id: a.id }];
  if (a.kind === "move") return [{ op: "move", id: a.id, price: a.price }];
  if (a.under) return [{ op: "flatten", sym: MICRO[a.under].sym as Sym }];
  return MICROS.map((s) => ({ op: "flatten" as const, sym: s }));
}
