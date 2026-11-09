import { mulberry32 } from "./noise";
import { toTick } from "./format";

/**
 * Simulated trade history for Yazan's dashboard: 26 weeks of ES / NQ / MES / MNQ
 * paper trades, deterministic from a seed. Replace with the real journal once
 * fills are recorded.
 */

export type Market = "NQ" | "ES" | "MNQ" | "MES";
export type Side = "LONG" | "SHORT";

export type Trade = {
  id: string;
  day: string; // YYYY-MM-DD
  dayIndex: number; // index into TRADING_DAYS
  minute: number; // minutes from midnight, ET
  mkt: Market;
  side: Side;
  size: number;
  entry: number;
  exit: number;
  stop: number;
  r: number;
  pnl: number;
  risk: number;
  hold: number; // minutes
  note?: string;
};

export const MARKETS: { id: Market; name: string; pv: number }[] = [
  { id: "NQ", name: "E-mini Nasdaq-100", pv: 20 },
  { id: "ES", name: "E-mini S&P 500", pv: 50 },
  { id: "MNQ", name: "Micro E-mini Nasdaq-100", pv: 2 },
  { id: "MES", name: "Micro E-mini S&P 500", pv: 5 },
];

const SPEC: Record<Market, { pv: number; n: [number, number]; stop: [number, number]; w: number }> = {
  NQ: { pv: 20, n: [1, 2], stop: [16, 28], w: 0.44 },
  ES: { pv: 50, n: [1, 3], stop: [4.5, 7.5], w: 0.26 },
  MNQ: { pv: 2, n: [4, 10], stop: [16, 28], w: 0.18 },
  MES: { pv: 5, n: [4, 10], stop: [4.5, 7.5], w: 0.12 },
};

const HOLIDAYS = new Set(["2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07"]);

const NOTES = [
  "Reclaim of the overnight high on volume. Wrong below the 10:15 low.",
  "Faded the open drive back into prior-day value.",
  "Opening range break. Waited for the retest before adding.",
  "Too early. Took it again once the level held.",
  "Trend day. Added on the first pullback to VWAP.",
  "Stopped at entry after the data print.",
  "VWAP reclaim with breadth behind it.",
  "Held through the chop, paid at the prior high.",
  "Failed auction at the highs, short back to the mid.",
  "Range day. Took the edges and stayed small.",
  "Gap fill played out. Out before lunch.",
  "Lower highs into the close, trailed it out.",
  "Chased. Sized down and respected the stop.",
  "Rejection at the weekly level, clean short.",
];

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Weekday sessions from Mon May 11 to Fri Nov 6, 2026, minus exchange holidays. */
export const TRADING_DAYS: string[] = (() => {
  const out: string[] = [];
  const d = new Date(Date.UTC(2026, 4, 11));
  const end = Date.UTC(2026, 10, 6);
  while (d.getTime() <= end) {
    const wd = d.getUTCDay();
    const s = iso(d);
    if (wd >= 1 && wd <= 5 && !HOLIDAYS.has(s)) out.push(s);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
})();

export const CALENDAR_START = "2026-05-11";
export const CALENDAR_WEEKS = 26;

function build(): Trade[] {
  const rnd = mulberry32(84213);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const between = (a: number, b: number) => a + (b - a) * rnd();
  const trades: Trade[] = [];
  const n = TRADING_DAYS.length;

  // daily index levels with drift, so prices read right for the date
  const nq: number[] = [];
  const es: number[] = [];
  let pn = 21780;
  let pe = 5945;
  for (let i = 0; i < n; i++) {
    const shock = (rnd() + rnd() + rnd() - 1.5) * 0.011;
    const drift = (24430 / 21780) ** (1 / n) - 1;
    pn *= 1 + drift + shock;
    pe *= 1 + drift * 0.82 + shock * 0.78 + (rnd() - 0.5) * 0.002;
    nq.push(pn);
    es.push(pe);
  }
  // pull the last day onto the live levels
  const kN = 24412 / nq[n - 1];
  const kE = 6829 / es[n - 1];
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    nq[i] *= 1 + (kN - 1) * f;
    es[i] *= 1 + (kE - 1) * f;
  }

  for (let di = 0; di < n; di++) {
    const day = TRADING_DAYS[di];
    // good and bad stretches, so the curve has real drawdowns in it
    const regime = 0.1 * Math.sin(di / 9) + 0.05 * Math.sin(di / 3.1 + 1.3) - (di > 60 && di < 74 ? 0.17 : 0) + (di > 100 ? 0.06 : 0);
    const u = rnd();
    const count = u < 0.1 ? 0 : u < 0.36 ? 1 : u < 0.7 ? 2 : u < 0.9 ? 3 : 4;
    let minute = 570 + Math.floor(between(1, 48));
    for (let k = 0; k < count; k++) {
      const w = rnd();
      let acc = 0;
      let mkt: Market = "NQ";
      for (const m of ["NQ", "ES", "MNQ", "MES"] as Market[]) {
        acc += SPEC[m].w;
        if (w <= acc) {
          mkt = m;
          break;
        }
      }
      const sp = SPEC[mkt];
      const side: Side = rnd() < 0.56 ? "LONG" : "SHORT";
      const dir = side === "LONG" ? 1 : -1;
      const size = Math.round(between(sp.n[0], sp.n[1] + 0.49));
      const stopPts = toTick(between(sp.stop[0], sp.stop[1]));
      const base = mkt === "NQ" || mkt === "MNQ" ? nq[di] : es[di];
      const entry = toTick(base * (1 + (rnd() - 0.5) * 0.008));

      const o = rnd();
      const pWin = 0.53 + regime;
      let r: number;
      if (o < pWin) r = 0.7 + 2.5 * Math.pow(rnd(), 1.7);
      else if (o < pWin + 0.06) r = (rnd() - 0.5) * 0.3;
      else r = rnd() < 0.72 ? -1 : -(0.45 + 0.5 * rnd());
      const exit = toTick(entry + dir * r * stopPts);
      const pts = (exit - entry) * dir;
      const realR = pts / stopPts;
      const hold = Math.round(realR > 0.2 ? 6 + 74 * Math.pow(rnd(), 1.4) : 2 + 32 * rnd());

      trades.push({
        id: `${day.replace(/-/g, "")}-${k + 1}`,
        day,
        dayIndex: di,
        minute,
        mkt,
        side,
        size,
        entry,
        exit,
        stop: toTick(entry - dir * stopPts),
        r: realR,
        pnl: pts * sp.pv * size,
        risk: stopPts * sp.pv * size,
        hold,
        note: rnd() < 0.42 ? pick(NOTES) : undefined,
      });
      // most of the book happens in the first hour and a half
      minute += hold + Math.floor(rnd() < 0.5 ? between(6, 45) : between(45, 210));
      if (minute > 950) break;
    }
  }
  return trades;
}

export const TRADES: Trade[] = build();
export const LAST_DAY = TRADING_DAYS[TRADING_DAYS.length - 1];

export type Period = "1W" | "1M" | "3M" | "6M";
export const PERIODS: { id: Period; label: string; days: number; long: string }[] = [
  { id: "1W", label: "1W", days: 5, long: "This week" },
  { id: "1M", label: "1M", days: 21, long: "1 month" },
  { id: "3M", label: "3M", days: 63, long: "3 months" },
  { id: "6M", label: "6M", days: 9999, long: "6 months" },
];

export function periodStartIndex(p: Period): number {
  const days = PERIODS.find((x) => x.id === p)!.days;
  return Math.max(0, TRADING_DAYS.length - days);
}

export function tradesFor(p: Period): Trade[] {
  const start = periodStartIndex(p);
  return TRADES.filter((t) => t.dayIndex >= start);
}

export type Stats = ReturnType<typeof computeStats>;

export function computeStats(ts: Trade[]) {
  const wins = ts.filter((t) => t.r > 0.2);
  const losses = ts.filter((t) => t.r < -0.2);
  const flat = ts.length - wins.length - losses.length;
  const grossWin = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = -losses.reduce((a, t) => a + t.pnl, 0);
  const net = ts.reduce((a, t) => a + t.pnl, 0);
  const totalR = ts.reduce((a, t) => a + t.r, 0);

  // equity by trade, with the underwater curve
  let eq = 0;
  let peak = 0;
  let maxDD = 0;
  let ddFrom = 0;
  let ddTo = 0;
  let peakAt = 0;
  const curve: { eq: number; dd: number }[] = [{ eq: 0, dd: 0 }];
  ts.forEach((t, i) => {
    eq += t.pnl;
    if (eq > peak) {
      peak = eq;
      peakAt = i + 1;
    }
    const dd = eq - peak;
    if (dd < maxDD) {
      maxDD = dd;
      ddFrom = peakAt;
      ddTo = i + 1;
    }
    curve.push({ eq, dd });
  });
  const recovered = curve.slice(ddTo).some((c) => c.dd === 0);

  // rolling profit factor over the last 20 trades, and cumulative R
  const rollPF: number[] = [];
  const cumR: number[] = [];
  let rr = 0;
  ts.forEach((t, i) => {
    rr += t.r;
    cumR.push(rr);
    const win = ts.slice(Math.max(0, i - 19), i + 1);
    const gw = win.filter((x) => x.pnl > 0).reduce((a, x) => a + x.pnl, 0);
    const gl = -win.filter((x) => x.pnl < 0).reduce((a, x) => a + x.pnl, 0);
    rollPF.push(gl ? Math.min(6, gw / gl) : 6);
  });

  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    count: ts.length,
    wins: wins.length,
    losses: losses.length,
    flat,
    winRate: ts.length ? wins.length / ts.length : 0,
    grossWin,
    grossLoss,
    pf: grossLoss ? grossWin / grossLoss : 0,
    net,
    totalR,
    expectancy: ts.length ? totalR / ts.length : 0,
    avgWinR: avg(wins.map((t) => t.r)),
    avgLossR: avg(losses.map((t) => t.r)),
    avgHold: avg(ts.map((t) => t.hold)),
    maxDD,
    ddFrom: ts[Math.max(0, ddFrom - 1)]?.day,
    ddTo: ts[Math.max(0, ddTo - 1)]?.day,
    recovered,
    curve,
    rollPF,
    cumR,
  };
}

export function dailyPnl(): Map<string, { pnl: number; trades: number; r: number }> {
  const m = new Map<string, { pnl: number; trades: number; r: number }>();
  for (const t of TRADES) {
    const d = m.get(t.day) ?? { pnl: 0, trades: 0, r: 0 };
    d.pnl += t.pnl;
    d.trades += 1;
    d.r += t.r;
    m.set(t.day, d);
  }
  return m;
}

export function byMarket(ts: Trade[]) {
  return MARKETS.map((m) => {
    const xs = ts.filter((t) => t.mkt === m.id);
    let eq = 0;
    const curve = [0, ...xs.map((t) => (eq += t.pnl))];
    const wins = xs.filter((t) => t.r > 0.2).length;
    return {
      ...m,
      trades: xs.length,
      winRate: xs.length ? wins / xs.length : 0,
      net: xs.reduce((a, t) => a + t.pnl, 0),
      avgR: xs.length ? xs.reduce((a, t) => a + t.r, 0) / xs.length : 0,
      curve,
    };
  });
}

/** Half-hour buckets across the regular session. */
export function bySession(ts: Trade[]) {
  const slots = Array.from({ length: 13 }, (_, i) => ({ start: 570 + i * 30, trades: 0, wins: 0, losses: 0, net: 0 }));
  for (const t of ts) {
    const i = Math.min(12, Math.max(0, Math.floor((t.minute - 570) / 30)));
    const s = slots[i];
    s.trades += 1;
    s.net += t.pnl;
    if (t.r > 0.2) s.wins += 1;
    else if (t.r < -0.2) s.losses += 1;
  }
  return slots;
}

export function dayLabel(day: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}
