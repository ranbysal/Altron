export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * This week's economic releases, from Forex Factory's public weekly calendar feed:
 * time, currency, impact, forecast and previous. The feed doesn't carry released values.
 */
const FEED = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const UA = "Mozilla/5.0 (compatible; AltronWatcher/1.0; +https://altron.capital)";

type Raw = { title?: string; country?: string; date?: string; impact?: string; forecast?: string; previous?: string };
export type CalEvent = { id: string; title: string; ccy: string; at: number; impact: 0 | 1 | 2 | 3; forecast: string; previous: string };

let lastGood: { at: number; events: CalEvent[] } | null = null;

export async function GET() {
  try {
    const res = await fetch(FEED, { headers: { "user-agent": UA, accept: "application/json" }, next: { revalidate: 1800 }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(String(res.status));
    const rows = (await res.json()) as Raw[];
    const events: CalEvent[] = (Array.isArray(rows) ? rows : [])
      .map((r, i) => {
        const at = Date.parse(String(r.date ?? ""));
        const impact = r.impact === "High" ? 3 : r.impact === "Medium" ? 2 : r.impact === "Low" ? 1 : 0;
        return { id: `${at}:${r.country}:${i}`, title: String(r.title ?? "").trim(), ccy: String(r.country ?? "").trim().toUpperCase(), at, impact: impact as CalEvent["impact"], forecast: String(r.forecast ?? "").trim(), previous: String(r.previous ?? "").trim() };
      })
      .filter((e) => e.title && Number.isFinite(e.at))
      .sort((a, b) => a.at - b.at);
    if (!events.length) throw new Error("empty");
    lastGood = { at: Date.now(), events };
    return Response.json({ ok: true, ...lastGood }, { headers: { "cache-control": "no-store" } });
  } catch {
    if (lastGood && Date.now() - lastGood.at < 12 * 3600_000) return Response.json({ ok: true, stale: true, ...lastGood }, { headers: { "cache-control": "no-store" } });
    return Response.json({ ok: false, at: Date.now(), events: [] }, { headers: { "cache-control": "no-store" } });
  }
}
