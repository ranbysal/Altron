"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import s from "./trader.module.css";

/** A sheet cell: hairline edges that draw in, with square nodes at the corners. */
export function Cell({
  children,
  i = 0,
  className,
  style,
  label,
  aside,
}: {
  children?: ReactNode;
  i?: number;
  className?: string;
  style?: CSSProperties;
  label?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className={`${s.cell} ${className ?? ""}`} style={{ "--i": i, ...style } as CSSProperties}>
      <i className={s.lineT} aria-hidden="true" />
      <i className={s.lineL} aria-hidden="true" />
      <i className={`${s.node} ${s.nTL}`} aria-hidden="true" />
      <i className={`${s.node} ${s.nTR}`} aria-hidden="true" />
      <i className={`${s.node} ${s.nBL}`} aria-hidden="true" />
      <i className={`${s.node} ${s.nBR}`} aria-hidden="true" />
      <div className={s.cellIn}>
        {(label || aside) && (
          <header className={s.cellHead}>
            <div className={s.label}>{label}</div>
            {aside && <div className={s.aside}>{aside}</div>}
          </header>
        )}
        {children}
      </div>
    </section>
  );
}

/**
 * Digits that roll into place, units first. Starts from zeros on first paint so
 * the numbers count in with the rest of the sheet.
 */
export function Odometer({ value, className, delay = 260 }: { value: string; className?: string; delay?: number }) {
  const [shown, setShown] = useState(() => value.replace(/\d/g, "0"));
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (live) {
      setShown(value);
      return;
    }
    const id = window.setTimeout(() => {
      setShown(value);
      setLive(true);
    }, delay);
    return () => window.clearTimeout(id);
  }, [value, live, delay]);

  const chars = shown.split("");
  return (
    <span className={`${s.odo} ${live ? s.odoLive : ""} ${className ?? ""}`}>
      <span className="sr-only">{value}</span>
      {chars.map((ch, i) => {
        const key = chars.length - i;
        if (!/\d/.test(ch)) {
          return (
            <span key={`s${key}`} className={s.odoSep} aria-hidden="true">
              {ch}
            </span>
          );
        }
        return (
          <span key={key} className={s.odoCol} aria-hidden="true">
            <span
              className={s.odoStrip}
              style={{ transform: `translateY(${-Number(ch) * 10}%)`, transitionDelay: live ? "0ms" : `${(chars.length - i) * 45}ms` }}
            >
              {"0123456789".split("").map((d) => (
                <span key={d}>{d}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** Splits "+$12,480.50" into the whole part and the cents, so the cents can sit back. */
export function Money({ value, className, delay }: { value: string; className?: string; delay?: number }) {
  const dot = value.lastIndexOf(".");
  if (dot < 0) return <Odometer value={value} className={className} delay={delay} />;
  return (
    <span className={className}>
      <Odometer value={value.slice(0, dot)} delay={delay} />
      <span className={s.cents}>
        <Odometer value={value.slice(dot)} delay={delay} />
      </span>
    </span>
  );
}

/** Thin sparkline with a square end marker in brackets. */
export function Spark({
  values,
  tone = "plain",
  height = 44,
  baseline,
  className,
  delay = 0,
}: {
  values: number[];
  tone?: "plain" | "pos" | "neg";
  height?: number;
  baseline?: number;
  className?: string;
  delay?: number;
}) {
  const w = 240;
  const h = height;
  if (values.length < 2) return <svg className={className} viewBox={`0 0 ${w} ${h}`} />;
  const min = Math.min(...values, baseline ?? Infinity);
  const max = Math.max(...values, baseline ?? -Infinity);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (w - 10), h - 4 - ((v - min) / span) * (h - 10)]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1];
  const by = baseline !== undefined ? h - 4 - ((baseline - min) / span) * (h - 10) : null;
  return (
    <svg className={`${s.spark} ${s[`spark_${tone}`]} ${className ?? ""}`} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ "--d": `${delay}ms` } as CSSProperties}>
      {by !== null && <line x1="0" x2={w - 10} y1={by} y2={by} className={s.sparkBase} />}
      <path d={d} className={s.sparkLine} pathLength={1} />
      <g className={s.sparkEnd} transform={`translate(${lx} ${ly})`}>
        <rect x="-2.5" y="-2.5" width="5" height="5" />
        <path d="M-6 -3.5 V-6 H-3.5 M3.5 -6 H6 V-3.5 M6 3.5 V6 H3.5 M-3.5 6 H-6 V3.5" className={s.sparkBracket} />
      </g>
    </svg>
  );
}

/** A row of thin lines filled up to a share, like a progress bar drawn as a barcode. */
export function LineMeter({ share, count = 64, tone = "plain" }: { share: number; count?: number; tone?: "plain" | "pos" | "neg" }) {
  const on = Math.round(share * count);
  return (
    <div className={`${s.meter} ${s[`meter_${tone}`]}`} aria-hidden="true">
      {Array.from({ length: count }, (_, k) => (
        <i key={k} className={k < on ? s.meterOn : undefined} style={{ "--k": k } as CSSProperties} />
      ))}
    </div>
  );
}
