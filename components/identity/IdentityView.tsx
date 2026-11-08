"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Mark } from "@/components/Mark";
import { bayer } from "@/lib/noise";
import s from "./identity.module.css";

const SWATCHES = [
  { name: "OBSIDIAN", hex: "#0A0B0D", use: "ground", fg: "#A3ACB6" },
  { name: "GRAPHITE", hex: "#111317", use: "panels", fg: "#A3ACB6" },
  { name: "NAVY", hex: "#1C2633", use: "depth", fg: "#C3CAD2" },
  { name: "SLATE", hex: "#A8B5C2", use: "atmosphere", fg: "#0A0B0D" },
  { name: "BONE", hex: "#E9ECEF", use: "text", fg: "#0A0B0D" },
  { name: "SIGNAL", hex: "#4DA3FF", use: "long, profit", fg: "#04101C" },
  { name: "MAGENTA", hex: "#FD50BC", use: "live, stop, loss", fg: "#1A0414" },
];

function BayerTile({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const paint = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      const cell = 4;
      const gw = Math.ceil(w / cell);
      const gh = Math.ceil(h / cell);
      el.width = gw;
      el.height = gh;
      const ctx = el.getContext("2d");
      if (!ctx) return;
      const img = ctx.createImageData(gw, gh);
      const D = img.data;
      const pal = [[10, 11, 13], [28, 38, 51], [44, 62, 80], [77, 163, 255], [168, 181, 194], [233, 236, 239]];
      for (let y = 0; y < gh; y++) {
        for (let x = 0; x < gw; x++) {
          const dx = x / gw - 0.5;
          const dy = y / gh - 1.05;
          const d = Math.sqrt(dx * dx * 1.4 + dy * dy);
          const tone = Math.max(0, Math.min(4.999, 5.2 * Math.exp(-Math.pow(d - 0.62, 2) / 0.03) + (1 - y / gh) * 0.6));
          const lo = Math.floor(tone);
          const idx = tone - lo > bayer(x, y) ? lo + 1 : lo;
          const c = pal[Math.min(5, idx)];
          const o = (y * gw + x) * 4;
          D[o] = c[0];
          D[o + 1] = c[1];
          D[o + 2] = c[2];
          D[o + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    };
    const ro = new ResizeObserver(paint);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return <canvas ref={ref} aria-hidden="true" className={className} />;
}

export function IdentityView() {
  return (
    <main className={s.page}>
      <div className={s.head}>
        <span>ALTRON · IDENTITY · V0.1</span>
        <span>DARK FIRST · DATA SECOND · ORNAMENT LAST</span>
        <Link href="/">← BACK TO SITE</Link>
      </div>

      <div className={s.grid}>
        <section className={`${s.tile} ${s.span4} ${s.markTile}`} aria-label="Mark">
          <span className={s.cap}>MARK</span>
          <div className={s.markPair}>
            <div className={s.markSwatch} style={{ background: "#000", color: "#fff" }}>
              <Mark size={120} />
              <span>DARK · FAVICON</span>
            </div>
            <div className={s.markSwatch} style={{ background: "#fff", color: "#000" }}>
              <Mark size={120} />
              <span>LIGHT</span>
            </div>
          </div>
          <p>A four-point star with concave arms, taller than it is wide. White on black in dark mode and as the browser icon; black on white in light mode.</p>
        </section>

        <section className={`${s.tile} ${s.span8} ${s.wordTile}`} aria-label="Wordmark">
          <div className={s.wordTop}>
            <span>WORDMARK · ON SLATE</span>
            <span>#2C3E50 → #A8B5C2</span>
          </div>
          <div className={s.wordLock}>
            <Mark size={96} color="#0A0B0D" />
            <span className={s.word}>Altron</span>
          </div>
          <div className={s.wordBottom}>
            <em>Every trade, in plain sight.</em>
            <span>GEIST 500 · −4.5% TRACKING</span>
          </div>
        </section>

        <section className={s.palette} aria-label="Palette">
          {SWATCHES.map((c) => (
            <div key={c.hex} className={s.swatch} style={{ background: c.hex, color: c.fg }}>
              <span>{c.name}</span>
              <span>
                {c.hex} · {c.use}
              </span>
            </div>
          ))}
        </section>

        <section className={`${s.tile} ${s.span7} ${s.typeTile}`} aria-label="Type">
          <span className={s.cap}>TYPE</span>
          <div className={s.spec}>
            <span style={{ fontFamily: "var(--serif)", fontSize: 56, lineHeight: 1 }}>
              Watch the <em>position.</em>
            </span>
            <small>INSTRUMENT SERIF · VOICE</small>
          </div>
          <div className={s.spec}>
            <span style={{ fontSize: 34, fontWeight: 300, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
              Long 2 × NQZ6 · 24,476.50
            </span>
            <small>GEIST · INTERFACE</small>
          </div>
          <div className={s.spec}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 18, letterSpacing: "0.08em", color: "var(--soft)" }}>
              [10:33:07] FILLED BUY 2 NQZ6
            </span>
            <small>GEIST MONO · DATA, LABELS</small>
          </div>
        </section>

        <div className={`${s.span5} ${s.motifs}`}>
          <section className={s.motif} aria-label="Dither motif">
            <BayerTile className={s.fill} />
            <span className={s.badge}>DITHER · 4×4 BAYER</span>
          </section>
          <section className={s.motif} aria-label="Reticle motif">
            <span aria-hidden="true" className={s.cross} style={{ left: "50%", top: 0, bottom: 0, width: 1 }} />
            <span aria-hidden="true" className={s.cross} style={{ top: "50%", left: 0, right: 0, height: 1 }} />
            <div aria-hidden="true" className={s.ret}>
              <div className={`${s.ring} spin-slow`} />
              <div className={s.core} />
              <div className={s.pip} />
              <span className={s.node} style={{ left: -84, top: -88 }} />
              <span className={s.node} style={{ left: 76, top: 80 }} />
            </div>
            <span className={s.badge}>RETICLE · SURVEY NODES</span>
            <span className={s.foot}>[ BRACKETED LABELS ]</span>
          </section>
        </div>
      </div>
    </main>
  );
}
