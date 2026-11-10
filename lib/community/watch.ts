import { useEffect, useRef, useState } from "react";
import { create } from "zustand";

/** The Watcher's client side: the posts it shows, the calendar's filter, and feeds that refresh themselves. */

export type Post = { id: string; handle: string };

/** The posts the Watcher shows, newest first. Picked by hand for now. */
export const POSTS: Post[] = [
  { id: "2120241372737540587", handle: "MarioNawfal" },
  { id: "2120234042889224479", handle: "wallstengine" },
  { id: "2120229563418710438", handle: "wallstengine" },
  { id: "2120217511526576335", handle: "KobeissiLetter" },
];

type WatchState = { keyOnly: boolean };
const KEY = "altron-watch-v1";

export const useWatch = create<WatchState>(() => ({ keyOnly: true }));

let started = false;
export function startWatch() {
  if (started || typeof window === "undefined") return;
  started = true;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (raw && typeof raw.keyOnly === "boolean") useWatch.setState({ keyOnly: raw.keyOnly });
  } catch {
    /* nothing saved */
  }
  useWatch.subscribe((s) => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ keyOnly: s.keyOnly }));
    } catch {
      /* storage full or blocked */
    }
  });
}

export type FeedState<T> = {
  data: T | null;
  state: "loading" | "ok" | "error";
  at: number;
};

/** Fetches a JSON feed now and every `every` ms while the tab is in view. Keeps the last answer through a failed refresh. */
export function useFeed<T>(url: string | null, every: number): FeedState<T> {
  const [st, setSt] = useState<FeedState<T>>({
    data: null,
    state: "loading",
    at: 0,
  });
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
export type WireItem = {
  id: string;
  source: string;
  title: string;
  url: string;
  at: number;
  image?: string;
};
export type Wire = {
  at: number;
  sources: { id: string; name: string; ok: boolean; n: number }[];
  items: WireItem[];
};
export type CalEvent = {
  id: string;
  title: string;
  src: "BLS" | "BEA" | "Fed";
  at: number;
  impact: 1 | 2 | 3;
  allDay?: boolean;
};
export type Calendar = {
  ok: boolean;
  stale?: boolean;
  at: number;
  events: CalEvent[];
  sources?: { id: string; ok: boolean }[];
};
