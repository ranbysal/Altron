import type { Candle } from "@/lib/feed";
import { POSITION } from "@/lib/feed";
import { hash2 } from "@/lib/noise";
import { toTick } from "@/lib/format";

/*
 * World layout (y up, the street runs away from the camera along −z):
 *   NQ candles stand along the right wall (x = +W), ES along the left (x = −W).
 *   Candle i = 0 is the newest and sits nearest the camera; older candles recede.
 *   Price maps to height above the floor (y = 0).
 */

export const DZ = 0.56; // spacing between candles along the street
export const THICK = 0.5; // building depth (along x)
export const BODY_Z = 0.27; // building width (along z)
export const Y_LO = 0.85;
export const Y_HI = 4.1;

export type Layout = { W: number; Z0: number };

export type WallCandle = Candle & { side: 1 | -1; i: number; id: number; z: number; x: number; yo: number; yc: number; yh: number; yl: number; sym: string };

export type Built = {
  boxes: Float32Array; // stride 11: center3 size3 params4 phase1
  boxCount: number;
  lines: Float32Array; // stride 8: pos3 a4 phase1
  lineVerts: number;
  points: Float32Array;
  pointVerts: number;
  candles: WallCandle[];
  levels: { entry: number; stop: number; target: number; zFrom: number; x: number } | null;
};

const ES_BASE = 6842;
const NQ_BASE = 24486;

/** ES series derived from NQ: correlated moves, its own texture. */
export function deriveEs(nq: Candle[]): Candle[] {
  let prevC = 0;
  return nq.map((c, k) => {
    const n = (t: number, s: number) => (hash2(t * 7 + s, 91) - 0.5) * 2;
    const drift = 3.2 * Math.sin(c.t * 0.19) + 1.6 * Math.sin(c.t * 0.53 + 1.1);
    const map = (v: number) => ES_BASE + (v - NQ_BASE) * 0.27 + drift;
    const cl = toTick(map(c.c) + n(c.t, 1) * 0.9);
    const op = k === 0 ? toTick(map(c.o)) : prevC;
    const hi = toTick(Math.max(op, cl, map(c.h)) + Math.abs(n(c.t, 2)) * 0.75);
    const lo = toTick(Math.min(op, cl, map(c.l)) - Math.abs(n(c.t, 3)) * 0.75);
    prevC = cl;
    return { o: op, h: hi, l: lo, c: cl, t: c.t };
  });
}

export function makeScale(list: Candle[], extra: number[] = []) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of list) {
    lo = Math.min(lo, c.l);
    hi = Math.max(hi, c.h);
  }
  for (const v of extra) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const pad = (hi - lo) * 0.06;
  return { lo: lo - pad, hi: hi + pad };
}

function pushLine(a: number[], p: [number, number, number], q: [number, number, number], I: number, acc: number, s0: number, s1: number, kind: number, ph0: number, ph1 = ph0) {
  a.push(p[0], p[1], p[2], I, acc, s0, kind, ph0, q[0], q[1], q[2], I, acc, s1, kind, ph1);
}

/** Lines that don't depend on prices: the floor grid, curbs, center line, scan line. */
export function buildStatic({ W }: Layout): { data: Float32Array; verts: number } {
  const a: number[] = [];
  const zNear = -1;
  const zFar = -96;
  // long lines running down the street, denser inside it
  for (let k = -16; k <= 16; k++) {
    const x = k * 1.25;
    const inside = Math.abs(x) < W - 0.6;
    pushLine(a, [x, 0, zNear], [x, 0, zFar], inside ? 0.22 : 0.15, 0, 0, 0, 0, -1);
  }
  // curbs just inside each wall
  for (const sd of [1, -1]) pushLine(a, [sd * (W - THICK), 0.002, zNear], [sd * (W - THICK), 0.002, zFar], 0.45, 0, 0, 0, 0, -1);
  // cross lines every two candles, full width
  for (let z = -2; z > zFar; z -= DZ * 2) pushLine(a, [-22, 0, z], [22, 0, z], 0.13, 0, 0, 0, 0, -1);
  // scan line (z is driven by the shader)
  pushLine(a, [-(W - THICK), 0.004, 0], [W - THICK, 0.004, 0], 0.7, 0, 0, 0, 5, -1);
  return { data: new Float32Array(a), verts: a.length / 8 };
}

export function buildScene(nq: Candle[], es: Candle[], L: Layout, sNq: { lo: number; hi: number }, sEs: { lo: number; hi: number }): Built {
  const box: number[] = [];
  const lines: number[] = [];
  const pts: number[] = [];
  const candles: WallCandle[] = [];
  const LINE_GAIN = 1.8; // lines are 1 texel wide in the 2× buffer, so they need extra light

  const walls: { list: Candle[]; side: 1 | -1; scale: { lo: number; hi: number }; base: number; sym: string }[] = [
    { list: nq, side: 1, scale: sNq, base: 0, sym: "NQZ6" },
    { list: es, side: -1, scale: sEs, base: 1000, sym: "ESZ6" },
  ];

  let levels: Built["levels"] = null;

  for (const wall of walls) {
    const { list, side, scale } = wall;
    const N = list.length;
    const Y = (v: number) => Y_LO + ((v - scale.lo) / (scale.hi - scale.lo)) * (Y_HI - Y_LO);
    const x = side * L.W;
    const xInner = x - side * (THICK / 2 + 0.07);
    let prev: [number, number, number] | null = null;
    let prevS = 0;

    for (let i = 0; i < N; i++) {
      const c = list[N - 1 - i]; // newest first
      const z = -(L.Z0 + i * DZ);
      const phase = i / N;
      const yo = Y(c.o), yc = Y(c.c), yh = Y(c.h), yl = Y(c.l);
      const up = c.c >= c.o;
      const id = wall.base + i;
      candles.push({ ...c, side, i, id, z, x, yo, yc, yh, yl, sym: wall.sym });

      // tower from the street up to the body (negative fill marks a tower in the shader)
      const yb = Math.min(yo, yc);
      box.push(x, yb / 2, z, THICK * 0.94, yb, BODY_Z * 0.94, -0.3, 0.42, 0, id, phase);
      // body
      const bh = Math.max(Math.abs(yc - yo), 0.035);
      box.push(x, (yo + yc) / 2, z, THICK, bh, BODY_Z, up ? 1.05 : 0.1, up ? 0.45 : 1.0, 0, id, phase);
      // wick
      box.push(x, (yh + yl) / 2, z, 0.07, Math.max(yh - yl, 0.02), 0.07, 0.9, 0, 0, id, phase);


      // price cable along the inner face, through each close
      const p: [number, number, number] = [xInner, yc, z];
      const sv = i / N;
      if (prev) pushLine(lines, prev, p, 0.62 * LINE_GAIN, 0, prevS, sv, 3, Math.max(0, (i - 1) / N), phase);
      prev = p;
      prevS = sv;


      // scan-noise scatter around each building, like a point cloud
      const nPts = 10;
      for (let k = 0; k < nPts; k++) {
        const r1 = hash2(c.t * 31 + k, side * 17 + 3);
        const r2 = hash2(c.t * 13 + k, side * 29 + 5);
        const r3 = hash2(c.t * 7 + k, side * 41 + 9);
        const px = x - side * (THICK / 2) * (r1 * 2.2 - 0.2);
        const py = yl + (yh - yl) * r2 + (r3 - 0.5) * 0.4;
        const pz = z + (r3 - 0.5) * BODY_Z * 1.6;
        pts.push(px, Math.max(0.02, py), pz, 0.55 * LINE_GAIN, 0, 0, 0, phase);
      }
      // dust on the floor near the wall
      for (let k = 0; k < 6; k++) {
        const r1 = hash2(c.t * 5 + k, side * 3 + 1);
        const r2 = hash2(c.t * 11 + k, side * 7 + 2);
        pts.push(x - side * (THICK / 2 + r1 * 1.4), 0.01, z + (r2 - 0.5) * DZ, 0.4 * LINE_GAIN, 0, 0, 0, phase);
      }
    }

    // position levels on the NQ wall, from the entry candle toward the viewer
    if (side === 1) {
      const entryIdx = candles.findIndex((k) => k.side === 1 && k.t === POSITION.entryMinute);
      if (entryIdx >= 0) {
        const e = candles[entryIdx];
        const xl = x - side * (THICK / 2 + 0.22);
        const ph = e.i / N;
        const zTo = -(L.Z0 - DZ * 0.5);
        pushLine(lines, [xl, Y(POSITION.target), e.z], [xl, Y(POSITION.target), zTo], 0.95 * LINE_GAIN, 0, 0, 0, 2, ph, 0);
        pushLine(lines, [xl, Y(POSITION.entry), e.z], [xl, Y(POSITION.entry), zTo], 1.25 * LINE_GAIN, 0, 0, 0, 0, ph, 0);
        pushLine(lines, [xl, Y(POSITION.stop), e.z], [xl, Y(POSITION.stop), zTo], 1.1 * LINE_GAIN, 1, 0, 0, 2, ph, 0);
        // a vertical marker at the fill
        pushLine(lines, [xl, 0, e.z], [xl, Y(POSITION.target) + 0.5, e.z], 0.9 * LINE_GAIN, 0, 0, 0, 1, ph);
        levels = { entry: Y(POSITION.entry), stop: Y(POSITION.stop), target: Y(POSITION.target), zFrom: e.z, x: xl };
      }
    }
  }

  return {
    boxes: new Float32Array(box),
    boxCount: box.length / 11,
    lines: new Float32Array(lines),
    lineVerts: lines.length / 8,
    points: new Float32Array(pts),
    pointVerts: pts.length / 8,
    candles,
    levels,
  };
}

/** Unit cube: 36 vertices of position + normal, and 24 vertices of edges. */
export function cubeGeometry() {
  const faces: [number[], number[][]][] = [
    [[1, 0, 0], [[0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [0.5, -0.5, 0.5]]],
    [[-1, 0, 0], [[-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5], [-0.5, -0.5, -0.5]]],
    [[0, 1, 0], [[-0.5, 0.5, -0.5], [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5]]],
    [[0, -1, 0], [[-0.5, -0.5, 0.5], [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5]]],
    [[0, 0, 1], [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]]],
    [[0, 0, -1], [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]]],
  ];
  const tri: number[] = [];
  for (const [n, q] of faces) {
    for (const idx of [0, 1, 2, 0, 2, 3]) tri.push(...q[idx], ...n);
  }
  const c = [-0.5, 0.5];
  const edges: number[] = [];
  for (const y of c) for (const z of c) edges.push(-0.5, y, z, 0, 0, 0, 0.5, y, z, 0, 0, 0);
  for (const x of c) for (const z of c) edges.push(x, -0.5, z, 0, 0, 0, x, 0.5, z, 0, 0, 0);
  for (const x of c) for (const y of c) edges.push(x, y, -0.5, 0, 0, 0, x, y, 0.5, 0, 0, 0);
  return { tri: new Float32Array(tri), triVerts: 36, edges: new Float32Array(edges), edgeVerts: 24 };
}
