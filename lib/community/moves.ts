import type { Under } from "@/lib/desk/instruments";
import type { Bar, Market } from "@/lib/desk/market";
import { fmt } from "@/lib/format";

/**
 * Significant moves in the futures the desk follows, read off the same feed as the chart:
 * fast pushes that stand well clear of the session's usual pace, and the session's extremes.
 */

export type Move = { id: string; under: Under; at: number; kind: "push" | "high" | "low"; text: string; delta: number; pct: number };
export type Session = { under: Under; bars: Bar[]; open: number; last: number; hi: number; lo: number; hiAt: number; loAt: number; line: number[]; t0: number; t1: number };

export function sessionOf(m: Market, under: Under, since: number): Session | null {
  const all = m.bars(under, 60);
  let i = all.length;
  while (i > 0 && all[i - 1].t >= since) i--;
  const bars = all.slice(i);
  if (bars.length < 2) return null;
  let hi = -Infinity;
  let lo = Infinity;
  let hiAt = 0;
  let loAt = 0;
  for (const b of bars) {
    if (b.h > hi) {
      hi = b.h;
      hiAt = b.t;
    }
    if (b.l < lo) {
      lo = b.l;
      loAt = b.t;
    }
  }
  // a line of at most ~180 points for the small session chart
  const step = Math.max(1, Math.ceil(bars.length / 180));
  const line: number[] = [];
  for (let k = 0; k < bars.length; k += step) line.push(bars[Math.min(bars.length - 1, k + step - 1)].c);
  if (line[line.length - 1] !== bars[bars.length - 1].c) line.push(bars[bars.length - 1].c);
  return { under, bars, open: bars[0].o, last: bars[bars.length - 1].c, hi, lo, hiAt, loAt, line, t0: bars[0].t, t1: bars[bars.length - 1].t };
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** Pushes over 15 and 5 minutes that are several times the session's typical move for that span. */
export function movesOf(s: Session): Move[] {
  const { bars, under } = s;
  const out: Move[] = [];
  const taken: [number, number][] = [];
  for (const w of [15, 5]) {
    if (bars.length <= w + 5) continue;
    const d: number[] = [];
    for (let i = w; i < bars.length; i++) d.push(bars[i].c - bars[i - w].c);
    const typical = median(d.map(Math.abs).filter((x) => x > 0));
    if (!typical) continue;
    const order = d.map((x, k) => ({ x, i: k + w })).filter((c) => Math.abs(c.x) >= typical * 3.4).sort((a, b) => Math.abs(b.x) - Math.abs(a.x));
    let kept = 0;
    for (const c of order) {
      if (kept >= 4) break;
      const span: [number, number] = [c.i - w, c.i];
      if (taken.some(([a, b]) => span[0] < b && span[1] > a)) continue;
      taken.push(span);
      kept++;
      const from = bars[c.i - w].c;
      out.push({ id: `${under}-${w}-${bars[c.i].t}`, under, at: bars[c.i].t + 60_000, kind: "push", text: `${c.x > 0 ? "Up" : "Down"} ${fmt(Math.abs(c.x))} in ${w} minutes`, delta: c.x, pct: (c.x / from) * 100 });
    }
  }
  out.push({ id: `${under}-hi-${s.hiAt}`, under, at: s.hiAt + 60_000, kind: "high", text: `Session high ${fmt(s.hi)}`, delta: s.hi - s.open, pct: ((s.hi - s.open) / s.open) * 100 });
  out.push({ id: `${under}-lo-${s.loAt}`, under, at: s.loAt + 60_000, kind: "low", text: `Session low ${fmt(s.lo)}`, delta: s.lo - s.open, pct: ((s.lo - s.open) / s.open) * 100 });
  return out;
}
