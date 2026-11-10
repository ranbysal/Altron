import type { Under } from "./instruments";

/**
 * Simulated CME feed for the desk: NQ and ES, correlated, ticking four times a
 * second. History comes in layers so every timeframe has depth:
 *   - one-second bars for the last two hours
 *   - one-minute bars for the last ten days
 *   - thirty-minute bars for the half year before that
 *   - daily bars back to 2019, bridged through the market's real turning points
 * Closed hours (the 5 pm halt and the weekend) leave gaps, as on the exchange.
 * Swap for the Databento stream when it's back.
 */

export type Bar = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

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

const SPEC: Record<
  Under,
  { tick: number; start: number; sigma: number; vol: number; dayVol: number }
> = {
  NQ: { tick: 0.25, start: 24486.25, sigma: 9.5, vol: 950, dayVol: 0.0145 },
  ES: { tick: 0.25, start: 6836.5, sigma: 2.3, vol: 2300, dayVol: 0.0105 },
};

/** Rough turning points of the last few years, so the long views look like the market did. */
const PATH: Record<Under, [string, number][]> = {
  NQ: [
    ["2019-01-02", 6330],
    ["2019-12-31", 8730],
    ["2020-02-19", 9720],
    ["2020-03-20", 6990],
    ["2020-09-02", 12420],
    ["2021-02-12", 13800],
    ["2021-11-19", 16760],
    ["2022-06-16", 11040],
    ["2022-10-13", 10690],
    ["2022-12-28", 10720],
    ["2023-07-19", 16010],
    ["2023-10-26", 14100],
    ["2024-07-10", 21020],
    ["2024-08-05", 17950],
    ["2024-12-16", 22300],
    ["2025-04-07", 17200],
    ["2025-07-28", 23550],
    ["2025-10-29", 26150],
    ["2026-01-15", 25800],
  ],
  ES: [
    ["2019-01-02", 2510],
    ["2019-12-31", 3230],
    ["2020-02-19", 3390],
    ["2020-03-23", 2200],
    ["2020-09-02", 3580],
    ["2021-12-31", 4770],
    ["2022-06-16", 3660],
    ["2022-10-12", 3580],
    ["2023-07-31", 4610],
    ["2023-10-27", 4120],
    ["2024-07-16", 5690],
    ["2024-08-05", 5190],
    ["2024-12-06", 6100],
    ["2025-04-08", 4980],
    ["2025-07-28", 6420],
    ["2025-10-29", 6900],
    ["2026-01-15", 7010],
  ],
};

const SEC = 1000;
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const M1_DAYS = 10;
const M30_DAYS = 200;
const S1_KEEP = 3 * 3600; // seconds of one-second bars kept
const STEP_MS = 250;

function gauss(rnd: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* ------------------------------------------------------------------ */
/* New York time, daylight saving included                             */
/* ------------------------------------------------------------------ */

const dst = new Map<number, [number, number]>();
/** Minutes to add to UTC for New York wall time at `ms`. */
export function nyOffset(ms: number): number {
  const y = new Date(ms).getUTCFullYear();
  let r = dst.get(y);
  if (!r) {
    // second Sunday of March 2:00 EST, first Sunday of November 2:00 EDT
    const mar = new Date(Date.UTC(y, 2, 1)).getUTCDay();
    const nov = new Date(Date.UTC(y, 10, 1)).getUTCDay();
    r = [
      Date.UTC(y, 2, 1 + ((7 - mar) % 7) + 7, 7),
      Date.UTC(y, 10, 1 + ((7 - nov) % 7), 6),
    ];
    dst.set(y, r);
  }
  return ms >= r[0] && ms < r[1] ? -240 : -300;
}

export type NyParts = {
  y: number;
  mo: number;
  d: number;
  wd: number;
  min: number;
  sec: number;
};
export function nyParts(ms: number): NyParts {
  const l = new Date(ms + nyOffset(ms) * MIN);
  return {
    y: l.getUTCFullYear(),
    mo: l.getUTCMonth(),
    d: l.getUTCDate(),
    wd: l.getUTCDay(),
    min: l.getUTCHours() * 60 + l.getUTCMinutes(),
    sec: l.getUTCSeconds(),
  };
}

/** Minutes past midnight in New York, and the weekday (0 = Sunday). */
export function nyClock(ms: number): { min: number; wd: number } {
  const p = nyParts(ms);
  return { min: p.min, wd: p.wd };
}

/** UTC ms for a New York wall-clock time. */
function nyTime(y: number, mo: number, d: number, minutes: number): number {
  const guess = Date.UTC(y, mo, d) + minutes * MIN + 300 * MIN;
  return guess - (nyOffset(guess) + 300) * MIN;
}

/** The trading day a moment belongs to: sessions open at 6 pm New York the evening before. */
export function sessionDay(ms: number): number {
  return Math.floor((ms + nyOffset(ms) * MIN + 6 * HOUR) / DAY);
}

/** CME equity futures: closed 5 to 6 pm each weekday, and from Friday 5 pm to Sunday 6 pm. */
export function isOpen(ms: number): boolean {
  const { min, wd } = nyClock(ms);
  if (wd === 6) return false;
  if (wd === 0) return min >= 1080;
  if (wd === 5) return min < 1020;
  return min < 1020 || min >= 1080;
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

/* ------------------------------------------------------------------ */
/* rolling up bars, kept up to date in place                           */
/* ------------------------------------------------------------------ */

/** First index in `bars` whose time is at or after `t`. */
function lowerBound(bars: Bar[], t: number): number {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** A price the history has to pass through: a fill on the book. */
export type Pin = { t: number; p: number };
/** A stretch the price stayed inside: a trade between its stop and target, before it ended. */
export type Band = { from: number; to: number; lo: number; hi: number };
export type Pins = {
  at?: Partial<Record<Under, Pin[]>>;
  bands?: Partial<Record<Under, Band[]>>;
};

/**
 * Bends generated history so it agrees with the book: each pinned bar closes at the
 * pinned price, the bend fades linearly between pins and to nothing at the last bar,
 * and bars inside a trade stay between its stop and target until the bar it ended in.
 * Works on unsnapped prices; the caller snaps to the tick after.
 */
function pinBars(
  bars: Bar[],
  span: number,
  tick: number,
  pins: Pin[] = [],
  bands: Band[] = [],
) {
  if (bars.length < 2) return;
  const t0 = bars[0].t;
  const tEnd = bars[bars.length - 1].t;
  const at = (t: number) => {
    const i = lowerBound(bars, t + 1) - 1;
    return i >= 0 && t < bars[i].t + span ? i : -1;
  };
  const byBar = new Map<number, Pin[]>();
  for (const p of pins) {
    if (p.t < t0 || p.t >= tEnd) continue; // the live bar is the tape's
    const i = at(p.t);
    if (i < 0) continue;
    const list = byBar.get(i) ?? [];
    list.push(p);
    byBar.set(i, list);
  }
  if (byBar.size) {
    const anchors: { t: number; d: number }[] = [];
    for (const i of [...byBar.keys()].sort((a, b) => a - b)) {
      const ps = byBar.get(i)!.sort((a, b) => a.t - b.t);
      anchors.push({ t: bars[i].t + span, d: ps[ps.length - 1].p - bars[i].c });
    }
    anchors.push({ t: tEnd + span, d: 0 });
    let k = 0;
    const dAt = (t: number) => {
      if (t <= anchors[0].t) return anchors[0].d;
      while (k < anchors.length - 2 && anchors[k + 1].t < t) k++;
      const a = anchors[k];
      const b = anchors[k + 1];
      if (t >= b.t) return b.d;
      return a.d + ((b.d - a.d) * (t - a.t)) / (b.t - a.t);
    };
    for (const b of bars) {
      const dO = dAt(b.t);
      const dC = dAt(b.t + span);
      const o = b.o + dO;
      const c = b.c + dC;
      b.h = Math.max(b.h + Math.max(dO, dC), o, c);
      b.l = Math.min(b.l + Math.min(dO, dC), o, c);
      b.o = o;
      b.c = c;
    }
  }
  for (const band of bands) {
    const i0 = at(band.from);
    const i1 = at(band.to);
    if (i0 < 0 || i1 < 0) continue;
    const lo = band.lo + tick;
    const hi = band.hi - tick;
    if (hi <= lo) continue;
    const fit = (x: number) => Math.min(hi, Math.max(lo, x));
    for (let i = i0; i < i1; i++) {
      const b = bars[i];
      b.o = fit(b.o);
      b.c = fit(b.c);
      b.h = fit(b.h);
      b.l = fit(b.l);
    }
    bars[i1].o = fit(bars[i1].o);
  }
  // every pinned price sits inside its bar
  for (const [i, ps] of byBar) {
    const b = bars[i];
    for (const p of ps) {
      if (p.p > b.h) b.h = p.p;
      if (p.p < b.l) b.l = p.p;
    }
  }
}

/**
 * Buckets source bars by `keyOf`. Only the last bucket is rebuilt as the source
 * grows, and the same object is reused for it, so any array holding it sees the
 * live bar move. Finds its place in the source by time, so trimming the front
 * of the source is harmless.
 */
class Rollup {
  out: Bar[] = [];
  private from = 0; // source index where the last bucket starts
  private len = -1;
  private head = NaN; // source's first bar time when last seen
  constructor(private keyOf: (t: number) => number) {}

  get(src: Bar[]): Bar[] {
    if (!src.length) return this.out;
    if (src.length === this.len && src[0].t === this.head && this.out.length)
      return this.refresh(src);
    const last = this.out.length ? this.out[this.out.length - 1] : null;
    let i = 0;
    let reuse: Bar | null = null;
    if (last) {
      i = lowerBound(src, last.t);
      if (i < src.length && this.keyOf(src[i].t) === this.keyOf(last.t)) {
        reuse = this.out.pop()!;
      } else {
        i = lowerBound(src, last.t + 1);
        while (i < src.length && this.keyOf(src[i].t) === this.keyOf(last.t))
          i++;
      }
    }
    let cur: Bar | null = null;
    let key = NaN;
    for (; i < src.length; i++) {
      const b = src[i];
      const k = this.keyOf(b.t);
      if (!cur || k !== key) {
        if (reuse) {
          cur = reuse;
          cur.t = b.t;
          cur.o = b.o;
          cur.h = b.h;
          cur.l = b.l;
          cur.c = b.c;
          cur.v = b.v;
          reuse = null;
        } else cur = { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
        key = k;
        this.out.push(cur);
        this.from = i;
      } else {
        if (b.h > cur.h) cur.h = b.h;
        if (b.l < cur.l) cur.l = b.l;
        cur.c = b.c;
        cur.v += b.v;
      }
    }
    if (reuse) this.out.push(reuse);
    this.len = src.length;
    this.head = src[0].t;
    return this.out;
  }

  /** Only the source's last bar changed: recompute the last bucket. */
  private refresh(src: Bar[]): Bar[] {
    const cur = this.out[this.out.length - 1];
    let h = -Infinity;
    let l = Infinity;
    let v = 0;
    for (let i = this.from; i < src.length; i++) {
      const b = src[i];
      if (b.h > h) h = b.h;
      if (b.l < l) l = b.l;
      v += b.v;
    }
    cur.h = h;
    cur.l = l;
    cur.c = src[src.length - 1].c;
    cur.v = v;
    return this.out;
  }
}

/* ------------------------------------------------------------------ */
/* the market                                                          */
/* ------------------------------------------------------------------ */

type Series = {
  under: Under;
  tick: number;
  latent: number;
  anchor: number;
  s1: Bar[];
  m1: Bar[];
  m30: Bar[]; // generated, older than m1
  d1: Bar[]; // generated, older than m30
  version: number;
  quote: Quote;
  heat: number; // short-term volatility clustering
};

/** Timeframes the chart can ask for, in seconds. */
export const TF_SECONDS = [1, 30, 60, 300, 900, 1800, 3600, 86400] as const;
export type TfSec = (typeof TF_SECONDS)[number];

export class Market {
  private series: Record<Under, Series>;
  private rnd: () => number;
  private lastStep = 0;
  private rolls = new Map<string, Rollup>();
  private joined = new Map<string, { n: number; bars: Bar[] }>();

  private pins: Pins;

  constructor(endPrices?: Partial<Record<Under, number>>, pins: Pins = {}) {
    this.pins = pins;
    let seed = (Date.now() % 2147483647) | 0;
    this.rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const now = Date.now();
    this.series = {
      NQ: this.build("NQ", now, endPrices?.NQ),
      ES: this.build("ES", now, endPrices?.ES),
    };
    this.lastStep = now;
  }

  private snapper(tick: number) {
    return (x: number) => Math.round(x / tick) * tick;
  }

  /** Ten days of minutes ending at `end`, skipping closed hours. */
  private minutes(under: Under, now: number, end: number): Bar[] {
    const sp = SPEC[under];
    const rnd = this.rnd;
    const bars: Bar[] = [];
    const last = Math.floor(now / MIN) * MIN;
    let p = sp.start;
    let heat = 1;
    const first = Math.floor((last - M1_DAYS * DAY) / (30 * MIN)) * 30 * MIN;
    for (let t = first; t <= last; t += MIN) {
      if (!isOpen(t) && t < last) continue;
      const f = activity(t);
      heat = 0.9 * heat + 0.1 * (0.6 + rnd() * 0.9);
      const sub = (sp.sigma * f * heat) / Math.sqrt(12);
      const o = p;
      let h = p;
      let l = p;
      for (let k = 0; k < 12; k++) {
        p += gauss(rnd) * sub + (sp.start - p) * 0.00008;
        if (p > h) h = p;
        if (p < l) l = p;
      }
      bars.push({
        t,
        o,
        h,
        l,
        c: p,
        v: Math.round(sp.vol * f * heat * Math.exp(gauss(rnd) * 0.35)),
      });
    }
    const shift = end - bars[bars.length - 1].c;
    for (const b of bars) {
      b.o += shift;
      b.h += shift;
      b.l += shift;
      b.c += shift;
    }
    pinBars(
      bars,
      MIN,
      sp.tick,
      this.pins.at?.[under],
      this.pins.bands?.[under],
    );
    const q = this.snapper(sp.tick);
    for (const b of bars) {
      b.o = q(b.o);
      b.h = q(b.h);
      b.l = q(b.l);
      b.c = q(b.c);
      b.h = Math.max(b.h, b.o, b.c);
      b.l = Math.min(b.l, b.o, b.c);
    }
    return bars;
  }

  /** Half a year of thirty-minute bars ending where the minutes begin. */
  private halfHours(under: Under, before: number, end: number): Bar[] {
    const sp = SPEC[under];
    const rnd = this.rnd;
    const rel = sp.sigma / sp.start; // per-minute move, as a share of price
    const bars: Bar[] = [];
    const startT =
      Math.floor((before - M30_DAYS * DAY) / (30 * MIN)) * 30 * MIN;
    let lp = Math.log(end);
    let heat = 1;
    for (let t = startT; t < before - 30 * MIN + 1; t += 30 * MIN) {
      if (!isOpen(t)) continue;
      const f = activity(t);
      heat = 0.85 * heat + 0.15 * (0.6 + rnd() * 1.0);
      const sub = rel * Math.sqrt(3) * f * heat;
      const o = Math.exp(lp);
      let h = o;
      let l = o;
      for (let k = 0; k < 10; k++) {
        lp += gauss(rnd) * sub;
        const x = Math.exp(lp);
        if (x > h) h = x;
        if (x < l) l = x;
      }
      bars.push({
        t,
        o,
        h,
        l,
        c: Math.exp(lp),
        v: Math.round(sp.vol * 30 * f * heat * Math.exp(gauss(rnd) * 0.3)),
      });
    }
    const k = end / bars[bars.length - 1].c;
    for (const b of bars) {
      b.o *= k;
      b.h *= k;
      b.l *= k;
      b.c *= k;
    }
    pinBars(
      bars,
      30 * MIN,
      sp.tick,
      this.pins.at?.[under],
      this.pins.bands?.[under],
    );
    const q = this.snapper(sp.tick);
    for (const b of bars) {
      b.o = q(b.o);
      b.h = q(b.h);
      b.l = q(b.l);
      b.c = q(b.c);
      b.h = Math.max(b.h, b.o, b.c);
      b.l = Math.min(b.l, b.o, b.c);
    }
    return bars;
  }

  /** Daily bars from 2019, bridged between the turning points, ending where the half hours begin. */
  private days(under: Under, before: number, end: number): Bar[] {
    const sp = SPEC[under];
    const rnd = this.rnd;
    const pts = PATH[under].map(([d, p]) => {
      const [y, m, dd] = d.split("-").map(Number);
      return { t: nyTime(y, m - 1, dd, 9 * 60 + 30), p };
    });
    const lastDay = sessionDay(before) - 1;
    const tail = pts.filter((x) => sessionDay(x.t) < lastDay - 5);
    tail.push({ t: before - DAY, p: end });
    // trading days between the first point and the day before `before`
    const days: number[] = [];
    for (let t = tail[0].t; sessionDay(t) <= lastDay; t += DAY) {
      const wd = nyClock(t).wd;
      if (wd !== 0 && wd !== 6) days.push(t);
    }
    const lp: number[] = [];
    let seg = 0;
    for (let i = 0; i < days.length; i++) {
      while (seg < tail.length - 2 && days[i] >= tail[seg + 1].t) seg++;
      lp.push(seg);
    }
    // bridge each segment in log price
    const out: number[] = new Array(days.length);
    let i = 0;
    while (i < days.length) {
      const s = lp[i];
      let j = i;
      while (j < days.length && lp[j] === s) j++;
      const a = Math.log(tail[s].p);
      const b = Math.log(tail[s + 1].p);
      const n = j - i;
      const w: number[] = [0];
      for (let k = 1; k <= n; k++) w.push(w[k - 1] + gauss(rnd) * sp.dayVol);
      for (let k = 0; k < n; k++) {
        const f = (k + 1) / n;
        out[i + k] = a + (b - a) * f + (w[k + 1] - f * w[n]);
      }
      i = j;
    }
    const q = this.snapper(sp.tick);
    const bars: Bar[] = [];
    let prev = tail[0].p;
    for (let k = 0; k < days.length; k++) {
      const c = Math.exp(out[k]);
      const o = prev * Math.exp(gauss(rnd) * sp.dayVol * 0.18);
      const span = Math.abs(gauss(rnd)) * sp.dayVol * 0.55 + sp.dayVol * 0.25;
      const h = Math.max(o, c) * (1 + span * rnd());
      const l = Math.min(o, c) * (1 - span * rnd());
      const move = Math.abs(Math.log(c / prev)) / sp.dayVol;
      const p = nyParts(days[k]);
      bars.push({
        t: nyTime(p.y, p.mo, p.d, -360), // the session opens at 6 pm the evening before
        o: q(o),
        h: q(h),
        l: q(l),
        c: q(c),
        v: Math.round(
          sp.vol * 1380 * (0.7 + 0.6 * move) * Math.exp(gauss(rnd) * 0.25),
        ),
      });
      prev = c;
    }
    for (const b of bars) {
      b.h = Math.max(b.h, b.o, b.c);
      b.l = Math.min(b.l, b.o, b.c);
    }
    return bars;
  }

  /** The last two hours as one-second bars, threaded through each minute's range. */
  private seconds(under: Under, m1: Bar[]): Bar[] {
    const sp = SPEC[under];
    const rnd = this.rnd;
    const q = this.snapper(sp.tick);
    const out: Bar[] = [];
    const from = Math.max(0, m1.length - 121);
    for (let i = from; i < m1.length - 1; i++) {
      const m = m1[i];
      // a bridge from open to close, then stretched to touch the minute's high and low
      const path: number[] = [0];
      for (let k = 1; k <= 60; k++) path.push(path[k - 1] + gauss(rnd));
      const end = path[60];
      for (let k = 0; k <= 60; k++)
        path[k] =
          m.o +
          (m.c - m.o) * (k / 60) +
          (path[k] - (k / 60) * end) * (sp.sigma / 9);
      let hi = 0;
      let lo = 0;
      for (let k = 1; k < 60; k++) {
        if (path[k] > path[hi]) hi = k;
        if (path[k] < path[lo]) lo = k;
      }
      path[hi || 30] = m.h;
      path[lo || 31] = m.l;
      for (let k = 0; k <= 60; k++)
        path[k] = Math.min(m.h, Math.max(m.l, path[k]));
      let left = m.v;
      for (let k = 0; k < 60; k++) {
        const o = q(path[k]);
        const c = q(path[k + 1]);
        const v =
          k === 59
            ? left
            : Math.min(left, Math.round((m.v / 60) * (0.4 + rnd() * 1.2)));
        left -= v;
        out.push({
          t: m.t + k * SEC,
          o,
          h: Math.max(o, c),
          l: Math.min(o, c),
          c,
          v: Math.max(0, v),
        });
      }
    }
    const live = m1[m1.length - 1];
    out.push({
      t: Math.floor(Date.now() / SEC) * SEC,
      o: live.c,
      h: live.c,
      l: live.c,
      c: live.c,
      v: 0,
    });
    return out;
  }

  private build(under: Under, now: number, end?: number): Series {
    const sp = SPEC[under];
    const m1 = this.minutes(under, now, end ?? sp.start);
    const m30 = this.halfHours(under, m1[0].t, m1[0].o);
    const d1 = this.days(under, m30[0].t, m30[0].o);
    const s1 = this.seconds(under, m1);
    const last = m1[m1.length - 1].c;
    const s: Series = {
      under,
      tick: sp.tick,
      latent: last,
      anchor: last,
      s1,
      m1,
      m30,
      d1,
      version: 0,
      heat: 1,
      quote: {
        last,
        bid: last,
        ask: last + sp.tick,
        prev: last,
        hi: last,
        lo: last,
        dir: 0,
        at: now,
      },
    };
    this.sessionStats(s, now);
    return s;
  }

  /** Prior close and session range since the last 6 pm New York open. */
  private sessionStats(s: Series, now: number) {
    const today = sessionDay(now);
    let prev = s.m1[0].c;
    let hi = -Infinity;
    let lo = Infinity;
    for (const b of s.m1) {
      if (sessionDay(b.t) < today) prev = b.c;
      else {
        if (b.h > hi) hi = b.h;
        if (b.l < lo) lo = b.l;
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
    const steps = Math.min(
      40,
      Math.max(0, Math.floor((now - this.lastStep) / STEP_MS)),
    );
    if (!steps) return false;
    for (let k = 0; k < steps; k++) {
      const t = this.lastStep + (k + 1) * STEP_MS;
      const z1 = gauss(this.rnd);
      const z2 = gauss(this.rnd);
      const shocks: Record<Under, number> = {
        NQ: z1,
        ES: 0.86 * z1 + 0.51 * z2,
      };
      for (const under of ["NQ", "ES"] as Under[]) {
        const s = this.series[under];
        const sp = SPEC[under];
        // bursts: volatility clusters, then calms
        s.heat = Math.max(
          0.55,
          Math.min(
            2.6,
            0.985 * s.heat +
              0.015 * (0.7 + Math.abs(shocks[under]) * 0.9) +
              (this.rnd() < 0.0015 ? 0.9 : 0),
          ),
        );
        const sigma =
          (sp.sigma * Math.max(0.8, activity(t)) * s.heat) / Math.sqrt(240);
        s.latent += shocks[under] * sigma + (s.anchor - s.latent) * 0.00004;
        const last = Math.round(s.latent / s.tick) * s.tick;
        const vol = Math.max(
          1,
          Math.round(
            (sp.vol / 240) *
              activity(t) *
              s.heat *
              Math.exp(gauss(this.rnd) * 0.5),
          ),
        );

        let bar = s.m1[s.m1.length - 1];
        const barT = Math.floor(t / MIN) * MIN;
        if (bar.t !== barT) {
          bar = { t: barT, o: bar.c, h: bar.c, l: bar.c, c: bar.c, v: 0 };
          s.m1.push(bar);
          const extra = s.m1.length - (M1_DAYS * 1380 + 900);
          if (extra > 300) s.m1.splice(0, extra);
          if (nyClock(t).min === 1080) this.sessionStats(s, t);
        }
        let sec = s.s1[s.s1.length - 1];
        const secT = Math.floor(t / SEC) * SEC;
        if (sec.t !== secT) {
          sec = { t: secT, o: sec.c, h: sec.c, l: sec.c, c: sec.c, v: 0 };
          s.s1.push(sec);
          const extra = s.s1.length - S1_KEEP;
          if (extra > 600) s.s1.splice(0, extra);
        }
        bar.v += vol;
        sec.v += vol;
        if (last !== s.quote.last) {
          bar.c = last;
          if (last > bar.h) bar.h = last;
          if (last < bar.l) bar.l = last;
          sec.c = last;
          if (last > sec.h) sec.h = last;
          if (last < sec.l) sec.l = last;
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

  private roll(name: string, keyOf: (t: number) => number, src: Bar[]): Bar[] {
    let r = this.rolls.get(name);
    if (!r) {
      r = new Rollup(keyOf);
      this.rolls.set(name, r);
    }
    return r.get(src);
  }

  /** `older` followed by `recent`, rebuilt only when a bar is added. */
  private join(name: string, older: Bar[], recent: Bar[]): Bar[] {
    const hit = this.joined.get(name);
    if (hit && hit.n === recent.length) return hit.bars;
    const cut = recent.length ? recent[0].t : Infinity;
    const bars = older.filter((b) => b.t < cut).concat(recent);
    this.joined.set(name, { n: recent.length, bars });
    return bars;
  }

  /** Bars for a timeframe in seconds. Arrays are reused and updated in place between ticks. */
  bars(under: Under, tf: number): Bar[] {
    const s = this.series[under];
    const bucket = (span: number) => (t: number) => Math.floor(t / span) * span;
    if (tf <= 1) return s.s1;
    if (tf === 30) return this.roll(`${under}:30s`, bucket(30 * SEC), s.s1);
    if (tf === 60) return s.m1;
    if (tf === 300 || tf === 900)
      return this.roll(`${under}:${tf}`, bucket(tf * SEC), s.m1);
    const half = this.join(
      `${under}:30m`,
      s.m30,
      this.roll(`${under}:30m-recent`, bucket(30 * MIN), s.m1),
    );
    if (tf === 1800) return half;
    if (tf === 3600) return this.roll(`${under}:1h`, bucket(HOUR), half);
    return this.join(
      `${under}:1d`,
      s.d1,
      this.roll(`${under}:1d-recent`, sessionDay, half),
    );
  }

  /** Recent one-minute closes for sparklines. */
  closes(under: Under, n: number, every = 5): number[] {
    const b = this.series[under].m1;
    const out: number[] = [];
    for (let i = Math.max(0, b.length - n * every); i < b.length; i += every)
      out.push(b[i].c);
    out.push(b[b.length - 1].c);
    return out;
  }
}
