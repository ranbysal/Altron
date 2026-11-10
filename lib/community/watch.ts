import { useEffect, useRef, useState } from "react";
import { create } from "zustand";

/** The Altron Watcher's client side: who it follows, and feeds that refresh themselves. */

export type Account = { handle: string; name: string };

/** Who the Watcher follows to begin with. Anyone can be added or removed on the page. */
export const DEFAULT_ACCOUNTS: Account[] = [
  { handle: "realDonaldTrump", name: "Donald J. Trump" },
  { handle: "elonmusk", name: "Elon Musk" },
  { handle: "nvidia", name: "NVIDIA" },
  { handle: "OpenAI", name: "OpenAI" },
  { handle: "sama", name: "Sam Altman" },
  { handle: "federalreserve", name: "Federal Reserve" },
  { handle: "USTreasury", name: "Treasury Department" },
  { handle: "WhiteHouse", name: "The White House" },
  { handle: "NickTimiraos", name: "Nick Timiraos" },
  { handle: "BillAckman", name: "Bill Ackman" },
  { handle: "RayDalio", name: "Ray Dalio" },
  { handle: "KobeissiLetter", name: "The Kobeissi Letter" },
];

type WatchState = { accounts: Account[]; replies: boolean; usdOnly: boolean };
const KEY = "altron-watch-v1";

export const useWatch = create<WatchState>(() => ({ accounts: DEFAULT_ACCOUNTS, replies: false, usdOnly: true }));

let started = false;
export function startWatch() {
  if (started || typeof window === "undefined") return;
  started = true;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (raw && Array.isArray(raw.accounts)) {
      const accounts = (raw.accounts as Account[]).filter((a) => a && /^[A-Za-z0-9_]{1,15}$/.test(a.handle)).slice(0, 30);
      useWatch.setState({ accounts, replies: !!raw.replies, usdOnly: raw.usdOnly !== false });
    }
  } catch {
    /* nothing saved */
  }
  useWatch.subscribe((s) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* storage full or blocked */
    }
  });
}

/** Accepts "@handle", "handle" or a profile link. Returns why it was refused, or null. */
export function addAccount(input: string): string | null {
  const m = input.trim().match(/(?:x\.com\/|twitter\.com\/|^@?)([A-Za-z0-9_]{1,15})\/?$/);
  if (!m) return "That doesn't look like an X handle";
  const handle = m[1];
  const { accounts } = useWatch.getState();
  if (accounts.some((a) => a.handle.toLowerCase() === handle.toLowerCase())) return "Already on the list";
  if (accounts.length >= 30) return "Thirty accounts is the limit";
  useWatch.setState({ accounts: [...accounts, { handle, name: handle }] });
  return null;
}
export function removeAccount(handle: string) {
  useWatch.setState({ accounts: useWatch.getState().accounts.filter((a) => a.handle !== handle) });
}
export function resetAccounts() {
  useWatch.setState({ accounts: DEFAULT_ACCOUNTS });
}
/** X's own name for an account, learned from its posts. */
export function nameAccount(handle: string, name: string) {
  const { accounts } = useWatch.getState();
  const a = accounts.find((x) => x.handle.toLowerCase() === handle.toLowerCase());
  if (a && name && (a.name !== name || a.handle !== handle)) useWatch.setState({ accounts: accounts.map((x) => (x === a ? { handle, name } : x)) });
}

export type FeedState<T> = { data: T | null; state: "loading" | "ok" | "error"; at: number };

/** Fetches a JSON feed now and every `every` ms while the tab is in view. Keeps the last answer through a failed refresh. */
export function useFeed<T>(url: string | null, every: number): FeedState<T> {
  const [st, setSt] = useState<FeedState<T>>({ data: null, state: "loading", at: 0 });
  const live = useRef(true);
  useEffect(() => {
    if (!url) return;
    live.current = true;
    let timer = 0;
    let ctl: AbortController | null = null;
    const run = async () => {
      if (document.hidden) return;
      ctl?.abort();
      ctl = new AbortController();
      try {
        const res = await fetch(url, { signal: ctl.signal, cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as T;
        if (live.current) setSt({ data, state: "ok", at: Date.now() });
      } catch (e) {
        if ((e as Error).name === "AbortError" || !live.current) return;
        setSt((s) => ({ ...s, state: s.data ? "ok" : "error" }));
      }
    };
    void run();
    timer = window.setInterval(run, every);
    const vis = () => !document.hidden && void run();
    document.addEventListener("visibilitychange", vis);
    return () => {
      live.current = false;
      ctl?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [url, every]);
  return st;
}

/** "now", "4m", "3h", "2d" */
export function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return "now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86_400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86_400)}d`;
}

/** A clock that ticks for anything showing relative times. */
export function useNow(every = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), every);
    return () => window.clearInterval(id);
  }, [every]);
  return now;
}

/* shapes returned by /api/watch/* */
export type XPart = { t: string; href?: string };
export type XPost = { id: string; handle: string; name: string; at: number; parts: XPart[]; url: string; reply: boolean; repost?: { handle: string; name: string }; media: number };
export type Voices = { at: number; accounts: { handle: string; name?: string; ok: boolean; why?: string; n: number }[]; posts: XPost[] };
export type WireItem = { id: string; source: string; title: string; url: string; at: number };
export type Wire = { at: number; sources: { id: string; name: string; ok: boolean; n: number }[]; items: WireItem[] };
export type CalEvent = { id: string; title: string; ccy: string; at: number; impact: 0 | 1 | 2 | 3; forecast: string; previous: string };
export type Calendar = { ok: boolean; stale?: boolean; at: number; events: CalEvent[] };
