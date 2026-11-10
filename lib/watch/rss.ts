/** A small reader for RSS and Atom: headlines, links and times. Nothing else is kept. */

export type FeedItem = { title: string; url: string; at: number; image?: string };

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

const https = (u: string | undefined) => {
  if (!u) return undefined;
  const v = text(u).replace(/&amp;/g, "&");
  return /^https:\/\//i.test(v) ? v : /^http:\/\//i.test(v) ? v.replace(/^http:/i, "https:") : undefined;
};

/** The picture a publisher attached to a headline: media tags, an image enclosure, or the first image in the summary. */
function imageOf(block: string): string | undefined {
  const attr = (re: RegExp) => https(block.match(re)?.[1]);
  return (
    attr(/<media:thumbnail\b[^>]*\burl=["']([^"']+)["']/i) ??
    attr(/<media:content\b(?=[^>]*\b(?:medium=["']image["']|type=["']image\/))[^>]*\burl=["']([^"']+)["']/i) ??
    attr(/<media:content\b[^>]*\burl=["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["']/i) ??
    attr(/<enclosure\b(?=[^>]*\btype=["']image\/)[^>]*\burl=["']([^"']+)["']/i) ??
    attr(/<img\b[^>]*\bsrc=["']([^"']+)["']/i) ??
    attr(/&lt;img\b[^&]*?\bsrc=(?:&quot;|["'])([^"&]+)/i)
  );
}

export function parseFeed(xml: string): FeedItem[] {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  const out: FeedItem[] = [];
  for (const b of blocks) {
    const title = text(tag(b, "title") ?? "");
    const url = link(b);
    const at = Date.parse(text(tag(b, "pubDate") ?? tag(b, "dc:date") ?? tag(b, "published") ?? tag(b, "updated") ?? ""));
    if (!title || !/^https?:\/\//i.test(url) || !Number.isFinite(at)) continue;
    out.push({ title, url, at, image: imageOf(b) });
  }
  return out;
}
