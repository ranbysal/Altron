"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Mark } from "@/components/Mark";
import { prefersReducedMotion } from "@/lib/canvas";
import { LEDGER } from "@/lib/ledger";
import s from "./landing.module.css";

/** Advances a counter every `ms` while `on` is true (and motion is allowed). */
function useCycle(on: boolean, ms: number, count: number) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!on || prefersReducedMotion()) return;
    const id = window.setInterval(() => setI((v) => (v + 1) % count), ms);
    return () => window.clearInterval(id);
  }, [on, ms, count]);
  return i;
}

/* ---------------- live: alerts arriving one after another ---------------- */

const ALERTS = [
  {
    title: "Yazan opened a long",
    body: "2 NQ contracts at 24,476.50",
    levels: [
      ["Stop", "24,452.00", "down"],
      ["Target", "24,525.00", "up"],
    ],
  },
  {
    title: "Yazan moved his stop",
    body: "NQ stop raised to breakeven",
    levels: [
      ["Stop", "24,476.50", "plain"],
      ["Open P&L", "+$860.00", "up"],
    ],
  },
  {
    title: "Yazan closed the long",
    body: "2 NQ at 24,525.00",
    levels: [
      ["Result", "+2.0R", "up"],
      ["P&L", "+$1,940.00", "up"],
    ],
  },
] as const;

function AlertStage({ on }: { on: boolean }) {
  const i = useCycle(on, 4200, ALERTS.length);
  const a = ALERTS[i];
  return (
    <div className={s.stage} aria-hidden="true">
      <div className={s.notifSlot}>
        <div key={i} className={`${s.notif} ${on ? s.notifIn : ""}`}>
          <div className={s.notifHead}>
            <span className={s.notifApp}>
              <Mark size={11} />
            </span>
            <span className={s.notifFrom}>Altron</span>
            <span className={s.notifTime}>now</span>
          </div>
          <p className={s.notifTitle}>{a.title}</p>
          <p className={s.notifBody}>{a.body}</p>
          <div className={s.notifLevels}>
            {a.levels.map(([label, value, tone], k) => (
              <span key={label} style={{ "--d": `${0.25 + k * 0.08}s` } as CSSProperties}>
                <i>{label}</i>
                <b className={tone === "up" ? s.up : tone === "down" ? s.down : undefined}>{value}</b>
              </span>
            ))}
          </div>
        </div>
      </div>
      <div key={`c${i}`} className={`${s.notifChannels} ${on ? s.channelsIn : ""}`}>
        <span>
          <i className={s.notifCheck} />
          Discord
        </span>
        <span>
          <i className={s.notifCheck} />
          WhatsApp
        </span>
      </div>
    </div>
  );
}

/* ---------------- reasoning: notes written before and after ---------------- */

const NOTES = [
  { label: "DESK NOTE · BEFORE ENTRY", time: "10:21", text: "Reclaim of the overnight high on volume. Wrong below the 10:15 low." },
  { label: "DESK NOTE · AFTER EXIT", time: "11:14", text: "Out at the target. The 10:58 dip held above entry, so I stayed in." },
] as const;

function NoteStage({ on }: { on: boolean }) {
  const i = useCycle(on, 5200, NOTES.length);
  const n = NOTES[i];
  return (
    <div className={s.stage} aria-hidden="true">
      <div className={s.mini}>
        <div className={s.miniRow}>
          <span key={`l${i}`} className={`${s.miniLabel} ${on ? s.fadeIn : ""}`}>
            {n.label}
          </span>
          <span className={s.miniLabel}>{n.time}</span>
        </div>
        <p key={i} className={s.miniQuote}>
          {`\u201c${n.text}\u201d`.split(" ").map((w, k) => (
            <span key={k} className={on ? s.word : undefined} style={{ "--d": `${0.12 + k * 0.045}s` } as CSSProperties}>
              {w}{" "}
            </span>
          ))}
        </p>
        <div className={s.miniRow} style={{ marginTop: 10, justifyContent: "flex-start", fontSize: 12, color: "var(--muted)" }}>
          <span className={`${s.avatar} ${s.avatarSm}`}>Y</span>Yazan
        </div>
      </div>
    </div>
  );
}

/* ---------------- record: each closed trade lands on top ---------------- */

const SHOWN = 4;
type Row = { date: string; mkt: string; side: "LONG" | "SHORT"; r: string; win: boolean };
/** Today's closes, landing on top of the record one at a time. */
const TODAY: Row[] = [
  { date: "Nov 06", mkt: "NQZ6", side: "LONG", r: "+2.0R", win: true },
  { date: "Nov 06", mkt: "MESZ6", side: "SHORT", r: "+0.8R", win: true },
  { date: "Nov 06", mkt: "ESZ6", side: "LONG", r: "−1.0R", win: false },
  { date: "Nov 06", mkt: "MNQZ6", side: "LONG", r: "+1.2R", win: true },
];

function RecordStage({ on }: { on: boolean }) {
  const step = useCycle(on, 3000, TODAY.length + 1);
  const rows: Row[] = [...TODAY.slice(0, step).reverse(), ...LEDGER].slice(0, SHOWN + 1);
  const cls = !on ? "" : step ? s.recordShift : s.fadeIn;
  return (
    <div className={s.stage} aria-hidden="true">
      <div className={`${s.mini} ${s.recordBox}`}>
        <div key={step} className={`${s.recordList} ${cls}`}>
          {rows.map((r, j) => (
            <div key={j} className={`${s.miniLedgerRow} ${j === 0 && on && step ? s.rowNew : ""}`}>
              <span style={{ color: "var(--dim)" }}>{r.date}</span>
              <span className={s.mono} style={{ fontSize: 12 }}>
                {r.side === "LONG" ? "L" : "S"} · {r.mkt}
              </span>
              <span className={r.win ? s.up : s.down}>{r.r}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const FEATURES = [
  {
    title: "Positions in real time.",
    body: "See entries, stops, targets, and position updates as they happen. Trade alerts are delivered directly to communication channels.",
    Stage: AlertStage,
  },
  {
    title: "Context behind every trade.",
    body: "Read the trader’s notes before and after each position, including the setup, reasoning, and what changed along the way.",
    Stage: NoteStage,
  },
  {
    title: "A complete trading history.",
    body: "Every closed position is recorded, including losses. Review past trades, execution levels, and performance over time.",
    Stage: RecordStage,
  },
];

export function Membership() {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        setLive(e.isIntersecting);
        if (e.isIntersecting) setSeen(true);
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const track = (e: React.PointerEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };

  return (
    <section className={s.members}>
      <div className={`${s.container} ${s.stack56}`}>
        <div className={s.membersHead}>
          <h2 className={s.h2}>
            See the whole trade, <em>not just the result.</em>
          </h2>
        </div>
        <div ref={ref} className={`${s.features} ${seen ? s.featuresIn : ""}`}>
          {FEATURES.map(({ title, body, Stage }, k) => (
            <article
              key={title}
              className={s.feature}
              style={{ "--k": k } as CSSProperties}
              onPointerMove={track}
            >
              <Stage on={live} />
              <div className={s.featureBody}>
                <h3 className={s.h3}>{title}</h3>
                <p>{body}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
