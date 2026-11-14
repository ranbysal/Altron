"use client";

import { browserClient } from "@/lib/supabase/client";
import { supabaseReady } from "@/lib/supabase/env";

/*
 * The line to Altron's worker: one tape and one set of books for everyone. Set
 * NEXT_PUBLIC_WORKER_URL to turn it on; without it every page runs its own paper market, as before.
 */

export const WORKER = (process.env.NEXT_PUBLIC_WORKER_URL ?? "").replace(/\/$/, "");
export const live = () => !!WORKER;

export async function token(): Promise<string | null> {
  if (!supabaseReady()) return null;
  try {
    const { data } = await browserClient().auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export async function call<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
  const t = await token();
  const r = await fetch(WORKER + path, {
    method: init?.method ?? "GET",
    headers: { ...(t ? { authorization: `Bearer ${t}` } : {}), ...(init?.body !== undefined ? { "content-type": "application/json" } : {}) },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return (await r.json()) as T;
}

type Handlers = Record<string, (data: unknown) => void>;
let source: EventSource | null = null;
const handlers: Handlers[] = [];
let opened = false;

/** Listen to the worker's stream. The connection is shared and comes back by itself. */
export function listen(h: Handlers) {
  handlers.push(h);
  if (source) for (const ev of Object.keys(h)) source.addEventListener(ev, wrap(ev));
  if (!opened) {
    opened = true;
    void connect();
  }
}

const wrap = (ev: string) => (e: Event) => {
  let data: unknown;
  try {
    data = JSON.parse((e as MessageEvent).data);
  } catch {
    return;
  }
  for (const h of handlers) h[ev]?.(data);
};

let retry = 1000;
async function connect() {
  const t = await token();
  const es = new EventSource(`${WORKER}/stream${t ? `?token=${encodeURIComponent(t)}` : ""}`);
  source = es;
  const events = new Set(handlers.flatMap((h) => Object.keys(h)));
  for (const ev of events) es.addEventListener(ev, wrap(ev));
  es.onopen = () => {
    retry = 1000;
  };
  // a fresh token on every reconnect: the old one may have expired
  es.onerror = () => {
    es.close();
    if (source === es) source = null;
    for (const h of handlers) h.down?.(null);
    setTimeout(() => void connect(), retry);
    retry = Math.min(retry * 2, 15_000);
  };
}
