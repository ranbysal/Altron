"use client";

import { useEffect, useRef, useState } from "react";
import { fmt, hhmm } from "@/lib/format";
import { POSITION, SESSION_OPEN_MIN } from "@/lib/feed";
import { invert, lookAt, multiply, perspective, transform, type Mat4, type Vec3 } from "@/lib/mat4";
import { prefersReducedMotion } from "@/lib/canvas";
import { cssVar, onThemeChange } from "@/lib/theme";
import { DitherGlow } from "../DitherCanvas";
import { useFeed } from "../FeedProvider";
import { BOX_FS, BOX_VS, LINE_FS, LINE_VS, POST_FS, POST_VS } from "./shaders";
import { THICK, buildScene, buildStatic, cubeGeometry, deriveEs, makeScale, type Built, type Layout, type WallCandle } from "./scene";
import s from "./street.module.css";

const FOV = (44 * Math.PI) / 180;
const FOG = 0.024;
const BOX_GAIN = 2.3;
const LINE_GAIN = 1.7;

type GL = WebGL2RenderingContext;

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "").trim();
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const n = parseInt(full || "000000", 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function monoFamily(): string {
  const v = cssVar("--font-geist-mono");
  return `${v ? v + ", " : ""}ui-monospace, SFMono-Regular, Menlo, monospace`;
}

/**
 * The hero's 3D piece: the session's candles stand as buildings along both
 * sides of a street (ES on the left, NQ on the right), newest nearest the
 * viewer. Rendered in WebGL2 into a small buffer, then dithered to squares.
 * Falls back to the dithered arch without WebGL2.
 */
export function PriceStreet({ className, clearSelector = "[data-street-clear]" }: { className?: string; clearSelector?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const uiRef = useRef<HTMLCanvasElement>(null);
  const { sim, snap } = useFeed();
  const tickRef = useRef(0);
  tickRef.current = snap.tick;
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = glRef.current;
    const ui = uiRef.current;
    if (!wrap || !canvas || !ui) return;
    const gl = canvas.getContext("webgl2", { alpha: true, antialias: false, premultipliedAlpha: true, depth: false });
    const uictx = ui.getContext("2d");
    if (!gl || !uictx) {
      setFallback(true);
      return;
    }
    const floatOK = !!gl.getExtension("EXT_color_buffer_float") || !!gl.getExtension("EXT_color_buffer_half_float");

    // ---------- programs ----------
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || "shader");
      return sh;
    };
    type Prog = { p: WebGLProgram; u: (n: string) => WebGLUniformLocation | null };
    const program = (vs: string, fs: string): Prog => {
      const p = gl.createProgram()!;
      gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "link");
      const cache = new Map<string, WebGLUniformLocation | null>();
      return {
        p,
        u: (n) => {
          if (!cache.has(n)) cache.set(n, gl.getUniformLocation(p, n));
          return cache.get(n)!;
        },
      };
    };
    let boxP: Prog, lineP: Prog, postP: Prog;
    try {
      boxP = program(BOX_VS, BOX_FS);
      lineP = program(LINE_VS, LINE_FS);
      postP = program(POST_VS, POST_FS);
    } catch {
      setFallback(true);
      return;
    }

    // ---------- buffers ----------
    const cube = cubeGeometry();
    const instBuf = gl.createBuffer()!;
    const makeBoxVao = (geom: Float32Array) => {
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      const vb = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      gl.bufferData(gl.ARRAY_BUFFER, geom, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
      const st = 11 * 4;
      const attr = (loc: number, size: number, off: number) => {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, st, off * 4);
        gl.vertexAttribDivisor(loc, 1);
      };
      attr(2, 3, 0);
      attr(3, 3, 3);
      attr(4, 4, 6);
      attr(5, 1, 10);
      gl.bindVertexArray(null);
      return vao;
    };
    const triVao = makeBoxVao(cube.tri);
    const edgeVao = makeBoxVao(cube.edges);

    const makeLineVao = () => {
      const vao = gl.createVertexArray()!;
      const vb = gl.createBuffer()!;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 12);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 32, 28);
      gl.bindVertexArray(null);
      return { vao, vb };
    };
    const lineV = makeLineVao();
    const pointV = makeLineVao();
    const staticV = makeLineVao();

    const postVao = gl.createVertexArray()!;
    gl.bindVertexArray(postVao);
    const pb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, pb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // ---------- scene target ----------
    let fbo: WebGLFramebuffer | null = null;
    let colorTex: WebGLTexture | null = null;
    let depthRb: WebGLRenderbuffer | null = null;
    let fw = 0, fh = 0;
    const makeTarget = (w: number, h: number) => {
      if (fbo) gl.deleteFramebuffer(fbo);
      if (colorTex) gl.deleteTexture(colorTex);
      if (depthRb) gl.deleteRenderbuffer(depthRb);
      colorTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, colorTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (floatOK) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      depthRb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, depthRb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRb);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      fw = w;
      fh = h;
    };

    // ---------- sizing & layout ----------
    let cssW = 0, cssH = 0, dpr = 1, cellCss = 4, cells: [number, number] = [1, 1];
    let extentW = 1, extentH = 1; // css px covered by the cell grid (≥ canvas)
    let layout: Layout = { W: 5.4, Z0: 9 };
    let staticVerts = 0;
    let small = false;
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      cssW = Math.max(2, Math.round(r.width));
      cssH = Math.max(2, Math.round(r.height));
      dpr = Math.min(2, window.devicePixelRatio || 1);
      small = cssW < 760;
      cellCss = small ? 3 : 4;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ui.width = canvas.width;
      ui.height = canvas.height;
      cells = [Math.ceil(cssW / cellCss), Math.ceil(cssH / cellCss)];
      extentW = cells[0] * cellCss;
      extentH = cells[1] * cellCss;
      makeTarget(cells[0] * 2, cells[1] * 2);
      const aspect = extentW / extentH;
      const f = 1 / Math.tan(FOV / 2);
      const W = 5.4 * Math.min(1.3, Math.max(0.45, aspect / 1.5));
      layout = { W, Z0: (W * f) / aspect * 1.1 };
      const st = buildStatic(layout);
      gl.bindBuffer(gl.ARRAY_BUFFER, staticV.vb);
      gl.bufferData(gl.ARRAY_BUFFER, st.data, gl.STATIC_DRAW);
      staticVerts = st.verts;
      dirty = true;
      measureClear();
    };

    // area kept quiet behind the hero copy
    let clear = { cx: 0, cy: 0, rx: 1, ry: 1, l: 0, t: 0, r: 0, b: 0 };
    const measureClear = () => {
      const host = wrap.parentElement;
      if (!host) return;
      const base = wrap.getBoundingClientRect();
      const els = host.querySelectorAll(clearSelector);
      if (!els.length) return;
      let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
      els.forEach((el) => {
        const rc = el.getBoundingClientRect();
        l = Math.min(l, rc.left);
        t = Math.min(t, rc.top);
        r = Math.max(r, rc.right);
        b = Math.max(b, rc.bottom);
      });
      l -= base.left; r -= base.left; t -= base.top; b -= base.top;
      clear = { cx: (l + r) / 2, cy: (t + b) / 2, rx: (r - l) / 2 + 30, ry: (b - t) / 2 + 30, l, t, r, b };
    };

    // ---------- data ----------
    let built: Built | null = null;
    let dirty = true;
    let lastTick = -1;
    let flash = 0;
    let scaleNq = { lo: 0, hi: 1 }, scaleEs = { lo: 0, hi: 1 };
    let tScaleNq = scaleNq, tScaleEs = scaleEs;
    let scalesInit = false;
    const rebuild = () => {
      const nq = sim.candles;
      const es = deriveEs(nq);
      tScaleNq = makeScale(nq, []);
      tScaleEs = makeScale(es);
      if (!scalesInit) {
        scaleNq = tScaleNq;
        scaleEs = tScaleEs;
        scalesInit = true;
      }
      built = buildScene(nq, es, layout, scaleNq, scaleEs);
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
      gl.bufferData(gl.ARRAY_BUFFER, built.boxes, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, lineV.vb);
      gl.bufferData(gl.ARRAY_BUFFER, built.lines, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, pointV.vb);
      gl.bufferData(gl.ARRAY_BUFFER, built.points, gl.DYNAMIC_DRAW);
      dirty = false;
    };

    // ---------- colors ----------
    let pal = { b: [] as number[][], e: [] as number[][], text: "#fff", dim: "#888", line: "#555", bg: "#000" };
    const readColors = () => {
      pal = {
        b: [0, 1, 2, 3].map((i) => hexToRgb(cssVar(`--cv-dither-${i}`) || "#4da3ff")),
        e: [0, 1, 2, 3].map((i) => hexToRgb(cssVar(`--cv-ember-${i}`) || "#ff6a2b")),
        text: cssVar("--text") || "#e9ecef",
        dim: cssVar("--dim") || "#7c8692",
        line: cssVar("--line-3") || "rgba(255,255,255,.16)",
        bg: cssVar("--bg") || "#0a0b0d",
      };
    };
    readColors();
    const mono = monoFamily();

    // ---------- input ----------
    const pointer = { x: -1e4, y: -1e4, inside: false };
    const onMove = (e: PointerEvent) => {
      const r = wrap.getBoundingClientRect();
      pointer.x = e.clientX - r.left;
      pointer.y = e.clientY - r.top;
      pointer.inside = pointer.x >= 0 && pointer.y >= 0 && pointer.x <= r.width && pointer.y <= r.height;
    };
    const onLeave = () => (pointer.inside = false);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);

    // ---------- frame ----------
    const still = prefersReducedMotion();
    let raf = 0;
    let visible = true;
    let start = performance.now();
    let last = start;
    const cam = { px: 0, py: 0, k: 0 }; // eased pointer parallax, light strength
    const light: Vec3 = [0, -50, 0];
    let hover = -1;
    let lightK = 0;

    const project = (vp: Mat4, p: Vec3) => {
      const c = transform(vp, p);
      if (c[3] <= 0.05) return null;
      const nx = c[0] / c[3];
      const ny = c[1] / c[3];
      return { x: (nx * 0.5 + 0.5) * extentW, y: cssH - (ny * 0.5 + 0.5) * extentH, w: c[3] };
    };
    const inClear = (x: number, y: number, pad = 0) => x > clear.l - pad && x < clear.r + pad && y > clear.t - pad && y < clear.b + pad;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!visible) return;
      draw(now);
    };

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = still ? 0 : (now - start) / 1000;
      const intro = still ? 1 : Math.min(1, t / 2.6);
      const introE = 1 - Math.pow(1 - intro, 3);

      if (tickRef.current !== lastTick) {
        if (lastTick >= 0) flash = 1;
        lastTick = tickRef.current;
        dirty = true;
      }
      // ease the price scales so new highs/lows don't jolt the walls
      const ease = (a: { lo: number; hi: number }, b: { lo: number; hi: number }) => ({ lo: a.lo + (b.lo - a.lo) * 0.08, hi: a.hi + (b.hi - a.hi) * 0.08 });
      if (scalesInit && (Math.abs(scaleNq.lo - tScaleNq.lo) > 0.01 || Math.abs(scaleNq.hi - tScaleNq.hi) > 0.01 || Math.abs(scaleEs.lo - tScaleEs.lo) > 0.01 || Math.abs(scaleEs.hi - tScaleEs.hi) > 0.01)) {
        scaleNq = ease(scaleNq, tScaleNq);
        scaleEs = ease(scaleEs, tScaleEs);
        dirty = true;
      }
      if (dirty) rebuild();
      flash *= Math.exp(-dt * 2.5);
      if (!built || !fbo) return;

      // camera
      const nxp = pointer.inside ? (pointer.x / cssW) * 2 - 1 : 0;
      const nyp = pointer.inside ? (pointer.y / cssH) * 2 - 1 : 0;
      const k = still ? 1 : 1 - Math.exp(-dt * 2.2);
      cam.px += (nxp - cam.px) * k;
      cam.py += (nyp - cam.py) * k;
      const host = wrap.getBoundingClientRect();
      const scrollP = Math.max(0, Math.min(1, -host.top / Math.max(1, host.height)));
      const sway = still ? 0 : Math.sin(t * 0.11) * 0.18;
      const dolly = -scrollP * 8;
      const eye: Vec3 = [cam.px * 0.55 + sway, 2.3 + scrollP * 0.5 - cam.py * 0.18, dolly];
      const target: Vec3 = [cam.px * 0.9 + sway * 0.5, 1.45 - cam.py * 0.35 - scrollP * 0.3, dolly - 40];
      const aspect = extentW / extentH;
      const proj = perspective(FOV, aspect, 0.1, 160);
      const view = lookAt(eye, target);
      const vp = multiply(proj, view);

      // pointer light: where the pointer ray meets a wall or the floor
      let lightTarget = 0;
      if (pointer.inside && !inClear(pointer.x, pointer.y)) {
        const inv = invert(vp);
        if (inv) {
          const ndx = (pointer.x / extentW) * 2 - 1;
          const ndy = ((cssH - pointer.y) / extentH) * 2 - 1;
          const a = transform(inv, [ndx, ndy, -1]);
          const b = transform(inv, [ndx, ndy, 1]);
          const n: Vec3 = [a[0] / a[3], a[1] / a[3], a[2] / a[3]];
          const f: Vec3 = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
          const d: Vec3 = [f[0] - n[0], f[1] - n[1], f[2] - n[2]];
          let hit: Vec3 | null = null;
          if (Math.abs(d[0]) > 1e-5) {
            const xw = Math.sign(d[0]) * (layout.W - THICK / 2);
            const tt = (xw - n[0]) / d[0];
            if (tt > 0) {
              const h: Vec3 = [xw, n[1] + d[1] * tt, n[2] + d[2] * tt];
              if (h[1] > 0 && h[1] < 6 && h[2] < -1) hit = h;
            }
          }
          if (!hit && d[1] < 0) {
            const tt = -n[1] / d[1];
            hit = [n[0] + d[0] * tt, 0, n[2] + d[2] * tt];
          }
          if (hit) {
            light[0] = hit[0];
            light[1] = hit[1];
            light[2] = hit[2];
            lightTarget = 1;
          }
        }
      }
      lightK += (lightTarget - lightK) * (still ? 1 : 1 - Math.exp(-dt * 6));

      // hover: the nearest building whose silhouette contains the pointer
      hover = -1;
      let hovered: WallCandle | null = null;
      if (pointer.inside && !inClear(pointer.x, pointer.y, 10) && intro > 0.9) {
        for (const c of built.candles) {
          const xi = c.x - c.side * (THICK / 2);
          const a1 = project(vp, [xi, 0, c.z + 0.14]);
          const a2 = project(vp, [xi, c.yh, c.z - 0.14]);
          if (!a1 || !a2) continue;
          const minX = Math.min(a1.x, a2.x) - 2, maxX = Math.max(a1.x, a2.x) + 2;
          if (pointer.x >= minX && pointer.x <= maxX && pointer.y >= a2.y - 6 && pointer.y <= a1.y) {
            if (!hovered || c.i < hovered.i) hovered = c;
          }
        }
        if (hovered) hover = hovered.id;
      }

      // scan sweep: from deep in the street to the viewer, every 9 s
      const cyc = still ? 1 : (t % 9) / 6;
      const scanZ = cyc < 1 ? -64 + cyc * 62 : 999;

      // ----- pass 1: light into the small buffer -----
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, fw, fh);
      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1);
      gl.depthMask(true); // clearing depth respects the mask left over from the last frame
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);

      const boxUniforms = (mirror: number, mode: number, grow: number) => {
        gl.useProgram(boxP.p);
        gl.uniformMatrix4fv(boxP.u("uVP"), false, vp);
        gl.uniform1f(boxP.u("uMirror"), mirror);
        gl.uniform1f(boxP.u("uIntro"), introE);
        gl.uniform1f(boxP.u("uGrow"), grow);
        gl.uniform3fv(boxP.u("uCam"), eye);
        gl.uniform3fv(boxP.u("uLightP"), light);
        gl.uniform1f(boxP.u("uLightK"), lightK);
        gl.uniform1f(boxP.u("uScanZ"), scanZ);
        gl.uniform1f(boxP.u("uHover"), hover);
        gl.uniform1f(boxP.u("uFlash"), flash);
        gl.uniform1f(boxP.u("uMode"), mode);
        gl.uniform1f(boxP.u("uFog"), FOG);
        gl.uniform1f(boxP.u("uGain"), BOX_GAIN);
      };
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      // reflections first, then the buildings
      for (const mirror of [1, 0]) {
        boxUniforms(mirror, 0, 1);
        gl.bindVertexArray(triVao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, cube.triVerts, built.boxCount);
      }
      // wireframe edges on top
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
      boxUniforms(0, 1, 1.012);
      gl.bindVertexArray(edgeVao);
      gl.drawArraysInstanced(gl.LINES, 0, cube.edgeVerts, built.boxCount);

      const lineUniforms = (mirror: number, pointSize: number) => {
        gl.useProgram(lineP.p);
        gl.uniformMatrix4fv(lineP.u("uVP"), false, vp);
        gl.uniform1f(lineP.u("uMirror"), mirror);
        gl.uniform1f(lineP.u("uIntro"), introE);
        gl.uniform1f(lineP.u("uScanZ"), scanZ);
        gl.uniform1f(lineP.u("uPointSize"), pointSize);
        gl.uniform3fv(lineP.u("uCam"), eye);
        gl.uniform1f(lineP.u("uTime"), t);
        gl.uniform1f(lineP.u("uFog"), FOG);
        gl.uniform1f(lineP.u("uGain"), LINE_GAIN);
        gl.uniform3fv(lineP.u("uLightP"), light);
        gl.uniform1f(lineP.u("uLightK"), lightK);
      };
      lineUniforms(0, 1);
      gl.bindVertexArray(staticV.vao);
      gl.drawArrays(gl.LINES, 0, staticVerts);
      for (const mirror of [1, 0]) {
        lineUniforms(mirror, 1);
        gl.bindVertexArray(lineV.vao);
        gl.drawArrays(gl.LINES, 0, built.lineVerts);
      }
      lineUniforms(0, 1);
      gl.bindVertexArray(pointV.vao);
      gl.drawArrays(gl.POINTS, 0, built.pointVerts);

      // ----- pass 2: dither to the screen -----
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(postP.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, colorTex);
      gl.uniform1i(postP.u("uScene"), 0);
      gl.uniform2f(postP.u("uCells"), cells[0], cells[1]);
      gl.uniform1f(postP.u("uCell"), cellCss * dpr);
      gl.uniform1f(postP.u("uGap"), (small ? 1.1 : 1.4) * dpr);
      gl.uniform2f(postP.u("uRes"), canvas.width, canvas.height);
      ["uB0", "uB1", "uB2", "uB3"].forEach((n, i) => gl.uniform3fv(postP.u(n), pal.b[i]));
      ["uE0", "uE1", "uE2", "uE3"].forEach((n, i) => gl.uniform3fv(postP.u(n), pal.e[i]));
      gl.uniform4f(postP.u("uClear"), clear.cx * dpr, (cssH - clear.cy) * dpr, clear.rx * dpr, clear.ry * dpr);
      gl.uniform1f(postP.u("uClearAmt"), small ? 0.9 : 0.93);
      gl.bindVertexArray(postVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);

      // ----- crisp annotations -----
      drawUi(vp, hovered, introE);
    };

    /** Anchor ring, a short leader, and a solid chip holding the text (Norrvik-style flag). */
    const label = (x: number, y: number, lines: [string, string][], align: "left" | "right", lead: number, accent?: string) => {
      const c = uictx;
      c.strokeStyle = pal.text;
      c.lineWidth = 1;
      c.beginPath();
      c.arc(x, y, 2.75, 0, Math.PI * 2);
      c.stroke();
      const dir = align === "left" ? 1 : -1;
      const ex = x + dir * lead;
      c.globalAlpha = 0.55;
      c.beginPath();
      c.moveTo(x + dir * 3, y);
      c.lineTo(ex, y);
      c.stroke();
      c.globalAlpha = 1;
      const widths = lines.map(([txt, kind]) => {
        c.font = kind === "head" ? `600 10px ${mono}` : `500 9.5px ${mono}`;
        return c.measureText(txt).width;
      });
      const w = Math.max(...widths) + 16;
      const h = lines.length * 14 + 8;
      const x0 = align === "left" ? ex : ex - w;
      const y0 = y - 11;
      c.fillStyle = pal.bg;
      c.globalAlpha = 0.86;
      c.fillRect(x0, y0, w, h);
      c.globalAlpha = 1;
      c.strokeStyle = pal.line;
      c.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
      if (accent) {
        c.fillStyle = accent;
        c.fillRect(x0, y0, 2, h);
      }
      c.textAlign = "left";
      c.textBaseline = "middle";
      lines.forEach(([txt, kind], i) => {
        c.font = kind === "head" ? `600 10px ${mono}` : `500 9.5px ${mono}`;
        c.fillStyle = kind === "head" ? pal.text : pal.dim;
        c.fillText(txt, x0 + 8, y0 + 11 + i * 14);
      });
    };

    /** Ring on the roof, a vertical leader, and the chip above it. */
    const flag = (x: number, y: number, lines: [string, string][], align: "left" | "right") => {
      const c = uictx;
      const rise = 34;
      c.strokeStyle = pal.text;
      c.lineWidth = 1;
      c.beginPath();
      c.arc(x, y, 2.75, 0, Math.PI * 2);
      c.stroke();
      c.globalAlpha = 0.55;
      c.beginPath();
      c.moveTo(x, y - 3);
      c.lineTo(x, y - rise);
      c.stroke();
      c.globalAlpha = 1;
      const widths = lines.map(([txt, kind]) => {
        c.font = kind === "head" ? `600 10px ${mono}` : `500 9.5px ${mono}`;
        return c.measureText(txt).width;
      });
      const w = Math.max(...widths) + 16;
      const h = lines.length * 14 + 8;
      const x0 = align === "left" ? x - 0.5 : x - w + 0.5;
      const y0 = y - rise - h;
      c.fillStyle = pal.bg;
      c.globalAlpha = 0.86;
      c.fillRect(x0, y0, w, h);
      c.globalAlpha = 1;
      c.strokeStyle = pal.line;
      c.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
      c.textAlign = "left";
      c.textBaseline = "middle";
      lines.forEach(([txt, kind], i) => {
        c.font = kind === "head" ? `600 10px ${mono}` : `500 9.5px ${mono}`;
        c.fillStyle = kind === "head" ? pal.text : pal.dim;
        c.fillText(txt, x0 + 8, y0 + 11 + i * 14);
      });
    };

    const drawUi = (vp: Mat4, hovered: WallCandle | null, introE: number) => {
      const c = uictx;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, cssW, cssH);
      if (!built || small || introE < 0.97) return;
      c.save();
      c.globalAlpha = Math.min(1, (introE - 0.97) / 0.03);
      c.letterSpacing = "0.12em";

      // wall labels, on the newest building that fits on screen
      for (const side of [1, -1] as const) {
        const list = built.candles.filter((k) => k.side === side);
        for (const k of list) {
          const p = project(vp, [k.x - side * (THICK / 2), k.yh + 0.32, k.z]);
          if (!p) continue;
          const fits = side === 1 ? p.x < cssW - 48 && p.x - 190 > clear.r + 10 : p.x > 48 && p.x + 190 < clear.l - 10;
          if (!fits || p.y < 170) continue;
          flag(p.x, p.y, side === 1 ? [["NQZ6", "head"], ["E-MINI NASDAQ-100 · 1M", "sub"]] : [["ESZ6", "head"], ["E-MINI S&P 500 · 1M", "sub"]], side === 1 ? "right" : "left");
          break;
        }
      }

      // hover read-out
      if (hovered) {
        const p = project(vp, [hovered.x - hovered.side * (THICK / 2), hovered.yh + 0.18, hovered.z]);
        if (p) {
          const align = hovered.side === 1 ? "right" : "left";
          const time = hhmm(SESSION_OPEN_MIN + hovered.t);
          const lines: [string, string][] = [
            [`${hovered.sym} · ${time}`, "head"],
            [`O ${fmt(hovered.o)}  H ${fmt(hovered.h)}`, "sub"],
            [`L ${fmt(hovered.l)}  C ${fmt(hovered.c)}`, "sub"],
          ];
          // open toward the screen edge so the chip never slides under the hero copy
          const outward: "left" | "right" = hovered.side === 1 ? "left" : "right";
          c.font = `500 9.5px ${mono}`;
          const wChip = Math.max(...lines.map(([s2]) => c.measureText(s2).width)) + 16 + 22;
          const fitsOut = outward === "left" ? p.x + wChip < cssW - 8 : p.x - wChip > 8;
          label(p.x, p.y, lines, fitsOut ? outward : align, 22, hovered.c >= hovered.o ? cssVar("--blue") : cssVar("--ember"));
        }
      }
      c.restore();
    };

    // ---------- lifecycle ----------
    const ro = new ResizeObserver(() => {
      resize();
      if (still) draw(performance.now());
    });
    ro.observe(wrap);
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(wrap);
    const offTheme = onThemeChange(() => {
      readColors();
      if (still) draw(performance.now());
    });
    const onLost = (e: Event) => {
      e.preventDefault();
      setFallback(true);
    };
    canvas.addEventListener("webglcontextlost", onLost);
    // fonts can shift the copy after first paint
    const remeasure = window.setInterval(measureClear, 1500);
    document.fonts?.ready.then(measureClear).catch(() => {});

    resize();
    start = performance.now();
    last = start;
    if (still) draw(start);
    else raf = requestAnimationFrame(frame);
    let stillTimer = 0;
    if (still) stillTimer = window.setInterval(() => draw(performance.now()), 1000);

    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(remeasure);
      window.clearInterval(stillTimer);
      ro.disconnect();
      io.disconnect();
      offTheme();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("webglcontextlost", onLost);
    };
  }, [sim, clearSelector]);

  if (fallback) return <DitherGlow variant="horizon" className={className} />;

  return (
    <div ref={wrapRef} className={`${s.wrap} ${className ?? ""}`} aria-hidden="true">
      <canvas ref={glRef} className={s.layer} />
      <canvas ref={uiRef} className={s.layer} />
    </div>
  );
}
