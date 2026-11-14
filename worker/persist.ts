import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

/*
 * Where the worker keeps what must survive a restart: both books, the follow engine's state,
 * the AI spend and the daily reviews. In Supabase (one row per key in `worker_state`, readable
 * only with the service role) when it's configured, else in JSON files beside the worker.
 */

const URL_ = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
// outside the project, so a local dev server doesn't see the files change and reload
const DIR = process.env.WORKER_DATA || path.join(os.tmpdir(), "altron-worker");

let db: SupabaseClient | null = null;
export function admin(): SupabaseClient | null {
  if (!URL_ || !SERVICE) return null;
  if (!db) db = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
  return db;
}
export const where = () => (admin() ? "supabase" : `files in ${DIR}`);

export async function load<T>(key: string): Promise<T | null> {
  const a = admin();
  if (a) {
    const { data, error } = await a.from("worker_state").select("data").eq("key", key).maybeSingle();
    if (error) throw new Error(`load ${key}: ${error.message}`);
    return (data?.data as T | undefined) ?? null;
  }
  try {
    return JSON.parse(await readFile(path.join(DIR, `${key}.json`), "utf8")) as T;
  } catch {
    return null;
  }
}

export async function save(key: string, data: unknown): Promise<void> {
  const a = admin();
  if (a) {
    const { error } = await a.from("worker_state").upsert({ key, data, updated_at: new Date().toISOString() });
    if (error) throw new Error(`save ${key}: ${error.message}`);
    return;
  }
  await mkdir(DIR, { recursive: true });
  const f = path.join(DIR, `${key}.json`);
  await writeFile(f + ".tmp", JSON.stringify(data));
  await rename(f + ".tmp", f);
}

/** Saves a key soon after it changes, at most once every `ms`, and never two writes at once. */
export function saver(key: string, read: () => unknown, ms = 3000) {
  let due = false;
  let busy = false;
  let timer: NodeJS.Timeout | null = null;
  const flush = async () => {
    timer = null;
    if (busy) {
      due = true;
      return;
    }
    busy = true;
    due = false;
    try {
      await save(key, read());
    } catch (e) {
      console.error(String(e));
      due = true;
    } finally {
      busy = false;
      if (due && !timer) timer = setTimeout(flush, ms);
    }
  };
  return {
    mark() {
      if (!timer) timer = setTimeout(flush, ms);
    },
    async now() {
      if (timer) clearTimeout(timer);
      timer = null;
      await flush();
    },
  };
}
