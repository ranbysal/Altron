/**
 * Recent posts from a public X account, without the X API.
 *
 * X serves the data behind its own embedded timelines from a public endpoint. We read
 * that, on the server, a couple of minutes apart per account, and keep the last good
 * answer. It is unofficial: X can thin it out, rate limit it or switch it off, and the
 * Watcher says so plainly when that happens instead of showing anything stale as new.
 */

export type XPart = { t: string; href?: string };
export type XPost = {
  id: string;
  handle: string;
  name: string;
  at: number;
  parts: XPart[];
  url: string;
  reply: boolean;
  repost?: { handle: string; name: string };
  media: number;
};
export type XResult = { handle: string; name?: string; ok: boolean; why?: string; posts: XPost[]; at: number };

const UA = "Mozilla/5.0 (compatible; AltronWatcher/1.0; +https://altron.capital)";
const lastGood = new Map<string, XResult>();

/* eslint-disable @typescript-eslint/no-explicit-any */

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function safeUrl(u: unknown): string | undefined {
  if (typeof u !== "string") return undefined;
  try {
    const x = new URL(u);
    return x.protocol === "https:" || x.protocol === "http:" ? x.toString() : undefined;
  } catch {
    return undefined;
  }
}

function toPost(t: any): XPost | null {
  if (!t || typeof t !== "object") return null;
  const src = t.retweeted_status ?? t;
  const owner = t.user ?? {};
  const author = src.user ?? owner;
  const id = String(t.id_str ?? "");
  const at = Date.parse(String(t.created_at ?? ""));
  const handle = String(owner.screen_name ?? "");
  if (!id || !handle || !Number.isFinite(at)) return null;

  const raw = String(src.full_text ?? src.text ?? "");
  const urls = new Map<string, { text: string; href?: string }>();
  for (const u of src.entities?.urls ?? []) if (u?.url) urls.set(String(u.url), { text: String(u.display_url ?? u.expanded_url ?? u.url), href: safeUrl(u.expanded_url) });
  const media = [...(src.extended_entities?.media ?? src.entities?.media ?? [])];
  const mediaUrls = new Set(media.map((m: any) => String(m?.url ?? "")));

  const parts: XPart[] = [];
  let i = 0;
  for (const m of raw.matchAll(/https?:\/\/t\.co\/\w+/g)) {
    const before = raw.slice(i, m.index);
    if (before) parts.push({ t: decode(before) });
    const hit = urls.get(m[0]);
    if (hit) parts.push({ t: hit.text, href: hit.href });
    else if (!mediaUrls.has(m[0])) parts.push({ t: m[0], href: safeUrl(m[0]) });
    i = m.index! + m[0].length;
  }
  const rest = raw.slice(i);
  if (rest) parts.push({ t: decode(rest) });
  // tidy the ends, where removed media links leave spaces
  if (parts.length) {
    parts[0].t = parts[0].t.replace(/^\s+/, "");
    parts[parts.length - 1].t = parts[parts.length - 1].t.replace(/\s+$/, "");
  }
  const clean = parts.filter((p) => p.t.length > 0);
  if (!clean.length && !media.length) return null;

  return {
    id,
    handle,
    name: String(owner.name ?? handle),
    at,
    parts: clean,
    url: `https://x.com/${handle}/status/${id}`,
    reply: !!(t.in_reply_to_status_id_str || t.in_reply_to_screen_name),
    repost: t.retweeted_status ? { handle: String(author.screen_name ?? ""), name: String(author.name ?? "") } : undefined,
    media: media.length,
  };
}

/** The posts X is showing for one account right now. Never throws. */
export async function timeline(handle: string): Promise<XResult> {
  const key = handle.toLowerCase();
  const fail = (why: string): XResult => {
    const old = lastGood.get(key);
    // a recent good answer beats an error; an old one is not passed off as current
    if (old && Date.now() - old.at < 30 * 60_000) return old;
    return { handle, ok: false, why, posts: [], at: Date.now() };
  };
  try {
    const res = await fetch(`https://syndication.twitter.com/srv/timeline-profile/screen-name/${encodeURIComponent(handle)}?lang=en`, {
      headers: { "user-agent": UA, accept: "text/html" },
      next: { revalidate: 120 },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 429) return fail("rate limited");
    if (res.status === 404) return fail("not found");
    if (!res.ok) return fail(`status ${res.status}`);
    const html = await res.text();
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return fail("no data");
    const data = JSON.parse(m[1]);
    const entries: any[] = data?.props?.pageProps?.timeline?.entries ?? [];
    const posts = entries
      .filter((e) => e?.type === "tweet")
      .map((e) => toPost(e?.content?.tweet))
      .filter((p): p is XPost => !!p)
      .sort((a, b) => b.at - a.at)
      .slice(0, 20);
    if (!posts.length) return fail("empty");
    const out: XResult = { handle: posts[0].handle, name: posts[0].name, ok: true, posts, at: Date.now() };
    lastGood.set(key, out);
    return out;
  } catch (e) {
    return fail(e instanceof Error && e.name === "TimeoutError" ? "timed out" : "unreachable");
  }
}

/** Runs jobs a few at a time, so one page load never fires a burst at the source. */
export async function pooled<T, R>(items: T[], size: number, job: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await job(items[i]);
      }
    }),
  );
  return out;
}
