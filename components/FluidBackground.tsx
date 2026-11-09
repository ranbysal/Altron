"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "@/lib/canvas";
import { cssVar, onThemeChange } from "@/lib/theme";

/**
 * Site-wide background: a soft fluid smear that drifts on its own and is
 * pushed around by the pointer. A small stable-fluids simulation (WebGL2)
 * runs at low resolution and is drawn at half the viewport size, since the
 * look is all soft gradients anyway. Falls back to static CSS blobs if
 * WebGL2 or half-float render targets aren't available.
 */

const SIM_RES = 64;
const DYE_RES = 112;
const PRESSURE_ITERS = 10;
const CURL = 0;
const VELOCITY_DISSIPATION = 0.9;
const DYE_DISSIPATION = 0.12;
const RENDER_SCALE = 0.5;

const VERT = `#version 300 es
precision highp float;
in vec2 aPos;
uniform vec2 texel;
out vec2 vUv; out vec2 vL; out vec2 vR; out vec2 vT; out vec2 vB;
void main(){
  vUv = aPos * 0.5 + 0.5;
  vL = vUv - vec2(texel.x, 0.0); vR = vUv + vec2(texel.x, 0.0);
  vT = vUv + vec2(0.0, texel.y); vB = vUv - vec2(0.0, texel.y);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const HEAD = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv; in vec2 vL; in vec2 vR; in vec2 vT; in vec2 vB;
out vec4 o;
`;

const FRAG = {
  splat: `${HEAD}
uniform sampler2D uTarget; uniform float aspect; uniform vec3 color; uniform vec2 point; uniform float radius;
void main(){ vec2 p = vUv - point; p.x *= aspect; vec3 s = exp(-dot(p, p) / radius) * color; o = vec4(texture(uTarget, vUv).xyz + s, 1.0); }`,
  advect: `${HEAD}
uniform sampler2D uVelocity; uniform sampler2D uSource; uniform vec2 velTexel; uniform float dt; uniform float dissipation;
void main(){ vec2 c = vUv - dt * texture(uVelocity, vUv).xy * velTexel; o = texture(uSource, c) / (1.0 + dissipation * dt); o.a = 1.0; }`,
  divergence: `${HEAD}
uniform sampler2D uVelocity;
void main(){
  float L = texture(uVelocity, vL).x; float R = texture(uVelocity, vR).x;
  float T = texture(uVelocity, vT).y; float B = texture(uVelocity, vB).y;
  vec2 C = texture(uVelocity, vUv).xy;
  if (vL.x < 0.0) L = -C.x; if (vR.x > 1.0) R = -C.x; if (vT.y > 1.0) T = -C.y; if (vB.y < 0.0) B = -C.y;
  o = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}`,
  curl: `${HEAD}
uniform sampler2D uVelocity;
void main(){
  float L = texture(uVelocity, vL).y; float R = texture(uVelocity, vR).y;
  float T = texture(uVelocity, vT).x; float B = texture(uVelocity, vB).x;
  o = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
}`,
  vorticity: `${HEAD}
uniform sampler2D uVelocity; uniform sampler2D uCurl; uniform float curl; uniform float dt;
void main(){
  float L = texture(uCurl, vL).x; float R = texture(uCurl, vR).x;
  float T = texture(uCurl, vT).x; float B = texture(uCurl, vB).x; float C = texture(uCurl, vUv).x;
  vec2 f = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  f /= length(f) + 0.0001; f *= curl * C; f.y *= -1.0;
  vec2 v = texture(uVelocity, vUv).xy + f * dt;
  o = vec4(clamp(v, -1000.0, 1000.0), 0.0, 1.0);
}`,
  pressure: `${HEAD}
uniform sampler2D uPressure; uniform sampler2D uDivergence;
void main(){
  float L = texture(uPressure, vL).x; float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x; float B = texture(uPressure, vB).x;
  float d = texture(uDivergence, vUv).x;
  o = vec4((L + R + B + T - d) * 0.25, 0.0, 0.0, 1.0);
}`,
  gradient: `${HEAD}
uniform sampler2D uPressure; uniform sampler2D uVelocity;
void main(){
  float L = texture(uPressure, vL).x; float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x; float B = texture(uPressure, vB).x;
  vec2 v = texture(uVelocity, vUv).xy - vec2(R - L, T - B);
  o = vec4(v, 0.0, 1.0);
}`,
  scale: `${HEAD}
uniform sampler2D uTex; uniform float value;
void main(){ o = value * texture(uTex, vUv); }`,
  display: `${HEAD}
uniform sampler2D uDye; uniform vec3 bg; uniform vec3 blob; uniform vec3 core; uniform float strength;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec2 px = 1.0 / vec2(textureSize(uDye, 0));
  float d = texture(uDye, vUv).r * 0.25;
  d += (texture(uDye, vUv + vec2(px.x, 0.0)).r + texture(uDye, vUv - vec2(px.x, 0.0)).r
      + texture(uDye, vUv + vec2(0.0, px.y)).r + texture(uDye, vUv - vec2(0.0, px.y)).r) * 0.125;
  d += (texture(uDye, vUv + px).r + texture(uDye, vUv - px).r
      + texture(uDye, vUv + vec2(px.x, -px.y)).r + texture(uDye, vUv + vec2(-px.x, px.y)).r) * 0.0625;
  float a = 1.0 - exp(-max(d, 0.0) * strength);
  vec3 c = mix(bg, blob, smoothstep(0.0, 0.85, a));
  c = mix(c, core, smoothstep(0.45, 1.0, a) * 0.6);
  c += (hash(gl_FragCoord.xy) - 0.5) * (2.0 / 255.0);
  o = vec4(c, 1.0);
}`,
};

type FBO = { tex: WebGLTexture; fb: WebGLFramebuffer; w: number; h: number; texel: [number, number] };
type DoubleFBO = { read: FBO; write: FBO; swap: () => void; w: number; h: number; texel: [number, number] };

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "").trim();
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const n = parseInt(full || "000000", 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * The trader pages paint an opaque page over the whole window, so the fluid
 * would simulate every frame for nothing. It only mounts where it can be seen.
 */
export function FluidBackground() {
  const path = usePathname() ?? "/";
  if (path.startsWith("/trader")) return null;
  return <Fluid />;
}

function Fluid() {
  const ref = useRef<HTMLCanvasElement>(null);
  const fallbackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
    const showFallback = () => {
      canvas.style.display = "none";
      if (fallbackRef.current) fallbackRef.current.style.display = "block";
    };
    if (!gl || !(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"))) {
      showFallback();
      return;
    }

    // ---------- GL helpers ----------
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader");
      return s;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    type Prog = { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };
    const programs: Record<keyof typeof FRAG, Prog> = {} as never;
    try {
      (Object.keys(FRAG) as (keyof typeof FRAG)[]).forEach((k) => {
        const p = gl.createProgram()!;
        gl.attachShader(p, vs);
        gl.attachShader(p, compile(gl.FRAGMENT_SHADER, FRAG[k]));
        gl.bindAttribLocation(p, 0, "aPos");
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "link");
        const u: Record<string, WebGLUniformLocation | null> = {};
        const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
        for (let i = 0; i < n; i++) {
          const info = gl.getActiveUniform(p, i);
          if (info) u[info.name] = gl.getUniformLocation(p, info.name);
        }
        programs[k] = { p, u };
      });
    } catch {
      showFallback();
      return;
    }

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const makeFBO = (w: number, h: number): FBO => {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      const fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return { tex, fb, w, h, texel: [1 / w, 1 / h] };
    };
    const makeDouble = (w: number, h: number): DoubleFBO => {
      const d: DoubleFBO = {
        read: makeFBO(w, h),
        write: makeFBO(w, h),
        w,
        h,
        texel: [1 / w, 1 / h],
        swap() {
          const t = d.read;
          d.read = d.write;
          d.write = t;
        },
      };
      return d;
    };
    const resFor = (base: number) => {
      const aspect = window.innerWidth / Math.max(1, window.innerHeight);
      const a = aspect < 1 ? 1 / aspect : aspect;
      const min = Math.round(base);
      const max = Math.round(base * a);
      return aspect >= 1 ? { w: max, h: min } : { w: min, h: max };
    };

    let velocity!: DoubleFBO, dye!: DoubleFBO, pressure!: DoubleFBO, divergence!: FBO, curl!: FBO;
    const allocate = () => {
      const s = resFor(SIM_RES);
      const d = resFor(DYE_RES);
      velocity = makeDouble(s.w, s.h);
      pressure = makeDouble(s.w, s.h);
      divergence = makeFBO(s.w, s.h);
      curl = makeFBO(s.w, s.h);
      dye = makeDouble(d.w, d.h);
    };

    const use = (k: keyof typeof FRAG, texel: [number, number]) => {
      const pr = programs[k];
      gl.useProgram(pr.p);
      if (pr.u.texel) gl.uniform2f(pr.u.texel, texel[0], texel[1]);
      return pr.u;
    };
    let unit = 0;
    const bindTex = (loc: WebGLUniformLocation | null, tex: WebGLTexture) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(loc, unit);
      unit++;
    };
    const blit = (target: FBO | null, w?: number, h?: number) => {
      if (target) {
        gl.viewport(0, 0, target.w, target.h);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
      } else {
        gl.viewport(0, 0, w!, h!);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      unit = 0;
    };

    // ---------- simulation ----------
    const aspect = () => canvas.width / Math.max(1, canvas.height);
    const splat = (x: number, y: number, dx: number, dy: number, amount: number, radius: number) => {
      let u = use("splat", velocity.texel);
      bindTex(u.uTarget, velocity.read.tex);
      gl.uniform1f(u.aspect, aspect());
      gl.uniform2f(u.point, x, y);
      gl.uniform3f(u.color, dx, dy, 0);
      gl.uniform1f(u.radius, radius);
      blit(velocity.write);
      velocity.swap();
      u = use("splat", dye.texel);
      bindTex(u.uTarget, dye.read.tex);
      gl.uniform1f(u.aspect, aspect());
      gl.uniform2f(u.point, x, y);
      gl.uniform3f(u.color, amount, amount, amount);
      gl.uniform1f(u.radius, radius);
      blit(dye.write);
      dye.swap();
    };

    const step = (dt: number) => {
      let u = use("curl", velocity.texel);
      bindTex(u.uVelocity, velocity.read.tex);
      blit(curl);

      u = use("vorticity", velocity.texel);
      bindTex(u.uVelocity, velocity.read.tex);
      bindTex(u.uCurl, curl.tex);
      gl.uniform1f(u.curl, CURL);
      gl.uniform1f(u.dt, dt);
      blit(velocity.write);
      velocity.swap();

      u = use("divergence", velocity.texel);
      bindTex(u.uVelocity, velocity.read.tex);
      blit(divergence);

      u = use("scale", velocity.texel);
      bindTex(u.uTex, pressure.read.tex);
      gl.uniform1f(u.value, 0.8);
      blit(pressure.write);
      pressure.swap();

      for (let i = 0; i < PRESSURE_ITERS; i++) {
        u = use("pressure", velocity.texel);
        bindTex(u.uDivergence, divergence.tex);
        bindTex(u.uPressure, pressure.read.tex);
        blit(pressure.write);
        pressure.swap();
      }

      u = use("gradient", velocity.texel);
      bindTex(u.uPressure, pressure.read.tex);
      bindTex(u.uVelocity, velocity.read.tex);
      blit(velocity.write);
      velocity.swap();

      u = use("advect", velocity.texel);
      bindTex(u.uVelocity, velocity.read.tex);
      bindTex(u.uSource, velocity.read.tex);
      gl.uniform2f(u.velTexel, velocity.texel[0], velocity.texel[1]);
      gl.uniform1f(u.dt, dt);
      gl.uniform1f(u.dissipation, VELOCITY_DISSIPATION);
      blit(velocity.write);
      velocity.swap();

      u = use("advect", dye.texel);
      bindTex(u.uVelocity, velocity.read.tex);
      bindTex(u.uSource, dye.read.tex);
      gl.uniform2f(u.velTexel, velocity.texel[0], velocity.texel[1]);
      gl.uniform1f(u.dt, dt);
      gl.uniform1f(u.dissipation, DYE_DISSIPATION);
      blit(dye.write);
      dye.swap();
    };

    // ---------- colors ----------
    let colors = { bg: [0, 0, 0] as number[], blob: [0, 0, 0] as number[], core: [0, 0, 0] as number[], strength: 2.2 };
    const readColors = () => {
      colors = {
        bg: hexToRgb(cssVar("--fluid-bg") || "#0a0b0d"),
        blob: hexToRgb(cssVar("--fluid-blob") || "#1a2a44"),
        core: hexToRgb(cssVar("--fluid-core") || "#2d4a78"),
        strength: parseFloat(cssVar("--fluid-strength")) || 2.2,
      };
    };
    const render = () => {
      const u = use("display", dye.texel);
      bindTex(u.uDye, dye.read.tex);
      gl.uniform3f(u.bg, colors.bg[0], colors.bg[1], colors.bg[2]);
      gl.uniform3f(u.blob, colors.blob[0], colors.blob[1], colors.blob[2]);
      gl.uniform3f(u.core, colors.core[0], colors.core[1], colors.core[2]);
      gl.uniform1f(u.strength, colors.strength);
      blit(null, canvas.width, canvas.height);
    };

    // ---------- sizing ----------
    const resize = () => {
      const w = Math.max(2, Math.round(window.innerWidth * RENDER_SCALE));
      const h = Math.max(2, Math.round(window.innerHeight * RENDER_SCALE));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };
    resize();
    allocate();
    readColors();

    // A few soft blooms so the page never opens on a blank field.
    const seed = () => {
      const blooms: [number, number, number, number][] = [
        [0.08, 0.8, 0.9, 0.03],
        [0.92, 0.58, 0.95, 0.034],
        [0.34, 0.06, 0.7, 0.026],
        [0.72, 0.95, 0.5, 0.022],
      ];
      blooms.forEach(([x, y, a, r]) => splat(x, y, (Math.random() - 0.5) * 300, (Math.random() - 0.5) * 300, a, r));
    };
    seed();

    // ---------- input ----------
    const pointer = { x: 0.5, y: 0.5, px: 0.5, py: 0.5, moved: false, active: false };
    const onMove = (e: PointerEvent) => {
      const x = e.clientX / window.innerWidth;
      const y = 1 - e.clientY / window.innerHeight;
      if (!pointer.active) {
        pointer.px = x;
        pointer.py = y;
        pointer.active = true;
      }
      pointer.x = x;
      pointer.y = y;
      pointer.moved = true;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    const still = prefersReducedMotion();
    let raf = 0;
    let last = performance.now();
    let t = 0;
    // three slow emitters keep soft blooms drifting near the edges
    const emitters = [
      { ax: 0.12, ay: 0.7, rx: 0.1, ry: 0.22, fx: 0.07, fy: 0.05, ph: 0.0, last: { x: 0, y: 0 } },
      { ax: 0.86, ay: 0.55, rx: 0.1, ry: 0.3, fx: 0.06, fy: 0.08, ph: 2.1, last: { x: 0, y: 0 } },
      { ax: 0.5, ay: 0.12, rx: 0.32, ry: 0.08, fx: 0.045, fy: 0.09, ph: 4.2, last: { x: 0, y: 0 } },
    ];
    emitters.forEach((e) => {
      e.last = { x: e.ax + e.rx * Math.sin(e.ph), y: e.ay + e.ry * Math.cos(e.ph) };
    });

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      t += dt;

      for (const e of emitters) {
        const x = e.ax + e.rx * Math.sin(t * e.fx * 6.283 + e.ph);
        const y = e.ay + e.ry * Math.cos(t * e.fy * 6.283 + e.ph);
        splat(x, y, (x - e.last.x) * 1600, (y - e.last.y) * 1600, 0.0013, 0.026);
        e.last = { x, y };
      }

      if (pointer.moved) {
        const dx = pointer.x - pointer.px;
        const dy = pointer.y - pointer.py;
        const speed = Math.min(1, Math.hypot(dx, dy) * 40);
        splat(pointer.x, pointer.y, dx * 3800, dy * 3800, 0.007 + 0.045 * speed, 0.016);
        pointer.px = pointer.x;
        pointer.py = pointer.y;
        pointer.moved = false;
      }

      step(dt);
      render();
    };

    if (still) {
      for (let i = 0; i < 40; i++) step(0.016);
      render();
    } else {
      raf = requestAnimationFrame(frame);
    }

    const onResize = () => {
      resize();
      if (still) render();
    };
    window.addEventListener("resize", onResize);
    const offTheme = onThemeChange(() => {
      readColors();
      if (still) render();
    });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", onResize);
      offTheme();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return (
    <>
      <canvas ref={ref} aria-hidden="true" className="fluid-bg" />
      <div ref={fallbackRef} aria-hidden="true" className="fluid-fallback" />
    </>
  );
}
