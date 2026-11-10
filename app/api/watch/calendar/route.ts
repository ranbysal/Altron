import { allowed, UA } from "@/lib/watch/robots";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Scheduled U.S. releases and Federal Reserve events for the next ten days, from the
 * agencies' own published calendars: the Bureau of Labor Statistics, the Bureau of
 * Economic Analysis and the Federal Reserve Board. Impact is our own reading of which
 * releases tend to move index futures.
 */
type Ev = { id: string; title: string; src: "BLS" | "BEA" | "Fed"; at: number; impact: 1 | 2 | 3; allDay?: boolean };

const NY_H = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" });
/** A New York wall-clock time as a UTC instant, daylight saving included. */
function et(y: number, mo: number, d: number, h: number, mi: number): number {
  for (const off of [4, 5]) {
    const t = Date.UTC(y, mo - 1, d, h + off, mi);
    if (Number(NY_H.format(t)) === h % 24) return t;
  }
  return Date.UTC(y, mo - 1, d, h + 5, mi);
}

async function get(url: string, accept: string): Promise<string | null> {
  try {
    if (!(await allowed(url))) return null;
    const res = await fetch(url, { headers: { "user-agent": UA, accept }, next: { revalidate: 3 * 3600 }, signal: AbortSignal.timeout(9000) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

async function bls(): Promise<Ev[] | null> {
  const raw = await get("https://www.bls.gov/schedule/news_release/bls.ics", "text/calendar, text/plain");
  if (!raw) return null;
  const out: Ev[] = [];
  for (const block of raw.replace(/\r?\n[ \t]/g, "").split("BEGIN:VEVENT").slice(1)) {
    const d = block.match(/DTSTART(?:;[^:]*)?:(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
    const title = block.match(/SUMMARY:(.+)/)?.[1]?.replace(/\\([,;])/g, "$1").trim();
    if (!d || !title) continue;
    const at = et(+d[1], +d[2], +d[3], d[4] ? +d[4] : 8, d[5] ? +d[5] : 30);
    const impact = /Consumer Price Index|Employment Situation|Producer Price Index/i.test(title) ? 3 : /Job Openings|Employment Cost Index|Productivity and Costs|Import and Export Price|Real Earnings/i.test(title) ? 2 : 1;
    out.push({ id: `bls:${at}:${title}`, title, src: "BLS", at, impact });
  }
  return out;
}

async function bea(): Promise<Ev[] | null> {
  const raw = await get("https://apps.bea.gov/API/signup/release_dates.json", "application/json");
  if (!raw) return null;
  try {
    const data = JSON.parse(raw.replace(/^﻿/, "")) as Record<string, { release_dates?: string[] } | string>;
    const out: Ev[] = [];
    for (const [title, v] of Object.entries(data)) {
      if (typeof v !== "object" || !Array.isArray(v.release_dates)) continue;
      const impact = title === "Gross Domestic Product" || title === "Personal Income and Outlays" ? 3 : /International Trade in Goods and Services/.test(title) ? 2 : 1;
      for (const s of new Set(v.release_dates)) {
        const at = Date.parse(s);
        if (Number.isFinite(at)) out.push({ id: `bea:${at}:${title}`, title, src: "BEA", at, impact });
      }
    }
    return out;
  } catch {
    return null;
  }
}

async function fed(): Promise<Ev[] | null> {
  const raw = await get("https://www.federalreserve.gov/json/calendar.json", "application/json");
  if (!raw) return null;
  try {
    const data = JSON.parse(raw.replace(/^﻿/, "")) as { events?: Record<string, string>[] };
    const out: Ev[] = [];
    for (const e of data.events ?? []) {
      const title = String(e.title ?? "").trim();
      const type = String(e.type ?? "");
      const ym = String(e.month ?? "").match(/^(\d{4})-(\d{2})$/);
      const day = String(e.days ?? "").split(/[^0-9]+/).filter(Boolean).pop();
      if (!title || !ym || !day || /holiday/i.test(type)) continue;
      const tm = String(e.time ?? "").match(/(\d{1,2}):(\d{2})\s*([ap])/i);
      const meeting = /FOMC/i.test(title + type) && /Meeting|Statement|Press Conference|Projections/i.test(title);
      let h = tm ? (+tm[1] % 12) + (tm[3].toLowerCase() === "p" ? 12 : 0) : meeting ? 14 : 12;
      const mi = tm ? +tm[2] : 0;
      if (h === 24) h = 12;
      const at = et(+ym[1], +ym[2], +day, h, mi);
      const chair = /\bChair\b/.test(title) && !/Vice Chair/.test(title);
      const impact = meeting ? 3 : /Minutes|Beige Book/i.test(title) ? 2 : /Speech|Testimony|Discussion|Remarks|Conversation|Panel/i.test(title + type) ? (chair ? 3 : /Vice Chair/.test(title) ? 2 : 1) : /Industrial Production/i.test(title) ? 2 : 1;
      out.push({ id: `fed:${at}:${title}`, title, src: "Fed", at, impact, allDay: !tm && !meeting });
    }
    return out;
  } catch {
    return null;
  }
}

let lastGood: { at: number; events: Ev[]; sources: { id: string; ok: boolean }[] } | null = null;

export async function GET() {
  const [a, b, c] = await Promise.all([bls(), bea(), fed()]);
  const now = Date.now();
  const seen = new Set<string>();
  const events = [...(a ?? []), ...(b ?? []), ...(c ?? [])]
    .filter((e) => e.at > now - 18 * 3600_000 && e.at < now + 10 * 86_400_000)
    .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .sort((x, y) => x.at - y.at || y.impact - x.impact);
  const sources = [
    { id: "BLS", ok: !!a },
    { id: "BEA", ok: !!b },
    { id: "Fed", ok: !!c },
  ];
  const headers = { "cache-control": "no-store" };
  if (events.length) {
    lastGood = { at: now, events, sources };
    return Response.json({ ok: true, ...lastGood }, { headers });
  }
  if (lastGood && now - lastGood.at < 12 * 3600_000) return Response.json({ ok: true, stale: true, ...lastGood }, { headers });
  return Response.json({ ok: false, at: now, events: [], sources }, { headers });
}
