"use client";

import { useEffect, useRef, useState } from "react";
import { SectionLabel } from "./SectionLabel";
import s from "./landing.module.css";

const NODES = [60, 276, 492, 708, 924, 1140];
const LABELS = ["THESIS", "ENTRY", "RISK", "MANAGEMENT", "EXIT", "REVIEW"];
const STAGES = [
  "A reason written down before the order is.",
  "Price, size and time, logged on the fill.",
  "Stop and target set with the entry, visible to every member.",
  "Every stop move and partial exit shows up on the tape.",
  "Target, stop or a broken thesis — recorded either way.",
  "A note after the close, for wins and losses alike.",
];

export function Method() {
  const ref = useRef<SVGSVGElement>(null);
  const [on, setOn] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setOn(true);
          io.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section id="method" className={s.method}>
      <div className={`${s.container} ${s.stack56}`}>
        <SectionLabel>03 — METHOD</SectionLabel>
        <div className={s.center}>
          <h2 className={s.h2}>
            Every trade starts
            <br />
            at the same point.
          </h2>
          <p className={s.kicker} style={{ margin: 0, color: "var(--dim)" }}>
            [ SIX STAGES · ONE ORIGIN · LOGGED AT EVERY STEP ]
          </p>
        </div>
        <svg
          ref={ref}
          viewBox="0 0 1200 500"
          role="img"
          aria-label="Arc diagram: the thesis is the origin of five arcs reaching entry, risk, management, exit and review"
          className={`${s.arcs} ${on ? s.arcsOn : ""}`}
        >
          <g fill="none" strokeWidth="1.2">
            {NODES.slice(1).map((x, i) => {
              const rx = (x - 60) / 2;
              const last = i === NODES.length - 2;
              return (
                <path
                  key={x}
                  className={s.arc}
                  pathLength={1}
                  d={`M 60 450 A ${rx} ${rx * 0.75} 0 0 1 ${x} 450`}
                  stroke={last ? "#4DA3FF" : `rgba(233,236,239,${0.45 - i * 0.05})`}
                  style={{ animationDelay: `${0.1 + i * 0.2}s` }}
                />
              );
            })}
          </g>
          <line x1="40" y1="450" x2="1160" y2="450" stroke="rgba(255,255,255,0.08)" strokeDasharray="2 6" />
          {NODES.map((x, i) => (
            <circle key={x} cx={x} cy={450} r={i === 0 || i === 5 ? 5 : 4} fill={i === 5 ? "#4DA3FF" : "#E9ECEF"} />
          ))}
          <g fontFamily="var(--mono)" fontSize="13" letterSpacing="1.6" textAnchor="middle">
            {NODES.map((x, i) => (
              <text key={x} x={x} y={484} fill={i === 5 ? "#8EC5FF" : "#A3ACB6"}>
                {LABELS[i]}
              </text>
            ))}
          </g>
        </svg>
        <div className={s.stages}>
          {STAGES.map((t, i) => (
            <div key={i} className={s.stage}>
              <span style={i === 5 ? { color: "var(--blue-soft)" } : undefined}>0{i + 1}</span>
              <span>{t}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
