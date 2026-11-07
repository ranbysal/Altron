import { mulberry32, } from "./noise";
import { toTick } from "./format";

/**
 * Simulated CME feed for the demo desk. Deterministic from a seed so the
 * server render and the first client render match. Replace with the
 * Databento stream once it's connected.
 */

export const POSITION = {
  symbol: "NQZ6",
  side: "LONG" as const,
  size: 2,
  entry: 24476.5,
  stop: 24452,
  target: 24525,
  pointValue: 20,
  entryMinute: 63, // minutes after 09:30 → 10:33
};

export const SETTLE = { NQ: 24386.25, ES: 6818.5 };
export const SESSION_OPEN_MIN = 570; // 09:30 ET

export type Candle = { o: number; h: number; l: number; c: number; t: number };

export type FeedSnapshot = {
  nq: number;
  es: number;
  high: number;
  low: number;
  tick: number;
};

export class FeedSim {
  candles: Candle[] = [];
  nq = 0;
  es = 6842.25;
  private t = 0;
  private ticks = 0;
  private nextT = 80;
  private rnd: () => number;

  constructor(seed = 20261106) {
    this.rnd = mulberry32(seed);
    this.build();
  }

  private build() {
    const rnd = this.rnd;
    const path: [number, number][] = [
      [0, 24438], [14, 24452], [30, 24404], [44, 24446], [52, 24471],
      [57, 24458], [62, 24469], [63, 24477], [72, 24494], [80, 24486],
    ];
    const at = (x: number) => {
      for (let k = 0; k < path.length - 1; k++) {
        if (x <= path[k + 1][0]) {
          const [ax, ay] = path[k];
          const [bx, by] = path[k + 1];
          return ay + ((by - ay) * (x - ax)) / (bx - ax);
        }
      }
      return path[path.length - 1][1];
    };
    let p = 24436;
    for (let i = 0; i < 80; i++) {
      const o = p;
      let h = o;
      let l = o;
      for (let k = 0; k < 10; k++) {
        p = toTick(p + (at(i + k / 10) - p) * 0.32 + (rnd() - 0.5) * 6);
        if (i >= POSITION.entryMinute) p = Math.max(p, 24461);
        h = Math.max(h, p);
        l = Math.min(l, p);
      }
      this.candles.push({ o, h, l, c: p, t: i });
    }
    const e = this.candles[POSITION.entryMinute];
    e.l = Math.min(e.l, 24474.75);
    e.h = Math.max(e.h, 24478.25);
    this.nq = p;
  }

  /** Advance one second of simulated market. */
  step() {
    const rnd = this.rnd;
    const g = () => (rnd() + rnd() + rnd() - 1.5) * 1.4;
    for (let s = 0; s < 2; s++) {
      this.t += 1;
      const m = 24493 + 9 * Math.sin(this.t / 37) + 4 * Math.sin(this.t / 11);
      this.nq = toTick(Math.min(24518, Math.max(24462, this.nq + 0.14 * (m - this.nq) + g() * 1.5)));
      const em = 6842 + 3 * Math.sin(this.t / 41);
      this.es = toTick(this.es + 0.12 * (em - this.es) + g() * 0.45);
      const last = this.candles[this.candles.length - 1];
      last.c = this.nq;
      last.h = Math.max(last.h, this.nq);
      last.l = Math.min(last.l, this.nq);
    }
    this.ticks += 1;
    if (this.ticks % 12 === 0) {
      this.candles.push({ o: this.nq, h: this.nq, l: this.nq, c: this.nq, t: this.nextT++ });
      if (this.candles.length > 90) this.candles.shift();
    }
  }

  snapshot(): FeedSnapshot {
    let high = -Infinity;
    let low = Infinity;
    for (const c of this.candles) {
      high = Math.max(high, c.h);
      low = Math.min(low, c.l);
    }
    return { nq: this.nq, es: this.es, high, low, tick: this.ticks };
  }
}

export function positionStats(price: number) {
  const { entry, stop, target, size, pointValue } = POSITION;
  const pnl = (price - entry) * pointValue * size;
  const r = (price - entry) / (entry - stop);
  const pct = Math.max(0, Math.min(100, ((price - stop) / (target - stop)) * 100));
  const entryPct = ((entry - stop) / (target - stop)) * 100;
  return { pnl, r, pct, entryPct, risk: (entry - stop) * pointValue * size };
}
