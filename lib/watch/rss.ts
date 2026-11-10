/** A small reader for RSS and Atom: headlines, links and times. Nothing else is kept. */

export type FeedItem = { title: string; url: string; at: number };

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", hellip: "…" };

export function text(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

const tag = (block: string, name: string) => block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"))?.[1];

function link(block: string): string {
  const plain = tag(block, "link");
  if (plain && /^\s*(<!\[CDATA\[)?\s*https?:/i.test(plain)) return text(plain);
  const alt = block.match(/<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i) ?? block.match(/<link\b[^>]*href=["']([^"']+)["']/i);
  if (alt) return text(alt[1]);
  const guid = tag(block, "guid");
  return guid && /^\s*https?:/i.test(guid) ? text(guid) : "";
}

export function parseFeed(xml: string): FeedItem[] {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  const out: FeedItem[] = [];
  for (const b of blocks) {
    const title = text(tag(b, "title") ?? "");
    const url = link(b);
    const at = Date.parse(text(tag(b, "pubDate") ?? tag(b, "dc:date") ?? tag(b, "published") ?? tag(b, "updated") ?? ""));
    if (!title || !/^https?:\/\//i.test(url) || !Number.isFinite(at)) continue;
    out.push({ title, url, at });
  }
  return out;
}
