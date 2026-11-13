"use client";

import { create } from "zustand";
import { INSTRUMENTS, type Sym } from "@/lib/desk/instruments";
import { cancelOrder, flatten, getMarket, hisBook, moveOrder, openPnl, placeExit, placeOrder, resetOwnerBook, useDesk, type Book, type Trade } from "@/lib/desk/store";
import { dirOf, entryOf, exitOf, stopOf } from "@/lib/community/trades";
import { useOwner } from "@/lib/owner/store";
import { DEFAULT_LIMITS, DEFAULT_RULES, MICRO, initState, restart, tick, type Action, type Advice, type Alert, type Ask, type His, type Limits, type Rules, type State, type Under, type World } from "./engine";

/*
 * Runs the follow engine against the owner's paper book, once a second, in the browser.
 * Everything the engine needs comes in through `World` and everything it does goes out as
 * actions, so moving it to a server later means replacing this file, not the engine.
 */

const KEY = "altron-follow-v2";

export type Sent = { at: number; kind: Alert["kind"]; title: string; lines: string[]; sent: boolean | null };

type FollowStore = {
  ready: boolean;
  state: State | null;
  rules: Rules;
  limits: Limits;
  /** whether the server has an AI key and a Discord webhook */
  ai: boolean | null;
  model: string | null;
  discord: boolean | null;
  /** the AI's recent answers, and how many calls failed in a row */
  advice: Advice[];
  aiFails: number;
  aiPausedUntil: number;
  thinking: Record<string, boolean>;
  alerts: Sent[];
};

export const useFollow = create<FollowStore>(() => ({ ready: false, state: null, rules: DEFAULT_RULES, limits: DEFAULT_LIMITS, ai: null, model: null, discord: null, advice: [], aiFails: 0, aiPausedUntil: 0, thinking: {}, alerts: [] }));
const set = useFollow.setState;
const get = useFollow.getState;

/* ------------------------------------------------------------------ */
/* persistence                                                         */
/* ------------------------------------------------------------------ */

type Saved = { v: 2; state: State; rules: Rules; limits: Limits; alerts: Sent[]; bookReset: boolean };

function load(): Saved | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Saved | null;
    return raw?.v === 2 ? raw : null;
  } catch {
    return null;
  }
}
function save() {
  const s = get();
  if (!s.state) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 2, state: s.state, rules: s.rules, limits: s.limits, alerts: s.alerts.slice(-60), bookReset: true } satisfies Saved));
  } catch {
    /* storage full or blocked */
  }
}

/* ------------------------------------------------------------------ */
/* the world, from the desk                                            */
/* ------------------------------------------------------------------ */

const MICROS: Sym[] = ["MNQ", "MES"];

function hisTargets(t: Trade, his: Book): number[] {
  const live = !t.closedAt;
  const xs = live ? his.orders.filter((o) => o.sym === t.sym && o.role === "target" && o.limit !== undefined).map((o) => o.limit!) : t.target !== undefined ? [t.target] : [];
  const e = entryOf(t);
  return [...new Set(xs)].sort((a, b) => Math.abs(a - e) - Math.abs(b - e));
}

/** One of Yazan's desk trades, the way the engine reads it. */
export function hisOf(t: Trade, his: Book): His {
  return { id: t.id, under: INSTRUMENTS[t.sym].under as Under, dir: dirOf(t) as 1 | -1, qty: t.qty, entry: entryOf(t), openedAt: t.openedAt, closedAt: t.closedAt, exit: exitOf(t), targets: hisTargets(t, his), stop: stopOf(t, his.orders) };
}

function worldOf(now: number): World | null {
  const d = useDesk.getState();
  if (!d.ready || d.seat !== "owner" || !d.other) return null;
  const his = hisBook(d);
  const m = getMarket();
  const recent = [...his.trades].sort((a, b) => a.openedAt - b.openedAt).slice(-6);
  const hs: His[] = recent.map((t) => hisOf(t, his));
  const latest = hs[hs.length - 1];
  const under: Under = latest?.under ?? "NQ";
  const msym = MICRO[under].sym as Sym;
  const results: Record<string, number> = {};
  for (const t of d.trades) if (t.follows && t.closedAt) results[t.follows] = (results[t.follows] ?? 0) + t.pnl;
  const tradeOf = new Map(d.trades.map((t) => [t.id, t]));
  return {
    now,
    last: d.quotes[msym].last,
    bars: (m?.bars(under, 60) ?? []).slice(-30).map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c })),
    ticks: (m?.bars(under, 1) ?? []).filter((b) => b.t >= now - 6 * 60_000).map((b) => ({ t: b.t, p: b.c })),
    his: hs,
    mine: {
      positions: MICROS.flatMap((x) => {
        const p = d.positions[x];
        return p ? [{ under: INSTRUMENTS[x].under as Under, qty: p.qty, avg: p.avg, follows: tradeOf.get(p.tradeId)?.follows }] : [];
      }),
      orders: d.orders.filter((o) => MICROS.includes(o.sym)).map((o) => ({ id: o.id, side: o.side, qty: o.qty, price: (o.role === "stop" || o.type === "STP" ? o.stop : o.limit) ?? 0, follows: o.follows, tag: o.tag })),
      fills: d.fills.filter((f) => MICROS.includes(f.sym) && tradeOf.get(f.tradeId)?.follows !== undefined).slice(-40).map((f) => ({ under: INSTRUMENTS[f.sym].under as Under, side: f.side, qty: f.qty, price: f.price, at: f.at, role: f.role })),
      balance: d.start + d.trades.reduce((a, t) => a + t.pnl, 0),
      open: openPnl(d),
      results,
    },
    following: useOwner.getState().following,
    news: newsNext(now),
    advice: get().advice,
    ai: get().limits.useAI && !!get().ai && now >= get().aiPausedUntil,
  };
}

/* ------------------------------------------------------------------ */
/* the calendar: high-impact releases                                  */
/* ------------------------------------------------------------------ */

let cal: { title: string; at: number; impact: number }[] = [];
let calAt = 0;
async function refreshCalendar() {
  if (Date.now() - calAt < 15 * 60_000) return;
  calAt = Date.now();
  try {
    const r = await fetch("/api/watch/calendar");
    const j = (await r.json()) as { events?: { title: string; at: number; impact: number; allDay?: boolean }[] };
    cal = (j.events ?? []).filter((e) => e.impact >= 3 && !e.allDay);
  } catch {
    /* no calendar: no news guard */
  }
}
function newsNext(now: number) {
  const e = cal.filter((x) => x.at >= now - 5 * 60_000).sort((a, b) => a.at - b.at)[0];
  return e ? { name: e.title, at: e.at } : null;
}

/* ------------------------------------------------------------------ */
/* acting                                                              */
/* ------------------------------------------------------------------ */

function apply(a: Action) {
  if (a.kind === "enter") placeOrder({ sym: MICRO[a.under].sym as Sym, side: a.side, qty: a.qty, type: a.type, limit: a.type === "LMT" ? a.price : undefined, follows: a.his, tag: "entry" });
  else if (a.kind === "exit") placeExit({ sym: MICRO[a.under].sym as Sym, side: a.side, qty: a.qty, role: a.role, price: a.price, follows: a.his, tag: a.tag });
  else if (a.kind === "cancel") cancelOrder(a.id);
  else if (a.kind === "move") moveOrder(a.id, a.price);
  else if (a.kind === "flatten") {
    if (a.under) flatten(MICRO[a.under].sym as Sym);
    else for (const s of MICROS) flatten(s);
  }
}

async function raise(al: Alert) {
  const entry: Sent = { at: Date.now(), kind: al.kind, title: al.title, lines: al.lines, sent: null };
  set({ alerts: [...get().alerts.slice(-59), entry] });
  let sent = false;
  try {
    const r = await fetch("/api/follow/alert", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(al) });
    sent = !!(await r.json()).sent;
  } catch {
    sent = false;
  }
  set({ alerts: get().alerts.map((x) => (x === entry ? { ...x, sent } : x)) });
  save();
}

async function askAI(q: Ask) {
  if (get().thinking[q.his]) return;
  set({ thinking: { ...get().thinking, [q.his]: true } });
  try {
    const r = await fetch("/api/follow/decide", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: q.kind, brief: q.brief }) });
    if (!r.ok) throw new Error(String(r.status));
    const j = (await r.json()) as { action: string; price?: number; reason: string };
    set({ advice: [...get().advice.slice(-30), { his: q.his, at: Date.now(), kind: q.kind, action: j.action, price: j.price, reason: j.reason }], aiFails: 0 });
  } catch {
    const fails = get().aiFails + 1;
    // two misses in a row: the rules decide on their own for ten minutes
    set({ aiFails: fails, aiPausedUntil: fails >= 2 ? Date.now() + 10 * 60_000 : get().aiPausedUntil });
    if (fails === 2) note(q.his, "The AI isn't answering. The rules are deciding on their own for ten minutes");
  } finally {
    set({ thinking: { ...get().thinking, [q.his]: false } });
  }
}

function note(his: string | undefined, text: string) {
  const st = get().state;
  if (st) set({ state: { ...st, log: [...st.log, { at: Date.now(), his, kind: "guard", text }] } });
}

/* ------------------------------------------------------------------ */
/* the loop                                                            */
/* ------------------------------------------------------------------ */

function step() {
  const now = Date.now();
  const w = worldOf(now);
  if (!w) return;
  const f = get();
  if (!f.state) {
    const saved = load();
    if (!saved?.bookReset) resetOwnerBook(f.rules.size);
    const fresh = worldOf(now)!;
    set({ state: saved?.state ?? initState(f.rules, fresh.mine.balance + fresh.mine.open, now), alerts: saved?.alerts ?? [] });
    save();
    return;
  }
  const out = tick(f.state, w, f.rules, f.limits);
  set({ state: out.state });
  for (const a of out.actions) apply(a);
  for (const al of out.alerts) void raise(al);
  for (const q of out.asks) void askAI(q);
  if (out.actions.length || out.alerts.length || out.state.log.length !== f.state.log.length) save();
}

let started = false;
export function startFollow() {
  if (started || typeof window === "undefined") return;
  started = true;
  const saved = load();
  if (saved) set({ rules: { ...DEFAULT_RULES, ...saved.rules }, limits: { ...DEFAULT_LIMITS, ...saved.limits, risk: { ...DEFAULT_LIMITS.risk, ...saved.limits?.risk }, minStop: { ...DEFAULT_LIMITS.minStop, ...saved.limits?.minStop } }, alerts: saved.alerts ?? [] });
  set({ ready: true });
  fetch("/api/follow/decide")
    .then((r) => (r.ok ? r.json() : { ai: false, model: null }))
    .then((j: { ai: boolean; model: string | null }) => set({ ai: j.ai, model: j.model }))
    .catch(() => set({ ai: false }));
  fetch("/api/follow/alert")
    .then((r) => (r.ok ? r.json() : { discord: false }))
    .then((j: { discord: boolean }) => set({ discord: j.discord }))
    .catch(() => set({ discord: false }));
  void refreshCalendar();
  window.setInterval(() => void refreshCalendar(), 15 * 60_000);
  window.setInterval(step, 1000);
}

/* ------------------------------------------------------------------ */
/* the owner's controls                                                */
/* ------------------------------------------------------------------ */

export function setRules(patch: Partial<Rules>) {
  set({ rules: { ...get().rules, ...patch } });
  save();
}
export function setLimits(patch: Partial<Limits>) {
  set({ limits: { ...get().limits, ...patch } });
  save();
}
export function restartFollow() {
  const st = get().state;
  if (!st) return;
  set({ state: restart(st, Date.now()) });
  save();
}
/** Start the paper account over from the firm's size: a fresh evaluation. */
export function startOver() {
  const f = get();
  resetOwnerBook(f.rules.size);
  set({ state: initState(f.rules, f.rules.size, Date.now()), advice: [] });
  save();
}
/** Send a test alert, so the owner knows Discord is wired. */
export function testAlert() {
  void raise({ kind: "info", title: "Test alert from Altron", lines: ["If this reached your phone, stop line alerts and session summaries will too."] });
}
