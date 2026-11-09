import type { Under } from "./instruments";

/**
 * Simulated CME feed for the desk: NQ and ES, correlated, ticking four times a
 * second, with two days of one-minute history shaped by the New York session
 * (busy at the open and close, quiet at lunch and overnight). Swap for the
 * Databento stream when it's back.
 */

export type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };

export type Quote = {
  last: number;
  bid: number;
  ask: number;
  prev: number; // prior session close
  hi: number; // session high
  lo: number; // session low
  dir: 1 | -1 | 0; // direction of the last change
  at: number;
};

const SPEC: Record<Under, { tick: number; start: number; sigma: number; vol: number }> = {
  NQ: { tick: 0.25, start: 24486.25, sigma: 9.5, vol: 950 },
  ES: { tick: 0.25, start: 6836.5, sigma: 2.3, vol: 2300 },
};

const MIN = 60_000;
const HISTORY = 2 * 24 * 60; // two days of one-minute bars
const STEP_MS = 250;

function gauss(rnd: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Minutes past midnight in New York, and the weekday (0 = Sunday). */
let nyOffset: number | null = null;
export function nyClock(ms: number): { min: number; wd: number } {
  if (nyOffset === null) {
    const d = new Date(ms);
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
        .formatToParts(d)
        .map((p) => [p.type, p.value]),
    );
    const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute);
    nyOffset = Math.round((wall - Math.floor(ms / MIN) * MIN) / MIN);
  }
  const local = new Date(ms + nyOffset * MIN);
  return { min: local.getUTCHours() * 60 + local.getUTCMinutes(), wd: local.getUTCDay() };
}

/** How lively the tape is at a given New York time. */
function activity(ms: number): number {
  const { min } = nyClock(ms);
  if (min >= 570 && min < 630) return 1.9;
  if (min >= 630 && min < 690) return 1.3;
  if (min >= 690 && min < 840) return 0.85;
  if (min >= 840 && min < 930) return 1.05;
  if (min >= 930 && min < 960) return 1.45;
  if (min >= 510 && min < 525) return 1.5; // 8:30 data
  if (min >= 960 && min < 1080) return 0.6;
  if (min >= 180 && min < 270) return 0.95; // Europe opens
  return 0.7;
}

type Series = {
  under: Under;
  tick: number;
  latent: number;
  anchor: number;
  bars: Bar[];
  version: number;
  quote: Quote;
  heat: number; // short-term volatility clustering
};

export class Market {
  private series: Record<Under, Series>;
  private rnd: () => number;
  private cache = new Map<string, { key: string; bars: Bar[] }>();
  private lastStep = 0;

  constructor(endPrices?: Partial<Record<Under, number>>) {
    let seed = (Date.now() % 2147483647) | 0;
    this.rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const now = Date.now();
    this.series = {
      NQ: this.history("NQ", now, endPrices?.NQ),
      ES: this.history("ES", now, endPrices?.ES),
    };
    this.lastStep = now;
  }

  private history(under: Under, now: number, end?: number): Series {
    const sp = SPEC[under];
    const rnd = this.rnd;
    const bars: Bar[] = [];
    const first = Math.floor(now / MIN) * MIN - (HISTORY - 1) * MIN;
    let p = sp.start;
    let heat = 1;
    for (let i = 0; i < HISTORY; i++) {
      const t = first + i * MIN;
      const f = activity(t);
      heat = 0.9 * heat + 0.1 * (0.6 + rnd() * 0.9);
      const sub = (sp.sigma * f * heat) / Math.sqrt(12);
      const o = p;
      let h = p;
      let l = p;
      for (let k = 0; k < 12; k++) {
        p += gauss(rnd) * sub + (sp.start - p) * 0.0006;
        h = Math.max(h, p);
        l = Math.min(l, p);
      }
      bars.push({ t, o, h, l, c: p, v: Math.round(sp.vol * f * heat * Math.exp(gauss(rnd) * 0.35)) });
    }
    // land the last bar on the requested price, then snap to ticks
    const shift = (end ?? sp.start) - bars[bars.length - 1].c;
    const q = (x: number) => Math.round(x / sp.tick) * sp.tick;
    for (const b of bars) {
      b.o = q(b.o + shift);
      b.h = q(b.h + shift);
      b.l = q(b.l + shift);
      b.c = q(b.c + shift);
      b.h = Math.max(b.h, b.o, b.c);
      b.l = Math.min(b.l, b.o, b.c);
    }
    const last = bars[bars.length - 1].c;
    const s: Series = {
      under,
      tick: sp.tick,
      latent: last,
      anchor: last,
      bars,
      version: 0,
      heat: 1,
      quote: { last, bid: last, ask: last + sp.tick, prev: last, hi: last, lo: last, dir: 0, at: now },
    };
    this.sessionStats(s, now);
    return s;
  }

  /** Prior close and session range since the last 6 pm New York open. */
  private sessionStats(s: Series, now: number) {
    const { min } = nyClock(now);
    const sinceOpen = (min - 1080 + 1440) % 1440;
    const startT = Math.floor(now / MIN) * MIN - sinceOpen * MIN;
    let prev = s.bars[0].c;
    let hi = -Infinity;
    let lo = Infinity;
    for (const b of s.bars) {
      if (b.t < startT) prev = b.c;
      else {
        hi = Math.max(hi, b.h);
        lo = Math.min(lo, b.l);
      }
    }
    if (!Number.isFinite(hi)) {
      hi = s.quote.last;
      lo = s.quote.last;
    }
    s.quote = { ...s.quote, prev, hi, lo };
  }

  /** Advance the tape to `now`. Returns true if any price changed. */
  step(now: number): boolean {
    let changed = false;
    // after a long sleep (hidden tab), pick the tape up again instead of racing through it
    if (now - this.lastStep > 20_000) this.lastStep = now - 20_000;
    const steps = Math.min(40, Math.max(0, Math.floor((now - this.lastStep) / STEP_MS)));
    if (!steps) return false;
    for (let k = 0; k < steps; k++) {
      const t = this.lastStep + (k + 1) * STEP_MS;
      const z1 = gauss(this.rnd);
      const z2 = gauss(this.rnd);
      const shocks: Record<Under, number> = { NQ: z1, ES: 0.86 * z1 + 0.51 * z2 };
      for (const under of ["NQ", "ES"] as Under[]) {
        const s = this.series[under];
        const sp = SPEC[under];
        // bursts: volatility clusters, then calms
        s.heat = Math.max(0.55, Math.min(2.6, 0.985 * s.heat + 0.015 * (0.7 + Math.abs(shocks[under]) * 0.9) + (this.rnd() < 0.0015 ? 0.9 : 0)));
        const sigma = (sp.sigma * Math.max(0.8, activity(t)) * s.heat) / Math.sqrt(240);
        s.latent += shocks[under] * sigma + (s.anchor - s.latent) * 0.00004;
        const last = Math.round(s.latent / s.tick) * s.tick;
        const vol = Math.max(1, Math.round((sp.vol / 240) * activity(t) * s.heat * Math.exp(gauss(this.rnd) * 0.5)));
        const barT = Math.floor(t / MIN) * MIN;
        let bar = s.bars[s.bars.length - 1];
        if (bar.t !== barT) {
          bar = { t: barT, o: bar.c, h: bar.c, l: bar.c, c: bar.c, v: 0 };
          s.bars.push(bar);
          if (s.bars.length > HISTORY + 600) s.bars.splice(0, s.bars.length - HISTORY);
          if (nyClock(t).min === 1080) this.sessionStats(s, t);
        }
        bar.v += vol;
        if (last !== s.quote.last) {
          bar.c = last;
          bar.h = Math.max(bar.h, last);
          bar.l = Math.min(bar.l, last);
          s.quote = {
            ...s.quote,
            last,
            bid: last,
            ask: last + s.tick,
            hi: Math.max(s.quote.hi, last),
            lo: Math.min(s.quote.lo, last),
            dir: last > s.quote.last ? 1 : -1,
            at: t,
          };
          changed = true;
        }
        s.version++;
      }
    }
    this.lastStep += steps * STEP_MS;
    return changed;
  }

  quote(under: Under): Quote {
    return this.series[under].quote;
  }

  version(under: Under): number {
    return this.series[under].version;
  }

  /** Bars for a timeframe in minutes. Closed bars are cached; the live bar is rebuilt. */
  bars(under: Under, tf: number): Bar[] {
    const s = this.series[under];
    if (tf === 1) return s.bars;
    const key = `${s.bars[0].t}:${s.bars.length}:${s.version}`;
    const hit = this.cache.get(`${under}${tf}`);
    if (hit && hit.key === key) return hit.bars;
    const out: Bar[] = [];
    let cur: Bar | null = null;
    const span = tf * MIN;
    for (const b of s.bars) {
      const k = Math.floor(b.t / span) * span;
      if (!cur || cur.t !== k) {
        cur = { t: k, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
        out.push(cur);
      } else {
        cur.h = Math.max(cur.h, b.h);
        cur.l = Math.min(cur.l, b.l);
        cur.c = b.c;
        cur.v += b.v;
      }
    }
    this.cache.set(`${under}${tf}`, { key, bars: out });
    return out;
  }

  /** Recent closes for sparklines. */
  closes(under: Under, n: number, every = 5): number[] {
    const b = this.series[under].bars;
    const out: number[] = [];
    for (let i = Math.max(0, b.length - n * every); i < b.length; i += every) out.push(b[i].c);
    out.push(b[b.length - 1].c);
    return out;
  }
}
