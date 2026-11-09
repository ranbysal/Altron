import { fmt } from "@/lib/format";
import { nyOffset, nyParts, sessionDay, type Bar } from "@/lib/desk/market";
import { FIB, type Drawing, type Pt } from "@/lib/desk/drawings";
import { BAYER4 } from "@/lib/noise";

/* ------------------------------------------------------------------ */
/* geometry                                                            */
/* ------------------------------------------------------------------ */

export const AXIS_W = 80;
export const TIME_H = 26;
export const RIGHT_PAD = 8; // empty bars ahead of the live candle, so it never meets the edge
export const VOL_FRAC = 0.14;
export const MIN_BW = 0.3;
export const MAX_BW = 48;
export const DEFAULT_BW = 9;

/** Everything a frame needs to turn bars and prices into pixels. */
export type Frame = {
  W: number;
  H: number;
  plotW: number;
  plotH: number;
  pTop: number;
  pBot: number;
  volTop: number;
  bw: number;
  pad: number; // empty bars ahead of the newest, at least RIGHT_PAD and never under ~28px
  L: number; // index of the bar at the right edge, before the padding
  lo: number;
  hi: number;
  log: boolean;
  bars: Bar[];
  dur: number; // ms per bar
  first: number;
  last: number;
};

export function xOf(f: Frame, i: number): number {
  return f.plotW - (f.pad + (f.L - i) + 0.5) * f.bw;
}
export function iOfX(f: Frame, x: number): number {
  return f.L - ((f.plotW - x) / f.bw - f.pad - 0.5);
}
export const padBars = (bw: number) => Math.max(RIGHT_PAD, 28 / bw);
export function yOf(f: Frame, p: number): number {
  if (f.log) {
    const a = Math.log(f.hi);
    const b = Math.log(f.lo);
    return f.pTop + ((a - Math.log(Math.max(p, 1e-9))) / (a - b)) * (f.pBot - f.pTop);
  }
  return f.pTop + ((f.hi - p) / (f.hi - f.lo)) * (f.pBot - f.pTop);
}
export function pOfY(f: Frame, y: number): number {
  const k = (y - f.pTop) / (f.pBot - f.pTop);
  if (f.log) return Math.exp(Math.log(f.hi) - k * (Math.log(f.hi) - Math.log(f.lo)));
  return f.hi - k * (f.hi - f.lo);
}

/** Fractional bar index for a moment, extrapolating past either end. */
export function idxOfTime(f: Frame, t: number): number {
  const b = f.bars;
  const n = b.length;
  if (!n) return 0;
  if (t >= b[n - 1].t) return n - 1 + (t - b[n - 1].t) / f.dur;
  if (t < b[0].t) return (t - b[0].t) / f.dur;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (b[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo + Math.min(0.999, (t - b[lo].t) / f.dur);
}
/** The moment at a bar index, snapped to the bar. */
export function timeOfIdx(f: Frame, i: number): number {
  const b = f.bars;
  const n = b.length;
  const k = Math.round(i);
  if (k >= n) return b[n - 1].t + (k - (n - 1)) * f.dur;
  if (k < 0) return b[0].t + k * f.dur;
  return b[k].t;
}
export const xOfTime = (f: Frame, t: number) => xOf(f, idxOfTime(f, t));
/** A moment between bars, for freehand strokes. */
export function timeAtX(f: Frame, x: number): number {
  const i = iOfX(f, x);
  const k = Math.floor(i);
  return timeOfIdx(f, k) + (i - k) * f.dur;
}

/* ------------------------------------------------------------------ */
/* labels                                                              */
/* ------------------------------------------------------------------ */

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function clock12(min: number, sec?: number): string {
  const h = Math.floor(min / 60);
  const s = sec === undefined ? "" : `:${String(sec).padStart(2, "0")}`;
  return `${h % 12 || 12}:${String(min % 60).padStart(2, "0")}${s}`;
}

/** The date a bar trades on: daily bars start at 6 pm the evening before. */
const dateOf = (t: number, daily: boolean) => nyParts(daily ? t + 6 * 3_600_000 : t);

/** Full time for the crosshair and the legend. */
export function fullTime(t: number, tfSec: number): string {
  const daily = tfSec >= 86400;
  const p = dateOf(t, daily);
  const date = `${WD[p.wd]} ${p.d} ${MON[p.mo]}${daily ? ` ${p.y}` : ""}`;
  if (daily) return date;
  const h = Math.floor(p.min / 60);
  return `${date} · ${clock12(p.min, tfSec < 60 ? p.sec : undefined)} ${h < 12 ? "AM" : "PM"}`;
}

const STEPS = [1, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 14400, 21600, 43200];

/** Where to put time labels: on round times, dates, months or years, depending on zoom. */
export function timeTicks(f: Frame, tfSec: number): { x: number; text: string; strong: boolean }[] {
  const daily = tfSec >= 86400;
  const perBar = daily ? 86400 * 1.45 : tfSec;
  const need = (92 / f.bw) * perBar;
  const out: { x: number; text: string; strong: boolean }[] = [];
  let lastX = -Infinity;
  let prev: ReturnType<typeof nyParts> | null = null;
  const from = Math.max(0, f.first - 1);
  const mode = need <= 43200 && !daily ? "intra" : need <= 86400 * 2.2 ? "day" : need <= 86400 * 9 ? "week" : need <= 86400 * 40 ? "month" : need <= 86400 * 120 ? "quarter" : "year";
  const step = STEPS.find((s) => s >= need) ?? 43200;
  let prevKey = NaN;
  for (let i = from; i <= f.last; i++) {
    const b = f.bars[i];
    if (!b) continue;
    const p = dateOf(b.t, daily);
    let key: number;
    if (mode === "intra") key = Math.floor((b.t / 1000 + nyOffset(b.t) * 60) / step);
    else if (mode === "day") key = daily ? Math.floor(b.t / 86_400_000) : sessionDay(b.t);
    else if (mode === "week") key = Math.floor(((daily ? Math.floor((b.t + 6 * 3_600_000) / 86_400_000) : sessionDay(b.t)) + 3) / 7);
    else if (mode === "month") key = p.y * 12 + p.mo;
    else if (mode === "quarter") key = p.y * 4 + Math.floor(p.mo / 3);
    else key = p.y;
    if (i === from) {
      prevKey = key;
      prev = p;
      continue;
    }
    if (key !== prevKey) {
      const x = xOf(f, i);
      if (x > 24 && x < f.plotW - 24 && x - lastX > 64) {
        const newYear = prev !== null && p.y !== prev.y;
        const newMonth = prev !== null && (p.mo !== prev.mo || newYear);
        const newDay = prev !== null && (p.d !== prev.d || newMonth);
        let text: string;
        let strong = false;
        if (mode === "intra") {
          if (newDay) {
            text = `${WD[p.wd]} ${p.d}`;
            strong = true;
          } else text = clock12(p.min, step < 60 ? p.sec : undefined);
        } else if (newYear) {
          text = String(p.y);
          strong = true;
        } else if (newMonth && mode !== "day" && mode !== "week") text = MON[p.mo];
        else if (newMonth) {
          text = MON[p.mo];
          strong = true;
        } else text = mode === "week" ? `${MON[p.mo]} ${p.d}` : String(p.d);
        out.push({ x, text, strong });
        lastX = x;
      }
      prevKey = key;
    }
    prev = p;
  }
  return out;
}

const PRICE_STEPS = [0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];
export function priceStep(lo: number, hi: number, px: number): number {
  const raw = ((hi - lo) / Math.max(1, px)) * 46;
  return PRICE_STEPS.find((x) => x >= raw) ?? 10000;
}

/* ------------------------------------------------------------------ */
/* drawing the user's drawings                                         */
/* ------------------------------------------------------------------ */

export type Ink = { line: string; fill: string; text: string; dim: string; pos: string; neg: string; bg: string; sans: string; mono: string; b1: string; b2: string };

const pt = (f: Frame, a: Pt) => ({ x: xOfTime(f, a.t), y: yOf(f, a.p) });

/** Extends a segment from a through b to the edge of the plot. */
function extend(f: Frame, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) < 1e-6) return { x: b.x, y: dy > 0 ? f.plotH : 0 };
  const tx = dx > 0 ? (f.plotW - a.x) / dx : -a.x / dx;
  return { x: a.x + dx * tx, y: a.y + dy * tx };
}

export function paintDrawing(ctx: CanvasRenderingContext2D, f: Frame, d: Drawing, ink: Ink, hot = false) {
  ctx.save();
  ctx.lineWidth = hot ? 2 : 1.4;
  ctx.strokeStyle = ink.line;
  ctx.fillStyle = ink.line;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  switch (d.kind) {
    case "trend":
    case "ray": {
      const a = pt(f, d.a);
      const b = pt(f, d.b);
      const e = d.kind === "ray" ? extend(f, a, b) : b;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(e.x, e.y);
      ctx.stroke();
      break;
    }
    case "hline": {
      const y = Math.round(yOf(f, d.a.p)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(f.plotW, y);
      ctx.stroke();
      break;
    }
    case "vline": {
      const x = Math.round(xOfTime(f, d.a.t)) + 0.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, f.plotH);
      ctx.stroke();
      break;
    }
    case "rect": {
      const a = pt(f, d.a);
      const b = pt(f, d.b);
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      ctx.fillStyle = ink.fill;
      ctx.fillRect(x, y, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(Math.abs(b.x - a.x)), Math.round(Math.abs(b.y - a.y)));
      break;
    }
    case "fib": {
      const a = pt(f, d.a);
      const b = pt(f, d.b);
      const x0 = Math.min(a.x, b.x);
      const x1 = Math.max(a.x, b.x);
      const lv = (r: number) => d.b.p + (d.a.p - d.b.p) * r;
      // the golden pocket, softly filled
      const y382 = yOf(f, lv(0.382));
      const y618 = yOf(f, lv(0.618));
      ctx.fillStyle = ink.fill;
      ctx.fillRect(x0, Math.min(y382, y618), x1 - x0, Math.abs(y618 - y382));
      ctx.font = `10px ${ink.mono}`;
      ctx.textBaseline = "bottom";
      for (const r of FIB) {
        const y = Math.round(yOf(f, lv(r))) + 0.5;
        ctx.globalAlpha = r === 0 || r === 1 ? 1 : 0.65;
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = ink.dim;
        ctx.fillText(`${r} (${fmt(lv(r))})`, x0 + 4, y - 2);
      }
      ctx.setLineDash([3, 4]);
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      break;
    }
    case "brush": {
      if (d.pts.length < 2) break;
      ctx.lineWidth = hot ? 2.4 : 1.8;
      ctx.beginPath();
      d.pts.forEach((q, i) => {
        const p = pt(f, q);
        if (i) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
      });
      ctx.stroke();
      break;
    }
    case "text": {
      const p = pt(f, d.a);
      ctx.font = `500 13px ${ink.sans}`;
      ctx.textBaseline = "middle";
      const w = ctx.measureText(d.text).width;
      ctx.fillStyle = ink.bg;
      ctx.globalAlpha = 0.86;
      ctx.fillRect(p.x - 4, p.y - 11, w + 8, 22);
      ctx.globalAlpha = 1;
      if (hot) ctx.strokeRect(p.x - 4.5, p.y - 11.5, w + 9, 23);
      ctx.fillStyle = ink.text;
      ctx.fillText(d.text, p.x, p.y + 0.5);
      break;
    }
    case "arrow": {
      const p = pt(f, d.a);
      const s = d.up ? 1 : -1;
      ctx.fillStyle = d.up ? ink.pos : ink.neg;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - 7, p.y + s * 9);
      ctx.lineTo(p.x - 2.5, p.y + s * 9);
      ctx.lineTo(p.x - 2.5, p.y + s * 17);
      ctx.lineTo(p.x + 2.5, p.y + s * 17);
      ctx.lineTo(p.x + 2.5, p.y + s * 9);
      ctx.lineTo(p.x + 7, p.y + s * 9);
      ctx.closePath();
      ctx.fill();
      if (hot) {
        ctx.strokeStyle = ink.line;
        ctx.stroke();
      }
      break;
    }
  }
  ctx.restore();
}

/** Anchor points that can be dragged on a selected drawing. */
export function handlesOf(f: Frame, d: Drawing): { x: number; y: number }[] {
  if (d.kind === "trend" || d.kind === "ray" || d.kind === "rect" || d.kind === "fib") return [pt(f, d.a), pt(f, d.b)];
  if (d.kind === "hline") return [{ x: f.plotW / 2, y: yOf(f, d.a.p) }];
  if (d.kind === "vline") return [{ x: xOfTime(f, d.a.t), y: f.plotH / 2 }];
  return [];
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l = dx * dx + dy * dy;
  const k = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
  return Math.hypot(px - (ax + k * dx), py - (ay + k * dy));
}

/** Is (x, y) on this drawing? Generous enough to grab a one-pixel line. */
export function hits(ctx: CanvasRenderingContext2D, f: Frame, d: Drawing, x: number, y: number, sans: string): boolean {
  const near = 6;
  switch (d.kind) {
    case "trend":
    case "ray": {
      const a = pt(f, d.a);
      const b = pt(f, d.b);
      const e = d.kind === "ray" ? extend(f, a, b) : b;
      return segDist(x, y, a.x, a.y, e.x, e.y) < near;
    }
    case "hline":
      return Math.abs(y - yOf(f, d.a.p)) < near;
    case "vline":
      return Math.abs(x - xOfTime(f, d.a.t)) < near;
    case "rect": {
      const a = pt(f, d.a);
      const b = pt(f, d.b);
      return x >= Math.min(a.x, b.x) - near && x <= Math.max(a.x, b.x) + near && y >= Math.min(a.y, b.y) - near && y <= Math.max(a.y, b.y) + near;
    }
    case "fib": {
      const a = pt(f, d.a);
      const b = pt(f, d.b);
      if (x < Math.min(a.x, b.x) - near || x > Math.max(a.x, b.x) + near) return false;
      return FIB.some((r) => Math.abs(y - yOf(f, d.b.p + (d.a.p - d.b.p) * r)) < near);
    }
    case "brush":
      for (let i = 1; i < d.pts.length; i++) {
        const p = pt(f, d.pts[i - 1]);
        const q = pt(f, d.pts[i]);
        if (segDist(x, y, p.x, p.y, q.x, q.y) < near) return true;
      }
      return false;
    case "text": {
      const p = pt(f, d.a);
      ctx.font = `500 13px ${sans}`;
      const w = ctx.measureText(d.text).width;
      return x >= p.x - 6 && x <= p.x + w + 6 && Math.abs(y - p.y) < 13;
    }
    case "arrow": {
      const p = pt(f, d.a);
      return Math.abs(x - p.x) < 9 && (d.up ? y >= p.y - 3 && y <= p.y + 19 : y <= p.y + 3 && y >= p.y - 19);
    }
  }
}

/** Moves every anchor of a drawing by whole bars and a price step. */
export function shifted(f: Frame, d: Drawing, di: number, dp: number): Drawing {
  const mv = (a: Pt): Pt => ({ t: timeOfIdx(f, Math.round(idxOfTime(f, a.t)) + di), p: a.p + dp });
  switch (d.kind) {
    case "trend":
    case "ray":
    case "rect":
    case "fib":
      return { ...d, a: mv(d.a), b: mv(d.b) };
    case "hline":
      return { ...d, a: { ...d.a, p: d.a.p + dp } };
    case "vline":
      return { ...d, a: { ...d.a, t: timeOfIdx(f, Math.round(idxOfTime(f, d.a.t)) + di) } };
    case "brush":
      return { ...d, pts: d.pts.map(mv) };
    case "text":
    case "arrow":
      return { ...d, a: mv(d.a) };
  }
}

/* ------------------------------------------------------------------ */
/* the dithered glow under a line chart, as on the landing band        */
/* ------------------------------------------------------------------ */

export function lineGlow(ctx: CanvasRenderingContext2D, f: Frame, ink: Ink, floor: number) {
  const cell = 3;
  const lo = new Path2D();
  const hi = new Path2D();
  const n = f.bars.length;
  for (let x = 0; x < f.plotW; x += cell) {
    const i = Math.round(iOfX(f, x));
    if (i < 0 || i >= n) continue;
    const y0 = yOf(f, f.bars[i].c);
    const reach = Math.max(1, floor - y0);
    for (let y = Math.ceil(y0 / cell) * cell; y < floor; y += cell) {
      const k = 1 - (y - y0) / reach;
      const I = 0.04 + 0.5 * k * k * k;
      if (I > (BAYER4[((y / cell) & 3) * 4 + ((x / cell) & 3)] + 0.5) / 16) (I > 0.3 ? hi : lo).rect(x, y, 2, 2);
    }
  }
  ctx.fillStyle = ink.b1;
  ctx.fill(lo);
  ctx.fillStyle = ink.b2;
  ctx.fill(hi);
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
