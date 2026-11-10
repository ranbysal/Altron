import { allowed, UA } from "@/lib/watch/robots";
import { parseFeed } from "@/lib/watch/rss";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Publishers' own headline feeds, read only where the site allows it. Headlines link straight to the source; no article text is kept. */
const SOURCES = [
  { id: "fed", name: "Federal Reserve", url: "https://www.federalreserve.gov/feeds/press_all.xml" },
  { id: "cnbc", name: "CNBC", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html" },
  { id: "cnbc-fin", name: "CNBC", url: "https://www.cnbc.com/id/10000664/device/rss/rss.html" },
  { id: "mw", name: "MarketWatch", url: "https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines" },
  { id: "wsj", name: "WSJ", url: "https://feeds.content.dowjones.io/public/rss/RSSMarketsMain" },
  { id: "yahoo", name: "Yahoo Finance", url: "https://finance.yahoo.com/news/rssindex" },
  { id: "wh", name: "White House", url: "https://www.whitehouse.gov/news/feed/" },
  { id: "sec", name: "SEC", url: "https://www.sec.gov/news/pressreleases.rss" },
];

type Item = { id: string; source: string; title: string; url: string; at: number; image?: string };

async function read(src: (typeof SOURCES)[number]): Promise<{ id: string; name: string; ok: boolean; items: Item[] }> {
  try {
    if (!(await allowed(src.url))) return { id: src.id, name: src.name, ok: false, items: [] };
    const res = await fetch(src.url, { headers: { "user-agent": UA, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" }, next: { revalidate: 90 }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { id: src.id, name: src.name, ok: false, items: [] };
    const items = parseFeed(await res.text())
      .slice(0, 30)
      .map((x) => ({ id: `${src.id}:${x.url}`, source: src.name, title: x.title, url: x.url, at: x.at, image: x.image }));
    return { id: src.id, name: src.name, ok: items.length > 0, items };
  } catch {
    return { id: src.id, name: src.name, ok: false, items: [] };
  }
}

export async function GET() {
  const results = await Promise.all(SOURCES.map(read));
  const now = Date.now();
  const seen = new Set<string>();
  const items = results
    .flatMap((r) => r.items)
    .filter((x) => x.at <= now + 5 * 60_000 && now - x.at < 3 * 86_400_000)
    .sort((a, b) => b.at - a.at)
    .filter((x) => {
      const k = x.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 80);
  return Response.json({ at: now, sources: results.map(({ id, name, ok, items: it }) => ({ id, name, ok, n: it.length })), items }, { headers: { "cache-control": "no-store" } });
}
