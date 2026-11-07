"use client";

import { useEffect, useRef } from "react";
import { hash2 } from "@/lib/noise";
import { prefersReducedMotion } from "@/lib/canvas";
import { currentTheme, onThemeChange, type Theme } from "@/lib/theme";

/*
 * The Altron star as a sculpted "specimen" drawn in character cells.
 *
 * The shape is an analytic four-point star |u|^P + |v|^P < 1 (P < 1 gives
 * the concave arms). Its height field has a crease along each axis, so the
 * star reads as a faceted, bevelled object; it is lit from the upper left
 * and swings slowly on its vertical axis, so light rolls across the facets.
 * On top of that: contour rings that pulse outward, a scan line that sweeps
 * down and scrambles the cells it passes, a lens around the pointer, and
 * two SECTION trackers that move between regions of the star.
 */

const RAMP = " .,:;-=+*tos%SX8#@";
const TIERS = 8;
const P = 0.6;

type Palette = {
  tile: (k: number) => string;
  glyph: (k: number) => string;
  plate: string;
  dash: string;
  frame: string;
  frameFaint: string;
  chipBg: string;
  chipFg: string;
  readout: string;
  lensRing: string;
};

const PALETTES: Record<Theme, Palette> = {
  dark: {
    tile: (k) => `rgba(${70 + k * 8},${108 + k * 9},${158 + k * 8},${0.05 + k * 0.05})`,
    glyph: (k) => {
      const t = k / (TIERS - 1);
      const r = Math.round(96 + t * 159);
      const g = Math.round(134 + t * 121);
      const b = Math.round(186 + t * 69);
      return `rgba(${r},${g},${b},${0.5 + t * 0.5})`;
    },
    plate: "rgba(150,180,220,0.09)",
    dash: "rgba(127,168,214,0.32)",
    frame: "rgba(233,239,246,0.85)",
    frameFaint: "rgba(233,239,246,0.18)",
    chipBg: "#e9eff6",
    chipFg: "#0a0f16",
    readout: "rgba(200,214,234,0.62)",
    lensRing: "rgba(233,239,246,0.4)",
  },
  light: {
    tile: (k) => `rgba(${46 - k * 3},${84 - k * 5},${142 - k * 6},${0.04 + k * 0.035})`,
    glyph: (k) => {
      const t = k / (TIERS - 1);
      const r = Math.round(96 - t * 88);
      const g = Math.round(128 - t * 108);
      const b = Math.round(176 - t * 140);
      return `rgba(${r},${g},${b},${0.55 + t * 0.45})`;
    },
    plate: "rgba(30,50,90,0.10)",
    dash: "rgba(40,70,120,0.3)",
    frame: "rgba(10,18,30,0.8)",
    frameFaint: "rgba(10,18,30,0.16)",
    chipBg: "#0e1116",
    chipFg: "#f6f7f9",
    readout: "rgba(20,32,52,0.62)",
    lensRing: "rgba(10,18,30,0.32)",
  },
};

type Tracker = { x: number; y: number; w: number; h: number; tx: number; ty: number; tw: number; th: number; id: number; next: number; u: number; v: number };

function monoFamily(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--font-geist-mono").trim();
  return `${v ? v + ", " : ""}ui-monospace, SFMono-Regular, Menlo, monospace`;
}

export function AsciiStar({ className, focusX = 0.5 }: { className?: string; focusX?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const focus = useRef(focusX);
  focus.current = focusX;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const still = prefersReducedMotion();
    const mono = monoFamily();
    let theme: Theme = currentTheme();
    let pal = PALETTES[theme];

    // glyph atlas: one pre-rendered tile per (brightness tier, glyph)
    const atlas = document.createElement("canvas");
    let atlasKey = "";
    const buildAtlas = (cw: number, ch: number, dpr: number) => {
      const key = `${cw}|${ch}|${dpr}|${theme}`;
      if (key === atlasKey) return;
      atlasKey = key;
      atlas.width = Math.ceil(RAMP.length * cw * dpr);
      atlas.height = Math.ceil(TIERS * ch * dpr);
      const a = atlas.getContext("2d")!;
      a.setTransform(dpr, 0, 0, dpr, 0, 0);
      a.clearRect(0, 0, RAMP.length * cw, TIERS * ch);
      a.font = `600 ${Math.round(cw * 1.08)}px ${mono}`;
      a.textAlign = "center";
      a.textBaseline = "middle";
      for (let k = 0; k < TIERS; k++) {
        for (let g = 0; g < RAMP.length; g++) {
          const x = g * cw;
          const y = k * ch;
          a.fillStyle = pal.tile(k);
          a.fillRect(x + 1, y + 1, cw - 2, ch - 2);
          if (g > 0) {
            a.fillStyle = pal.glyph(k);
            a.fillText(RAMP[g], x + cw / 2, y + ch / 2 + 0.5);
          }
        }
      }
    };

    // faint dot plate around the specimen, cached
    const plate = document.createElement("canvas");
    let plateKey = "";
    const buildPlate = (w: number, h: number, dpr: number, cw: number, ch: number, cx: number, cy: number, R: number) => {
      const key = `${w}|${h}|${dpr}|${cw}|${Math.round(cx)}|${Math.round(cy)}|${Math.round(R)}|${theme}`;
      if (key === plateKey) return;
      plateKey = key;
      plate.width = Math.round(w * dpr);
      plate.height = Math.round(h * dpr);
      const p = plate.getContext("2d")!;
      p.setTransform(dpr, 0, 0, dpr, 0, 0);
      p.clearRect(0, 0, w, h);
      p.fillStyle = pal.plate;
      for (let y = ch / 2; y < h; y += ch) {
        for (let x = cw / 2; x < w; x += cw) {
          const d = Math.hypot((x - cx) / R, (y - cy) / (R * 1.05));
          if (d > 1) continue;
          const a = 1 - d;
          if (hash2(Math.round(x), Math.round(y)) > a * 1.6) continue;
          p.globalAlpha = Math.min(1, 0.25 + a);
          p.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
        }
      }
      p.globalAlpha = 1;
    };

    const trackers: Tracker[] = [0, 1].map((i) => ({ x: 0, y: 0, w: 0, h: 0, tx: 0, ty: 0, tw: 0, th: 0, id: 0, next: i * 1.6, u: 0, v: 0 }));
    let seed = 7;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };

    const mouse = { x: -1e4, y: -1e4, k: 0, target: 0 };
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
      mouse.target = 1;
    };
    const onLeave = () => (mouse.target = 0);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);

    const light = (() => {
      const l = [-0.52, -0.62, 0.59];
      const n = Math.hypot(l[0], l[1], l[2]);
      return [l[0] / n, l[1] / n, l[2] / n];
    })();

    const inside: number[] = [];

    const draw = (t: number) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
      }
      const ctx = el.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const small = w < 900;
      const cw = small ? 7 : 8;
      const ch = small ? 10 : 11;
      buildAtlas(cw, ch, dpr);

      // geometry
      const B = small ? Math.min(h * 0.44, w * 0.95) : Math.min(h * 0.4, w * 0.3); // half height, px
      const A = B * 0.74; // half width before the turn
      const cx = (small ? 0.5 : focus.current) * w;
      const cy = small ? h * 0.5 : h * 0.47;
      const theta = still ? 0.18 : 0.62 * Math.sin(t * 0.3);
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      const At = A * Math.max(0.3, cosT);

      buildPlate(w, h, dpr, cw, ch, cx, cy, B * 1.35);
      ctx.drawImage(plate, 0, 0, w, h);

      // pointer lens strength eases in and out
      mouse.k += (mouse.target - mouse.k) * 0.15;
      const lensR = small ? 90 : 140;
      const frame = Math.floor(t * 8);
      const ringPhase = t * 0.22;
      const scanSpan = B * 2.6;
      const scanY = cy - B * 1.3 + ((t * 0.075) % 1) * scanSpan;

      const col0 = Math.max(0, Math.floor((cx - A - cw * 3) / cw));
      const col1 = Math.min(Math.ceil(w / cw), Math.ceil((cx + A + cw * 3) / cw));
      const row0 = Math.max(0, Math.floor((cy - B - ch * 3) / ch));
      const row1 = Math.min(Math.ceil(h / ch), Math.ceil((cy + B + ch * 3) / ch));
      inside.length = 0;
      const sw = cw * dpr;
      const sh = ch * dpr;

      for (let row = row0; row < row1; row++) {
        const py = row * ch + ch / 2;
        for (let col = col0; col < col1; col++) {
          const px = col * cw + cw / 2;

          // lens: sample closer to the pointer → local magnification
          let sx = px;
          let sy = py;
          let boost = 0;
          if (mouse.k > 0.01) {
            const dx = px - mouse.x;
            const dy = py - mouse.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < lensR * lensR) {
              const k = 1 - Math.sqrt(d2) / lensR;
              const f = 1 - 0.38 * k * k * mouse.k;
              sx = mouse.x + dx * f;
              sy = mouse.y + dy * f;
              boost = 0.32 * k * mouse.k;
            }
          }

          const u = (sx - cx) / At;
          const v = (sy - cy) / B;
          const au = Math.abs(u) + 1e-4;
          const av = Math.abs(v) + 1e-4;
          let F = Math.pow(au, P) + Math.pow(av, P);
          // keep each arm's spine continuous out to the tip
          const spine = (Math.abs(sx - cx) < cw * 0.55 && av < 1) || (Math.abs(sy - cy) < ch * 0.55 && au < 1);
          if (F >= 1 && spine) F = 0.995;

          if (F >= 1) {
            // sparse scan noise hugging the outline
            if (F < 1.12 && hash2(col * 3 + frame, row) > 0.9) {
              ctx.fillStyle = pal.dash;
              ctx.fillRect(px - cw * 0.3, py, cw * 0.6, 1);
            }
            continue;
          }

          // normal of the bevelled surface z = D(1 - F), then the swing about the vertical axis
          const gu = P * Math.pow(au, P - 1) * Math.sign(u);
          const gv = P * Math.pow(av, P - 1) * Math.sign(v);
          let nx = 0.5 * gu * (B / At);
          const ny = 0.5 * gv;
          let nz = 1;
          const rx = nx * cosT + nz * sinT;
          nz = -nx * sinT + nz * cosT;
          nx = rx;
          const nl = Math.hypot(nx, ny, nz);
          const NdotL = (nx * light[0] + ny * light[1] + nz * light[2]) / nl;
          const diffuse = Math.pow(NdotL * 0.5 + 0.5, 1.6); // wrapped light keeps the shadow side readable
          const rz = 2 * NdotL * (nz / nl) - light[2];
          const spec = Math.pow(Math.max(0, rz), 22);

          let I = 0.08 + 0.66 * diffuse + 0.55 * spec;
          if (F > 0.9) I = Math.max(I, 0.62 + (F - 0.9) * 3.2); // bright rim
          const ring = (((F * 4.2 - ringPhase) % 1) + 1) % 1;
          if (ring < 0.07) I += 0.16;
          const ds = Math.abs(py - scanY);
          let scramble = false;
          if (ds < ch * 1.5) {
            I += 0.42 * (1 - ds / (ch * 1.5));
            scramble = ds < ch * 0.6;
          }
          I += boost;
          if (hash2(col + frame * 13, row * 7) > 0.986) I += 0.3;
          I = Math.max(0, Math.min(0.999, I));

          const tier = Math.min(TIERS - 1, Math.floor(I * TIERS));
          let gi = Math.round(I * (RAMP.length - 1) + (hash2(col, row + frame) - 0.5) * 2);
          if (scramble) gi = 1 + Math.floor(hash2(col * 7 + frame, row) * (RAMP.length - 1));
          gi = Math.max(1, Math.min(RAMP.length - 1, gi));
          ctx.drawImage(atlas, gi * sw, tier * sh, sw, sh, col * cw, row * ch, cw, ch);
          if ((col + row) % 3 === 0) inside.push(col, row);
        }
      }

      // lens ring
      if (mouse.k > 0.05) {
        ctx.strokeStyle = pal.lensRing;
        ctx.globalAlpha = mouse.k;
        ctx.lineWidth = 1;
        ctx.setLineDash([1, 5]);
        ctx.beginPath();
        ctx.arc(mouse.x, mouse.y, lensR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(mouse.x - 6, mouse.y); ctx.lineTo(mouse.x + 6, mouse.y);
        ctx.moveTo(mouse.x, mouse.y - 6); ctx.lineTo(mouse.x, mouse.y + 6);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // SECTION trackers (desktop only: on a phone the panel covers the star)
      if (!small && inside.length > 80) {
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        for (const tr of trackers) {
          if (t >= tr.next || tr.tw === 0) {
            // pick a spot well away from the other tracker
            const other = trackers.find((o) => o !== tr);
            let pc = 0;
            let pr = 0;
            for (let attempt = 0; attempt < 8; attempt++) {
              const i = Math.floor(rnd() * (inside.length / 2)) * 2;
              pc = inside[i];
              pr = inside[i + 1];
              if (!other || other.tw === 0 || Math.hypot(pc * cw - (other.tx + other.tw / 2), pr * ch - (other.ty + other.th / 2)) > B * 0.55) break;
            }
            tr.tw = (6 + Math.floor(rnd() * 6)) * cw;
            tr.th = (5 + Math.floor(rnd() * 6)) * ch;
            tr.tx = Math.max(8, Math.min(w - tr.tw - 8, pc * cw - tr.tw * 0.35));
            tr.ty = Math.max(30, Math.min(h - tr.th - 26, pr * ch - tr.th * 0.35));
            tr.id = 10 + Math.floor(rnd() * 89);
            tr.u = (pc * cw - cx) / A;
            tr.v = -(pr * ch - cy) / B;
            tr.next = t + 2.4 + rnd() * 2;
            if (tr.w === 0) Object.assign(tr, { x: tr.tx, y: tr.ty, w: tr.tw, h: tr.th });
          }
          const e = still ? 1 : 0.16;
          tr.x += (tr.tx - tr.x) * e;
          tr.y += (tr.ty - tr.y) * e;
          tr.w += (tr.tw - tr.w) * e;
          tr.h += (tr.th - tr.h) * e;
          const x = Math.round(tr.x) + 0.5;
          const y = Math.round(tr.y) + 0.5;
          const bw = Math.round(tr.w);
          const bh = Math.round(tr.h);
          // faint box + strong corner brackets
          ctx.strokeStyle = pal.frameFaint;
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, bw, bh);
          ctx.strokeStyle = pal.frame;
          const c = 7;
          ctx.beginPath();
          ctx.moveTo(x, y + c); ctx.lineTo(x, y); ctx.lineTo(x + c, y);
          ctx.moveTo(x + bw - c, y); ctx.lineTo(x + bw, y); ctx.lineTo(x + bw, y + c);
          ctx.moveTo(x + bw, y + bh - c); ctx.lineTo(x + bw, y + bh); ctx.lineTo(x + bw - c, y + bh);
          ctx.moveTo(x + c, y + bh); ctx.lineTo(x, y + bh); ctx.lineTo(x, y + bh - c);
          ctx.stroke();
          // label chip
          ctx.font = `600 10.5px ${mono}`;
          const label = `SECTION ${tr.id}`;
          const lw = Math.ceil(ctx.measureText(label).width) + 12;
          ctx.fillStyle = pal.chipBg;
          ctx.fillRect(x - 0.5, y - 17.5, lw, 17);
          ctx.fillStyle = pal.chipFg;
          ctx.fillText(label, x + 5.5, y - 8.5);
          // coordinates under the box
          ctx.font = `500 9.5px ${mono}`;
          ctx.fillStyle = pal.readout;
          const fmt = (n: number) => (n < 0 ? "−" : "+") + Math.abs(n).toFixed(2);
          ctx.fillText(`U ${fmt(tr.u)}  V ${fmt(tr.v)}`, x, y + bh + 11);
        }
      }
    };

    let raf = 0;
    let last = -1e9;
    let visible = true;
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || ts - last < 50) return;
      last = ts;
      draw(ts / 1000);
    };
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(el);
    const offTheme = onThemeChange((th) => {
      theme = th;
      pal = PALETTES[th];
      atlasKey = "";
      plateKey = "";
      if (still) draw(0);
    });
    let ro: ResizeObserver | null = null;
    if (still) {
      ro = new ResizeObserver(() => draw(0));
      ro.observe(el);
    } else {
      raf = requestAnimationFrame(loop);
    }
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro?.disconnect();
      offTheme();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className={className} />;
}
