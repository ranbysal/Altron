import { create } from "zustand";

/**
 * The room: one live chat per trade, for members and Yazan. Until the backend carries it,
 * messages live in this browser. A room stays open while its trade is live, then for an
 * hour after it closes or until the next trade opens, whichever comes first.
 */

export type Msg = { id: string; tradeId: string; name: string; trader?: boolean; text: string; at: number; replyTo?: string; uid?: string; owner?: boolean };

/** Who is speaking: the signed-in person, as themselves. */
export type Speaker = { id: string | null; name: string; role: "member" | "trader" | "owner" | null };

const KEY = "altron-room-v1";
export const ROOM_AFTER_MS = 60 * 60_000;

export const useRoom = create<{ msgs: Msg[] }>(() => ({ msgs: [] }));

let started = false;
export function startRoom() {
  if (started || typeof window === "undefined") return;
  started = true;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (Array.isArray(raw?.msgs)) useRoom.setState({ msgs: raw.msgs.filter((m: Msg) => m && typeof m.text === "string" && typeof m.tradeId === "string") });
  } catch {
    /* nothing saved */
  }
  useRoom.subscribe((s) => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ msgs: s.msgs.slice(-2000) }));
    } catch {
      /* storage full or blocked */
    }
  });
}

let n = 0;
export function say(who: Speaker, tradeId: string, text: string, replyTo?: string) {
  const body = text.trim().slice(0, 1200);
  if (!body || !who.name) return;
  const msg: Msg = { id: `m${Date.now().toString(36)}${(n++).toString(36)}`, tradeId, name: who.name, text: body, at: Date.now(), replyTo, uid: who.id ?? undefined };
  if (who.role === "trader") msg.trader = true;
  if (who.role === "owner") msg.owner = true;
  useRoom.setState({ msgs: [...useRoom.getState().msgs, msg] });
}

/** When a trade's room shuts: an hour after the close, or the moment the next trade opens. */
export function roomUntil(t: { closedAt?: number }, nextOpenedAt?: number): number | null {
  if (!t.closedAt) return null;
  return Math.min(t.closedAt + ROOM_AFTER_MS, nextOpenedAt ?? Infinity);
}

/* ------------------------------------------------------------------ */
/* placeholder members                                                 */
/* ------------------------------------------------------------------ */

/**
 * Until real members can sign in, each room shows a few placeholder messages so the design
 * can be judged with a conversation in it. They are neutral questions about the trade, from
 * invented names, made the same way every time from the trade's id. Set to false to see the
 * rooms exactly as they are; the real chat replaces this when the backend is wired.
 */
export const PLACEHOLDER_MEMBERS = true;

const NAMES = ["Idris K.", "Noor A.", "Tomas R.", "Lena V.", "Sam O.", "Priya N.", "Marek D.", "Jules B."];
const LINES = [
  "What's the invalidation on this one?",
  "Is the stop behind the overnight level or the last swing?",
  "Is this full size or a starter?",
  "Which timeframe is the entry off, the 5 or the 15?",
  "Watching the same level on ES.",
  "Any plan to trail once it clears the first target?",
  "Does the target line up with the prior day's range?",
  "Following on the 1 minute. Spread is one tick.",
  "Tape slowed right into the level.",
  "Is the plan to hold through the next data release?",
  "Would a close back through the entry change the idea?",
  "Seeing the same structure on the micro.",
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function placeholders(t: { id: string; openedAt: number; closedAt?: number }, now: number): Msg[] {
  if (!PLACEHOLDER_MEMBERS) return [];
  let h = hash(t.id);
  const next = () => {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    return h / 4294967296;
  };
  const count = 2 + Math.floor(next() * 4);
  const end = Math.min(now, (t.closedAt ?? now) + 20 * 60_000);
  const out: Msg[] = [];
  let at = t.openedAt + 35_000 + next() * 80_000;
  const used = new Set<number>();
  for (let k = 0; k < count; k++) {
    if (at > end) break;
    let li = Math.floor(next() * LINES.length);
    while (used.has(li)) li = (li + 1) % LINES.length;
    used.add(li);
    out.push({ id: `p${t.id}${k}`, tradeId: t.id, name: NAMES[Math.floor(next() * NAMES.length)], text: LINES[li], at: Math.round(at) });
    at += 50_000 + next() * 240_000;
  }
  return out;
}
