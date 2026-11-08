"use client";

import { useState, type CSSProperties } from "react";
import { hhmm, money, signed } from "@/lib/format";
import { dayLabel, type Trade } from "@/lib/journal";
import s from "./trader.module.css";

const COUNT = 100;

function k(n: number): string {
  const a = Math.abs(n);
  const v = a >= 1000 ? `$${(a / 1000).toFixed(1)}k` : `$${a.toFixed(0)}`;
  return (n < 0 ? "−" : "+") + v;
}

/** The last hundred trades as one barcode, grouped into wins, losses and scratches. */
export function Recent({ trades }: { trades: Trade[] }) {
  const last = trades.slice(-COUNT);
  const wins = last.filter((t) => t.r > 0.2);
  const losses = last.filter((t) => t.r < -0.2);
  const flat = last.filter((t) => t.r >= -0.2 && t.r <= 0.2);
  const groups = [
    { id: "w", name: "Wins", xs: wins },
    { id: "l", name: "Losses", xs: losses },
    { id: "f", name: "Scratch", xs: flat },
  ].filter((g) => g.xs.length);
  const lines = groups.flatMap((g) => g.xs.map((t) => ({ t, g: g.id })));
  const [hover, setHover] = useState<number | null>(null);

  // streak, newest first
  const form = trades.slice(-24);
  let streak = 0;
  const lastSign = Math.sign(form[form.length - 1]?.r ?? 0);
  for (let i = form.length - 1; i >= 0; i--) {
    const sg = form[i].r > 0.2 ? 1 : form[i].r < -0.2 ? -1 : 0;
    if (sg === lastSign && sg !== 0) streak++;
    else break;
  }

  let offset = 0;
  const h = hover !== null ? lines[hover] : null;

  return (
    <div className={s.recent}>
      <div
        className={s.barcode}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(Math.max(0, Math.min(lines.length - 1, Math.floor(((e.clientX - r.left) / r.width) * lines.length))));
        }}
        onPointerLeave={() => setHover(null)}
      >
        {lines.map((l, i) => (
          <i
            key={l.t.id}
            className={`${s[`bc_${l.g}`]} ${hover === i ? s.bcHot : ""}`}
            style={{ "--k": i } as CSSProperties}
          />
        ))}
        {h && (
          <div className={s.bcTip} style={{ left: `${((hover! + 0.5) / lines.length) * 100}%` }}>
            <span>
              {dayLabel(h.t.day)} · {hhmm(h.t.minute)}
            </span>
            <b className={h.t.pnl >= 0 ? s.pos : s.neg}>{money(h.t.pnl)}</b>
            <em>
              {h.t.mkt} {h.t.side} {h.t.size} · {signed(h.t.r, 1, "R")}
            </em>
          </div>
        )}
      </div>
      <div className={s.groups}>
        {groups.map((g) => {
          const left = (offset / lines.length) * 100;
          offset += g.xs.length;
          const pnl = g.xs.reduce((a, t) => a + t.pnl, 0);
          return (
            <div key={g.id} className={`${s.group} ${left > 78 ? s.groupEnd : ""}`} style={left > 78 ? { right: 0 } : { left: `${left}%` }}>
              <span className={s.groupName}>{g.name}</span>
              <span className={s.groupVal}>
                {Math.round((g.xs.length / lines.length) * 100)}%<em>{k(pnl)}</em>
              </span>
            </div>
          );
        })}
      </div>

      <div className={s.form}>
        <span className={s.label}>
          Last 24<span className={s.dim}> · oldest to newest</span>
        </span>
        <div className={s.formRow}>
          {form.map((t, i) => (
            <i
              key={t.id}
              className={t.r > 0.2 ? s.fW : t.r < -0.2 ? s.fL : s.fF}
              style={{ "--k": i } as CSSProperties}
              title={`${dayLabel(t.day)} ${t.mkt} ${signed(t.r, 1, "R")}`}
            />
          ))}
        </div>
        <span className={s.formNote}>
          {streak > 1 ? `${streak} ${lastSign > 0 ? "wins" : "losses"} in a row` : lastSign > 0 ? "Last trade a win" : "Last trade a loss"}
        </span>
      </div>
    </div>
  );
}
