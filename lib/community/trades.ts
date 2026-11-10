import { INSTRUMENTS, tickValue } from "@/lib/desk/instruments";
import { noticeText, sizeWords, type Fill, type Note, type Notice, type Order, type Trade } from "@/lib/desk/store";
import { fmt, money } from "@/lib/format";
import { placeholders, roomUntil, type Msg } from "./room";

/** What members read about one trade. Built from the desk's own book. */

export const entryOf = (t: Trade) => t.entryValue / Math.max(1, t.entryQty);
export const exitOf = (t: Trade) => (t.exitQty ? t.exitValue / t.exitQty : undefined);
export const dirOf = (t: Trade) => (t.side === "LONG" ? 1 : -1);

/** Where the stop sits (live), last sat (closed), or was implied by the trade's risk. */
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
export function targetOf(t: Trade, orders: Order[]): number | undefined {
  if (!t.closedAt) {
    const o = orders.find((x) => x.sym === t.sym && x.role === "target");
    if (o?.limit !== undefined) return o.limit;
  }
  return t.target;
}

/**
 * The trade the page leads with: the open one, else the most recent. A closed trade stays
 * here, not in the history, until the next one opens.
 */
export function currentTrade(trades: Trade[]): Trade | undefined {
  const open = trades.filter((t) => !t.closedAt);
  return open[open.length - 1] ?? [...trades].sort((a, b) => b.openedAt - a.openedAt)[0];
}

export type RoomState = { open: boolean; live: boolean; until: number | null };
export function roomOf(t: Trade, trades: Trade[], now: number): RoomState {
  if (!t.closedAt) return { open: true, live: true, until: null };
  const next = trades.filter((x) => x.openedAt > t.openedAt && x.id !== t.id).reduce((a, x) => Math.min(a, x.openedAt), Infinity);
  const until = roomUntil(t, Number.isFinite(next) ? next : undefined)!;
  return { open: now < until, live: false, until };
}

export type Line =
  | { kind: "event"; id: string; at: number; text: string; tone: "buy" | "sell" | "move" | "flat"; sub?: string }
  | { kind: "note"; id: string; at: number; text: string }
  | { kind: "msg"; id: string; at: number; name: string; trader: boolean; text: string; reply?: { name: string; text: string } };

/** Everything said and done in one trade's room, in order. */
export function streamOf(t: Trade, fills: Fill[], notices: Notice[], notes: Note[], msgs: Msg[], now: number): Line[] {
  const out: Line[] = [];
  const dir = dirOf(t);
  const mine = fills.filter((f) => f.tradeId === t.id).sort((a, b) => a.at - b.at);
  mine.forEach((f, i) => {
    const size = sizeWords(f.sym, f.qty);
    const px = fmt(f.price);
    const opening = f.side === dir;
    let text: string;
    if (opening) text = i === 0 ? `${f.side > 0 ? "Bought" : "Sold"} ${size} @ ${px}` : `Added ${size} @ ${px}`;
    else if (f.role === "stop") text = `Stopped out of ${size} @ ${px}`;
    else if (f.role === "target") text = `Target filled on ${size} @ ${px}`;
    else text = `${f.side > 0 ? "Bought back" : "Sold"} ${size} @ ${px}`;
    out.push({ kind: "event", id: f.id, at: f.at, text, tone: f.side > 0 ? "buy" : "sell", sub: opening ? undefined : money(f.pnl) });
  });
  if (t.closedAt) out.push({ kind: "event", id: `${t.id}-closed`, at: t.closedAt + 1, text: "Trade closed", tone: "flat", sub: money(t.pnl) });
  for (const n of notices) {
    if (n.tradeId !== t.id) continue;
    if (n.kind === "stop" || n.kind === "target") {
      const { head, body } = noticeText(n);
      out.push({ kind: "event", id: n.id, at: n.at, text: head.replace(/^[A-Z0-9]+ /, "").replace(/^./, (c) => c.toUpperCase()), tone: "move", sub: body || undefined });
    }
    if (n.note) out.push({ kind: "note", id: `${n.id}-note`, at: n.at + 2, text: n.note });
  }
  for (const n of notes) if (n.tradeId === t.id) out.push({ kind: "note", id: n.id, at: n.at, text: n.text });
  const said = [...msgs.filter((x) => x.tradeId === t.id), ...placeholders(t, now)];
  const byId = new Map(said.map((m) => [m.id, m]));
  for (const m of said) {
    const r = m.replyTo ? byId.get(m.replyTo) : undefined;
    out.push({ kind: "msg", id: m.id, at: m.at, name: m.name, trader: !!m.trader, text: m.text, reply: r ? { name: r.name, text: r.text } : undefined });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Yazan's own words on a trade, newest last. */
export function notesOf(t: Trade, notices: Notice[], notes: Note[]): { id: string; at: number; text: string }[] {
  return [
    ...notices.filter((n) => n.tradeId === t.id && n.note).map((n) => ({ id: n.id, at: n.at, text: n.note! })),
    ...notes.filter((n) => n.tradeId === t.id).map((n) => ({ id: n.id, at: n.at, text: n.text })),
  ].sort((a, b) => a.at - b.at);
}

const CLOCK = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const CLOCK_S = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", second: "2-digit" });
const DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
const DAY_KEY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
export const clock = (ms: number) => CLOCK.format(ms);
export const clockS = (ms: number) => CLOCK_S.format(ms);
export const dayKey = (ms: number) => DAY_KEY.format(ms);
/** "Today", "Yesterday" or "Nov 6", in New York. */
export function dayWord(ms: number, now: number): string {
  const k = dayKey(ms);
  if (k === dayKey(now)) return "Today";
  if (k === dayKey(now - 86_400_000)) return "Yesterday";
  return DAY.format(ms);
}
export function held(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 1) return "under a minute";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
  return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
}
