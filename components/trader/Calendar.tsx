"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { money, signed } from "@/lib/format";
import { CALENDAR_START, CALENDAR_WEEKS, TRADING_DAYS, dailyPnl, dayLabel, periodStartIndex, type Period } from "@/lib/journal";
import s from "./trader.module.css";

const DAILY = dailyPnl();
const MAX_ABS = Math.max(...Array.from(DAILY.values()).map((d) => Math.abs(d.pnl)));
const SESSION_INDEX = new Map(TRADING_DAYS.map((d, i) => [d, i]));

type Day = { day: string; w: number; d: number };

function weeks(): Day[] {
  const out: Day[] = [];
  const [y, m, dd] = CALENDAR_START.split("-").map(Number);
  for (let w = 0; w < CALENDAR_WEEKS; w++) {
    for (let d = 0; d < 5; d++) {
      const date = new Date(Date.UTC(y, m - 1, dd + w * 7 + d));
      out.push({ day: date.toISOString().slice(0, 10), w, d });
    }
  }
  return out;
}
const DAYS = weeks();

function level(pnl: number): number {
  return 1 + Math.floor(Math.min(0.999, Math.sqrt(Math.abs(pnl) / MAX_ABS)) * 4);
}

/** Daily P&L as a grid of squares, one column per week. Click a day to see its trades. */
export function Calendar({ period, selected, onSelect }: { period: Period; selected: string | null; onSelect: (d: string | null) => void }) {
  const [hover, setHover] = useState<Day | null>(null);
  const start = periodStartIndex(period);
  const months = useMemo(() => {
    const out: { label: string; w: number }[] = [];
    let last = "";
    for (const c of DAYS) {
      if (c.d !== 0) continue;
      const key = c.day.slice(0, 7);
      if (key !== last) {
        last = key;
        out.push({ label: dayLabel(c.day, { month: "short" }), w: c.w });
      }
    }
    return out;
  }, []);

  const info = hover ? DAILY.get(hover.day) : null;

  return (
    <div className={s.cal}>
      <div className={s.calBody}>
        <div className={s.calDays} aria-hidden="true">
          {["Mon", "", "Wed", "", "Fri"].map((d, k) => (
            <span key={k}>{d}</span>
          ))}
        </div>
        <div className={s.calMain}>
        <div className={s.calGrid} role="grid" aria-label="Daily P&L, last 26 weeks" onPointerLeave={() => setHover(null)}>
          {DAYS.map((c) => {
            const data = DAILY.get(c.day);
            const idx = SESSION_INDEX.get(c.day);
            const closed = idx === undefined;
            const out = !closed && idx < start;
            const tone = data ? (data.pnl >= 0 ? "p" : "l") + level(data.pnl) : closed ? "closed" : "none";
            return (
              <button
                key={c.day}
                type="button"
                className={`${s.calCell} ${s[`cal_${tone}`] ?? ""} ${out ? s.calOut : ""} ${selected === c.day ? s.calSel : ""}`}
                style={{ gridColumn: c.w + 1, gridRow: c.d + 1, "--q": c.w + c.d * 2 } as CSSProperties}
                disabled={!data}
                aria-label={data ? `${dayLabel(c.day, { weekday: "long", month: "long", day: "numeric" })}: ${money(data.pnl)}` : undefined}
                onPointerEnter={() => setHover(c)}
                onClick={() => onSelect(selected === c.day ? null : c.day)}
              />
            );
          })}
          {hover && (
            <div
              className={s.calTip}
              style={{ "--cx": (hover.w + 0.5) / CALENDAR_WEEKS, "--row": hover.d } as CSSProperties}
            >
              <span>{dayLabel(hover.day, { weekday: "short", month: "short", day: "numeric" })}</span>
              {info ? (
                <>
                  <b className={info.pnl >= 0 ? s.pos : s.neg}>{money(info.pnl)}</b>
                  <em>
                    {info.trades} {info.trades === 1 ? "trade" : "trades"} · {signed(info.r, 1, "R")}
                  </em>
                </>
              ) : (
                <em>{SESSION_INDEX.has(hover.day) ? "No trades" : "Market closed"}</em>
              )}
            </div>
          )}
        </div>
        <div className={s.calMonths} aria-hidden="true">
          {months.map((m) => (
            <span key={m.label} style={{ left: `${(m.w / CALENDAR_WEEKS) * 100}%` }}>
              {m.label}
            </span>
          ))}
        </div>
        </div>
      </div>
      <div className={s.calFoot}>
        <div className={s.legend} aria-hidden="true">
          <span>Loss</span>
          {[4, 3, 2, 1].map((k) => (
            <i key={`l${k}`} className={s[`cal_l${k}`]} />
          ))}
          <i className={s.cal_none} />
          {[1, 2, 3, 4].map((k) => (
            <i key={`p${k}`} className={s[`cal_p${k}`]} />
          ))}
          <span>Profit</span>
        </div>
      </div>
    </div>
  );
}
