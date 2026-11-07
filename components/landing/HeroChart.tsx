"use client";

import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "@/lib/canvas";
import { POSITION, SESSION_OPEN_MIN, type FeedSim } from "@/lib/feed";
import { fmt, hhmm, toTick } from "@/lib/format";
import { hash2 } from "@/lib/noise";
import { cssVar, onThemeChange } from "@/lib/theme";
import { DitherGlow } from "./DitherCanvas";
import { useFeed } from "./FeedProvider";
import s from "./landing.module.css";

/**
 * Today's NQ session drawn flat across the hero in the dithered band texture.
 * The overnight high sits on the left, the 10:00 low runs under the headline,
 * and the rally on the right climbs back through that high to the live price.
 * The copy rests in the valley; the chart never crosses it.
 */

const T0 = -40; // first bar on the chart, in minutes from the 09:30 open
const LAST_BAR = 79; // the session drawn so far ends here (10:49)
const HEAD_T = 83; // the live price sits a few bars on, so the line bends into it
const PRE: [number, number][] = [
  [-40, 24450], [-32, 24461], [-24, 24476.25], [-16, 24463], [-8, 24449], [-1, 24439],
];
const SMOOTH = 2.8; // gaussian sigma, in bars
const GAMMA = 1.4; // price → height curve: keeps the valley floor low, lets the sides rise
const P_TOP = 24502; // headroom above the session high
const KERNEL = (() => {
  const r = Math.ceil(SMOOTH * 3);
  const w: number[] = [];
  for (let k = -r; k <= r; k++) w.push(Math.exp(-(k * k) / (2 * SMOOTH * SMOOTH)));
  return { r, w };
})();

/** Overnight bars before the open: a smooth path through PRE with a little texture. */
function preClose(t: number): number {
  let k = 0;
  while (k < PRE.length - 2 && t > PRE[k + 1][0]) k++;
  const [ax, ay] = PRE[k];
  const [bx, by] = PRE[k + 1];
  const f = Math.min(1, Math.max(0, (t - ax) / (bx - ax)));
  const e = (1 - Math.cos(Math.PI * f)) / 2;
  return toTick(ay + (by - ay) * e + (hash2(t + 101, 7) - 0.5) * 4);
}

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uCurve;   // one texel per cell column: the line's y in CSS px
uniform int uCols;
uniform float uViewH;
uniform float uDpr;
uniform float uCell;
uniform float uGap;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform float uFill;        // how far the glow under the line reaches (CSS px)
uniform float uFillTop;     // glow strength right under the line
uniform float uLine;        // line softness (CSS px)
uniform vec3 uPointer;      // x, radius, strength
uniform vec3 uHead;         // x, y, glow
uniform float uReveal;      // intro sweep, CSS px
uniform float uEdge;        // how far the line takes to fade in from the left edge

out vec4 outColor;

float curveY(int i) {
  if (i < 0 || i >= uCols) return -1e5;
  return texelFetch(uCurve, ivec2(i, 0), 0).r;
}

float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
  return length(pa - ba * h);
}

float bayer4(ivec2 q) {
  int x = q.x & 3;
  int y = q.y & 3;
  int v = x ^ y;
  int m = ((v & 1) << 3) | ((y & 1) << 2) | (v & 2) | ((y >> 1) & 1);
  return (float(m) + 0.5) / 16.0;
}

float fall(float a, float b, float x) { return 1.0 - smoothstep(a, b, x); }

void main() {
  vec2 p = vec2(gl_FragCoord.x, uViewH * uDpr - gl_FragCoord.y) / uDpr;
  vec2 ci = floor(p / uCell);
  vec2 lp = p - ci * uCell;
  if (lp.x > uCell - uGap || lp.y > uCell - uGap) discard;
  vec2 c = (ci + 0.5) * uCell;
  if (c.x > uReveal + 60.0) discard;

  int col = int(ci.x);
  float yc = curveY(col);

  float d = 1e5;
  for (int k = -3; k <= 2; k++) {
    int i0 = col + k;
    float ya = curveY(i0);
    float yb = curveY(i0 + 1);
    if (ya < -1e4 || yb < -1e4) continue;
    vec2 a = vec2((float(i0) + 0.5) * uCell, ya);
    vec2 b = vec2((float(i0) + 1.5) * uCell, yb);
    d = min(d, segDist(c, a, b));
  }

  float dx = c.x - uPointer.x;
  float spot = uPointer.z * exp(-(dx * dx) / (2.0 * uPointer.y * uPointer.y));

  float I = 0.0;
  if (yc > -1e4) {
    float dy = c.y - yc;
    if (dy >= 0.0) {
      float fill = uFillTop * exp(-dy / (uFill * (1.0 + 0.3 * spot)));
      // the glow ends softly at the live price; the line itself runs right up to it
      float tail = fall(uHead.x - 64.0, uHead.x + 2.0, c.x);
      fill *= mix(1.0, tail, smoothstep(3.0, 30.0, dy));
      I = fill * (1.0 + 0.22 * spot);
    }
  }
  I = max(I, 1.15 * exp(-(d * d) / (2.0 * uLine * uLine)));

  vec2 dh = c - uHead.xy;
  I += uHead.z * exp(-dot(dh, dh) / (2.0 * 15.0 * 15.0));

  I *= smoothstep(-20.0, uEdge, c.x);
  I *= fall(uViewH - 120.0, uViewH, c.y);
  I *= fall(uReveal - 50.0, uReveal + 50.0, c.x);

  if (I <= bayer4(ivec2(ci))) discard;
  vec3 tone = I > 0.92 ? uC3 : I > 0.6 ? uC2 : I > 0.35 ? uC1 : uC0;
  outColor = vec4(tone, 1.0);
}`;

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(n)) return [0.4, 0.6, 0.9];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn("[hero chart]", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function program(gl: WebGL2RenderingContext): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const p = gl.createProgram();
  if (!p) return null;
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.warn("[hero chart]", gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}

type Rect = { l: number; t: number; r: number; b: number };

export function HeroChart() {
  const { sim, snap } = useFeed();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const headRef = useRef<HTMLSpanElement>(null);
  const guideRef = useRef<HTMLSpanElement>(null);
  const entryRef = useRef<HTMLSpanElement>(null);
  const hairRef = useRef<HTMLSpanElement>(null);
  const ringRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const tipTimeRef = useRef<HTMLElement>(null);
  const tipPriceRef = useRef<HTMLElement>(null);
  const tipTagRef = useRef<HTMLElement>(null);
  const tickRef = useRef<() => void>(() => {});
  const [fallback, setFallback] = useState(false);

  // every feed tick nudges the loop awake
  useEffect(() => {
    tickRef.current();
  }, [snap.tick]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const hero = wrap?.parentElement;
    if (!wrap || !canvas || !hero) return;
    const gl = canvas.getContext("webgl2", { alpha: true, antialias: false, premultipliedAlpha: true });
    const prog = gl ? program(gl) : null;
    if (!gl || !prog) {
      setFallback(true);
      return;
    }
    const feed: FeedSim = sim;
    const reduce = prefersReducedMotion();

    const U = (n: string) => gl.getUniformLocation(prog, n);
    const u = {
      curve: U("uCurve"), cols: U("uCols"), viewH: U("uViewH"), dpr: U("uDpr"), cell: U("uCell"), gap: U("uGap"),
      c0: U("uC0"), c1: U("uC1"), c2: U("uC2"), c3: U("uC3"), fill: U("uFill"), fillTop: U("uFillTop"), line: U("uLine"),
      pointer: U("uPointer"), head: U("uHead"), reveal: U("uReveal"), edge: U("uEdge"),
    };
    const vao = gl.createVertexArray();
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // ---- layout ----
    let W = 0;
    let H = 0;
    let dpr = 1;
    let cell = 4;
    let gap = 1.4;
    let cols = 0;
    let narrow = false;
    let colY = new Float32Array(0);
    let colP = new Float32Array(0);
    let rects: Rect[] = [];
    let version = 0; // bumps on resize and theme change so the next frame redraws
    let snapMapping = true;

    const measure = () => {
      const box = wrap.getBoundingClientRect();
      W = Math.round(box.width);
      H = Math.round(box.height);
      if (!W || !H) return;
      narrow = W < 760;
      cell = W < 700 ? 3 : 4;
      gap = W < 700 ? 1.1 : 1.4;
      const raw = Math.min(2, window.devicePixelRatio || 1);
      dpr = Math.min(raw, Math.sqrt(6.5e6 / (W * H)));
      const cw = Math.round(W * dpr);
      const ch = Math.round(H * dpr);
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      cols = Math.ceil(W / cell) + 1;
      if (colY.length !== cols) {
        colY = new Float32Array(cols);
        colP = new Float32Array(cols);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, cols, 1, 0, gl.RED, gl.FLOAT, colY);
      }
      rects = [];
      hero.querySelectorAll<HTMLElement>("[data-hero-clear]").forEach((el) => {
        const r = el.getBoundingClientRect();
        rects.push({ l: r.left - box.left, t: r.top - box.top, r: r.right - box.left, b: r.bottom - box.top });
      });
      version++;
      snapMapping = true;
    };

    // ---- palette ----
    let pal = { c0: rgb("#1c2633"), c1: rgb("#2f6fb8"), c2: rgb("#6eb6ff"), c3: rgb("#dcebfa") };
    const readPalette = () => {
      pal = {
        c0: rgb(cssVar("--cv-dither-0")),
        c1: rgb(cssVar("--cv-dither-1")),
        c2: rgb(cssVar("--cv-dither-2")),
        c3: rgb(cssVar("--cv-dither-3")),
      };
      version++;
    };

    // ---- series ----
    // The session so far stays put so the composition holds; only the live
    // price at the head moves, one print a second.
    const raw: number[] = [];
    for (let t = T0; t <= LAST_BAR; t++) {
      const bar = t < 0 ? undefined : feed.candles.find((c) => c.t === t);
      raw.push(t < 0 ? preClose(t) : bar ? bar.c : raw[raw.length - 1]);
    }
    const settled = raw[raw.length - 1];
    for (let t = LAST_BAR + 1; t <= HEAD_T; t++) raw.push(settled);
    const bend = (live: number) => {
      for (let t = LAST_BAR + 1; t <= HEAD_T; t++) {
        const k = (t - LAST_BAR) / (HEAD_T - LAST_BAR);
        raw[t - T0] = settled + (live - settled) * k;
      }
    };
    bend(feed.nq);
    const sm: number[] = [];
    const tEnd = HEAD_T;
    let price = feed.nq;
    let seenPrice = feed.nq;

    const smooth = () => {
      const n = raw.length;
      sm.length = n;
      const { r, w } = KERNEL;
      for (let i = 0; i < n; i++) {
        let sum = 0;
        let ws = 0;
        for (let k = -r; k <= r; k++) {
          const j = Math.min(n - 1, Math.max(0, i + k));
          sum += raw[j] * w[k + r];
          ws += w[k + r];
        }
        sm[i] = sum / ws;
      }
      // pin the newest bars to the real prints so the head sits on the live price
      const pins = [0.85, 0.5, 0.2];
      for (let k = 0; k < pins.length && n - 1 - k >= 0; k++) {
        const i = n - 1 - k;
        sm[i] += (raw[i] - sm[i]) * pins[k];
      }
    };

    const sample = (t: number) => {
      const n = sm.length;
      const x = t - T0;
      const i = Math.floor(x);
      const f = x - i;
      const at = (j: number) => sm[Math.min(n - 1, Math.max(0, j))];
      const p0 = at(i - 1);
      const p1 = at(i);
      const p2 = at(i + 1);
      const p3 = at(i + 2);
      return 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
    };

    // ---- mapping: time → x, price → y ----
    const xs = () => -0.02 * W;
    const xe = () => (narrow ? W - Math.max(44, W * 0.12) : W - Math.max(72, W * 0.075));
    const xOf = (t: number) => xs() + ((t - T0) / (tEnd - T0)) * (xe() - xs());
    const tOf = (x: number) => T0 + ((x - xs()) / (xe() - xs())) * (tEnd - T0);

    let pLow = 0;
    let pTop = 1;
    let span = 0;
    let yLow = 0;
    let pLowT = 0;
    let pTopT = 1;
    let spanT = 0;
    const lift = (p: number, lo: number, top: number) => {
      const v = (p - lo) / (top - lo);
      return v <= 0 ? 0 : Math.pow(v, GAMMA);
    };
    const yOf = (p: number) => yLow - span * lift(p, pLow, pTop);

    let valid = 0;
    const sampleColumns = () => {
      valid = 0;
      const end = tEnd;
      for (let i = 0; i < cols; i++) {
        const t = tOf((i + 0.5) * cell);
        if (t > end) break;
        colP[i] = sample(t);
        valid = i + 1;
      }
    };

    const targets = () => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < valid; i++) {
        lo = Math.min(lo, colP[i]);
        hi = Math.max(hi, colP[i]);
      }
      pLowT = lo - 1.5;
      pTopT = Math.max(P_TOP, hi + 3);
      yLow = H - (narrow ? 26 : 70);
      const padX = narrow ? 0 : 30;
      const padY = narrow ? 30 : 40;
      let sp = yLow - (narrow ? 60 : 150);
      for (const r of rects) {
        const room = yLow - (r.b + padY);
        for (let i = 0; i < valid; i++) {
          const x = (i + 0.5) * cell;
          if (x < r.l - padX || x > r.r + padX) continue;
          const v = lift(colP[i], pLowT, pTopT);
          if (v > 0.002) sp = Math.min(sp, room / v);
        }
      }
      spanT = Math.max(40, sp);
    };

    // ---- interaction ----
    const pointer = { x: 0, y: 0, on: false, sx: 0, s: 0 };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const box = wrap.getBoundingClientRect();
      pointer.x = e.clientX - box.left;
      pointer.y = e.clientY - box.top;
      const target = e.target as Element | null;
      pointer.on = !target?.closest?.("a, button, nav");
      if (pointer.s < 0.01) pointer.sx = pointer.x;
      wake();
    };
    const onLeave = () => {
      pointer.on = false;
      wake();
    };
    hero.addEventListener("pointermove", onMove);
    hero.addEventListener("pointerleave", onLeave);

    // ---- marks (DOM, so text and rings stay crisp) ----
    const place = (el: HTMLElement | null, x: number, y: number, o: number) => {
      if (!el) return;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      el.style.opacity = o.toFixed(3);
    };
    let tipKey = "";

    // ---- loop ----
    let raf = 0;
    let last = 0;
    let visible = true;
    let revealT = reduce ? 1 : 0;
    let flash = 0;
    let started = 0;
    let lastDraw = "";

    const ease = (cur: number, target: number, dt: number, tau: number) =>
      cur + (target - cur) * (1 - Math.exp(-dt / tau));

    const frame = (now: number) => {
      raf = 0;
      if (!visible) return;
      if (!W || !H) {
        measure();
        if (!W || !H) return;
      }
      if (!started) started = now;
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
      last = now;
      let busy = false;

      // feed
      if (feed.nq !== seenPrice) {
        seenPrice = feed.nq;
        if (!reduce) flash = 1;
      }
      price = reduce ? feed.nq : ease(price, feed.nq, dt, 0.9);
      if (Math.abs(price - feed.nq) > 0.01) busy = true;
      else price = feed.nq;
      bend(price);
      smooth();

      // mapping
      sampleColumns();
      targets();
      if (snapMapping) {
        pLow = pLowT;
        pTop = pTopT;
        span = spanT;
        snapMapping = false;
      } else {
        pLow = ease(pLow, pLowT, dt, 0.6);
        pTop = ease(pTop, pTopT, dt, 0.6);
        span = ease(span, spanT, dt, 0.6);
        if (Math.abs(span - spanT) > 0.05 || Math.abs(pTop - pTopT) > 0.01 || Math.abs(pLow - pLowT) > 0.01) busy = true;
      }

      // intro sweep
      if (revealT < 1) {
        const k = Math.min(1, Math.max(0, (now - started - 300) / 2300));
        revealT = 0.5 - 0.5 * Math.cos(Math.PI * k);
        busy = true;
      }
      const revealX = xs() + revealT * (W + 140 - xs());

      // pointer light
      const want = pointer.on && revealT > 0.85 ? 1 : 0;
      pointer.s = ease(pointer.s, want, dt, want ? 0.18 : 0.35);
      pointer.sx = ease(pointer.sx, pointer.x, dt, 0.09);
      if (Math.abs(pointer.s - want) > 0.004 || Math.abs(pointer.sx - pointer.x) > 0.3) busy = true;

      flash = Math.max(0, flash - dt * 1.6);
      if (flash > 0) busy = true;

      // the line, column by column
      const headY = yOf(price);
      for (let i = 0; i < cols; i++) colY[i] = i < valid ? yOf(colP[i]) : -1e5;
      if (valid < cols) colY[valid] = headY; // carry the line onto the head
      const key = [W, H, valid, span.toFixed(1), pTop.toFixed(2), pLow.toFixed(2), headY.toFixed(1),
        revealX.toFixed(1), pointer.s.toFixed(3), pointer.sx.toFixed(1), flash.toFixed(3), version].join("|");
      if (key !== lastDraw) {
        lastDraw = key;
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(prog);
        gl.bindVertexArray(vao);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, 1, gl.RED, gl.FLOAT, colY);
        gl.uniform1i(u.curve, 0);
        gl.uniform1i(u.cols, cols);
        gl.uniform1f(u.viewH, H);
        gl.uniform1f(u.dpr, canvas.height / H);
        gl.uniform1f(u.cell, cell);
        gl.uniform1f(u.gap, gap);
        gl.uniform3fv(u.c0, pal.c0);
        gl.uniform3fv(u.c1, pal.c1);
        gl.uniform3fv(u.c2, pal.c2);
        gl.uniform3fv(u.c3, pal.c3);
        gl.uniform1f(u.fill, narrow ? 64 : 110);
        gl.uniform1f(u.fillTop, 0.66);
        gl.uniform1f(u.line, narrow ? 2.4 : 3.0);
        gl.uniform3f(u.pointer, pointer.sx, narrow ? 64 : 100, pointer.s);
        gl.uniform3f(u.head, xe(), headY, 0.16 + 0.5 * flash);
        gl.uniform1f(u.reveal, revealX);
        gl.uniform1f(u.edge, narrow ? 56 : 150);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }

      // marks
      const markO = Math.min(1, Math.max(0, (revealT - 0.88) / 0.12));
      const hx = xe();
      place(headRef.current, hx, headY, markO);
      const g = guideRef.current;
      if (g) {
        g.style.width = `${Math.max(0, W - hx - 16).toFixed(0)}px`;
        place(g, hx + 16, headY, markO * 0.9);
      }
      const ei = POSITION.entryMinute - T0;
      if (ei < sm.length) place(entryRef.current, xOf(POSITION.entryMinute), yOf(sm[ei]), markO);

      const showTip = pointer.on && markO > 0.99 && pointer.y > 0 && pointer.y < H;
      if (showTip) {
        const tRaw = tOf(pointer.x);
        const isLive = pointer.x >= hx - 6 || Math.round(tRaw) > LAST_BAR;
        const t = isLive ? HEAD_T : Math.max(T0, Math.round(tRaw));
        const x = isLive ? hx : xOf(t);
        const y = isLive ? headY : yOf(sm[t - T0]);
        const isEntry = !isLive && t === POSITION.entryMinute;
        const p = isLive ? feed.nq : isEntry ? POSITION.entry : raw[t - T0];
        const k2 = `${t}|${isLive}|${p}`;
        if (k2 !== tipKey) {
          tipKey = k2;
          if (tipTimeRef.current) tipTimeRef.current.textContent = isLive ? "LIVE" : hhmm(SESSION_OPEN_MIN + t);
          if (tipPriceRef.current) tipPriceRef.current.textContent = fmt(p);
          if (tipTagRef.current) tipTagRef.current.textContent = isEntry ? "ENTRY" : "";
        }
        place(ringRef.current, x, y, 1);
        const hair = hairRef.current;
        if (hair) {
          hair.style.height = `${Math.max(0, H - y - 10).toFixed(0)}px`;
          place(hair, x, y + 10, 1);
        }
        const tip = tipRef.current;
        if (tip) {
          const tw = tip.offsetWidth;
          const tx = Math.min(W - tw - 12, Math.max(12, x - tw / 2));
          place(tip, tx, y - 42, 1);
        }
      } else {
        if (ringRef.current) ringRef.current.style.opacity = "0";
        if (hairRef.current) hairRef.current.style.opacity = "0";
        if (tipRef.current) tipRef.current.style.opacity = "0";
      }

      if (busy) wake();
    };

    const wake = () => {
      if (!raf && visible) raf = requestAnimationFrame(frame);
    };
    tickRef.current = wake;

    measure();
    readPalette();
    wake();

    const ro = new ResizeObserver(() => {
      measure();
      wake();
    });
    ro.observe(wrap);
    hero.querySelectorAll("[data-hero-clear]").forEach((el) => ro.observe(el));
    const settle = window.setTimeout(() => {
      measure();
      wake();
    }, 1150);
    document.fonts?.ready.then(() => {
      measure();
      wake();
    });
    const offTheme = onThemeChange(() => {
      readPalette();
      wake();
    });
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting && !document.hidden;
      last = 0;
      wake();
    });
    io.observe(wrap);
    const onVis = () => {
      visible = !document.hidden;
      last = 0;
      wake();
    };
    document.addEventListener("visibilitychange", onVis);
    const onLost = (e: Event) => {
      e.preventDefault();
      setFallback(true);
    };
    canvas.addEventListener("webglcontextlost", onLost);

    return () => {
      cancelAnimationFrame(raf);
      tickRef.current = () => {};
      window.clearTimeout(settle);
      ro.disconnect();
      io.disconnect();
      offTheme();
      document.removeEventListener("visibilitychange", onVis);
      hero.removeEventListener("pointermove", onMove);
      hero.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("webglcontextlost", onLost);
      gl.deleteTexture(tex);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(prog);
    };
  }, [sim]);

  if (fallback) return <DitherGlow variant="horizon" className={`${s.fill} ${s.bandFallback}`} />;

  return (
    <div ref={wrapRef} className={s.band} aria-hidden="true">
      <canvas ref={canvasRef} className={s.bandCanvas} />
      <span ref={guideRef} className={`${s.bandMark} ${s.bandGuide}`} />
      <span ref={entryRef} className={`${s.bandMark} ${s.bandEntry}`} />
      <span ref={headRef} className={`${s.bandMark} ${s.bandHead}`} />
      <span ref={hairRef} className={`${s.bandMark} ${s.bandHair}`} />
      <span ref={ringRef} className={`${s.bandMark} ${s.bandRing}`} />
      <span ref={tipRef} className={`${s.bandMark} ${s.bandTip}`}>
        <b ref={tipTimeRef} />
        <i ref={tipPriceRef} />
        <em ref={tipTagRef} />
      </span>
    </div>
  );
}
