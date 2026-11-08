"use client";

import { useState, type CSSProperties } from "react";
import { fmt, hhmm, money, signed } from "@/lib/format";
import { MARKETS, TRADES, byMarket, bySession, dayLabel, type Market, type Trade } from "@/lib/journal";
import { Spark } from "./parts";
import s from "./trader.module.css";

const ROWS = 13;

function k(n: number): string {
  const a = Math.abs(n);
  const v = a >= 1000 ? `$${(a / 1000).toFixed(1)}k` : `$${a.toFixed(0)}`;
  return (n < 0 ? "−" : "+") + v;
}

/** Trades by half hour as columns of dots: blue for wins, ember for losses. */
export function SessionDots({ trades }: { trades: Trade[] }) {
  const slots = bySession(trades);
  const max = Math.max(1, ...slots.map((x) => x.trades));
  const best = slots.reduce((b, x) => (x.net > b.net ? x : b), slots[0]);
  const [hover, setHover] = useState<number | null>(null);
  const h = hover !== null ? slots[hover] : null;

  return (
    <div className={s.dots}>
      <div className={s.dotGrid} onPointerLeave={() => setHover(null)}>
        {slots.map((x, c) => {
          const filled = x.trades ? Math.max(1, Math.round((x.trades / max) * ROWS)) : 0;
          const w = x.trades ? Math.round(filled * (x.wins / x.trades)) : 0;
          const l = x.trades ? Math.min(filled - w, Math.round(filled * (x.losses / x.trades)) || filled - w) : 0;
          return (
            <div
              key={x.start}
              className={`${s.dotCol} ${hover === c ? s.dotHot : ""} ${x === best && x.net > 0 ? s.dotBest : ""}`}
              onPointerEnter={() => setHover(c)}
            >
              {x === best && x.net > 0 && <span className={s.dotChip}>{k(x.net)}</span>}
              {Array.from({ length: ROWS }, (_, r) => (
                <i
                  key={r}
                  className={r < w ? s.dW : r < w + l ? s.dL : r < filled ? s.dF : undefined}
                  style={{ "--q": c + r } as CSSProperties}
                />
              ))}
            </div>
          );
        })}
      </div>
      <div className={s.dotAxis} aria-hidden="true">
        {slots.map((x, c) => (
          <span key={x.start}>{c % 2 === 0 ? hhmm(x.start).replace(/^0/, "") : ""}</span>
        ))}
      </div>
      <p className={s.dotNote}>
        {h ? (
          <>
            {hhmm(h.start).replace(/^0/, "")}–{hhmm(h.start + 30).replace(/^0/, "")} · {h.trades} trades
            {h.trades ? ` · ${Math.round((h.wins / h.trades) * 100)}% wins · ` : ""}
            {h.trades ? <b className={h.net >= 0 ? s.pos : s.neg}>{money(h.net)}</b> : null}
          </>
        ) : (
          <>
            Best window {hhmm(best.start).replace(/^0/, "")}–{hhmm(best.start + 30).replace(/^0/, "")},{" "}
            {Math.round((best.wins / Math.max(1, best.trades)) * 100)}% wins
          </>
        )}
      </p>
    </div>
  );
}

/** Daily loss limit as a dial of ticks. */
export function RiskGauge({ used, limit, tradesToday, maxTrades }: { used: number; limit: number; tradesToday: number; maxTrades: number }) {
  const share = Math.max(0, Math.min(1, used / limit));
  const N = 46;
  const R1 = 86;
  const R2 = 100;
  const cx = 116;
  const cy = 112;
  const hot = share > 0.75;
  const a = Math.PI * (1 - share);
  return (
    <div className={s.gauge}>
      <svg viewBox="0 0 232 124" className={s.gaugeSvg} aria-hidden="true">
        {Array.from({ length: N }, (_, i) => {
          const t = i / (N - 1);
          const ang = Math.PI * (1 - t);
          const on = t <= share + 1e-6;
          return (
            <line
              key={i}
              x1={cx + Math.cos(ang) * R1}
              y1={cy - Math.sin(ang) * R1}
              x2={cx + Math.cos(ang) * R2}
              y2={cy - Math.sin(ang) * R2}
              className={on ? (hot ? s.gTickHot : s.gTickOn) : s.gTick}
              style={{ "--k": i } as CSSProperties}
            />
          );
        })}
        <path d={`M ${cx - 70} ${cy} A 70 70 0 0 1 ${cx + 70} ${cy}`} className={s.gArc} />
        <circle cx={cx + Math.cos(a) * 70} cy={cy - Math.sin(a) * 70} r="4.5" className={hot ? s.gKnobHot : s.gKnob} />
      </svg>
      <div className={s.gaugeRead}>
        <b>${fmt(used, 0)}</b>
        <span>of ${fmt(limit, 0)} daily limit</span>
      </div>
      <dl className={s.gaugeStats}>
        <div>
          <dt>Used</dt>
          <dd>{Math.round(share * 100)}%</dd>
        </div>
        <div>
          <dt>Trades</dt>
          <dd>
            {tradesToday}
            <span className={s.dim}> / {maxTrades}</span>
          </dd>
        </div>
        <div>
          <dt>Contracts</dt>
          <dd>
            2<span className={s.dim}> / 4 NQ</span>
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** Per-market table with a trend line for each. */
export function Markets({ trades }: { trades: Trade[] }) {
  const rows = byMarket(trades);
  return (
    <table className={s.mkts}>
      <thead>
        <tr>
          <th>Market</th>
          <th>Trades</th>
          <th>Win</th>
          <th>Avg R</th>
          <th>Net</th>
          <th className={s.trendCol}>Trend</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m, i) => (
          <tr key={m.id} style={{ "--k": i } as CSSProperties}>
            <td>
              <span className={s.sym}>{m.id}Z6</span>
              <span className={s.symName}>{m.name}</span>
            </td>
            <td>{m.trades}</td>
            <td>{m.trades ? `${Math.round(m.winRate * 100)}%` : "–"}</td>
            <td className={m.avgR >= 0 ? s.pos : s.neg}>{m.trades ? signed(m.avgR, 2, "R") : "–"}</td>
            <td className={m.net >= 0 ? s.pos : s.neg}>{m.trades ? k(m.net) : "–"}</td>
            <td className={s.trendCol}>
              <Spark values={m.curve} tone={m.net >= 0 ? "pos" : "neg"} height={30} baseline={0} delay={700 + i * 90} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const PAGE = 8;

/** The trade log, newest first, with the notes written at the time. */
export function Journal({ trades, day, onClearDay }: { trades: Trade[]; day: string | null; onClearDay: () => void }) {
  const [mkt, setMkt] = useState<Market | "ALL">("ALL");
  const [shown, setShown] = useState(PAGE);
  const source = day ? TRADES.filter((t) => t.day === day) : trades;
  const rows = source.filter((t) => mkt === "ALL" || t.mkt === mkt).slice().reverse();

  return (
    <div className={s.journal}>
      <div className={s.filters}>
        {(["ALL", ...MARKETS.map((m) => m.id)] as const).map((m) => (
          <button key={m} type="button" className={s.chip} aria-pressed={mkt === m} onClick={() => {
              setMkt(m);
              setShown(PAGE);
            }}>
            {m === "ALL" ? "All" : m}
          </button>
        ))}
        {day && (
          <button type="button" className={`${s.chip} ${s.chipDay}`} onClick={onClearDay}>
            {dayLabel(day, { weekday: "short", month: "short", day: "numeric" })}
            <span aria-hidden="true">×</span>
          </button>
        )}
      </div>
      <div className={s.tableWrap}>
        <table className={s.log}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Market</th>
              <th>Side</th>
              <th>Size</th>
              <th>Entry</th>
              <th>Exit</th>
              <th>Hold</th>
              <th>R</th>
              <th>P&amp;L</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((t, i) => (
              <tr key={t.id} style={{ "--k": i % PAGE } as CSSProperties}>
                <td className={s.dimCell}>
                  {dayLabel(t.day)} <span>{hhmm(t.minute)}</span>
                </td>
                <td className={s.sym}>{t.mkt}Z6</td>
                <td>
                  <span className={`${s.side} ${t.side === "LONG" ? s.sideL : s.sideS}`}>{t.side}</span>
                </td>
                <td>{t.size}</td>
                <td>{fmt(t.entry)}</td>
                <td>{fmt(t.exit)}</td>
                <td className={s.dimCell}>{t.hold}m</td>
                <td className={t.r >= 0 ? s.pos : s.neg}>{signed(t.r, 1, "R")}</td>
                <td className={t.pnl >= 0 ? s.pos : s.neg}>{money(t.pnl)}</td>
                <td className={s.noteCell}>{t.note ?? <span className={s.dim}>–</span>}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={10} className={s.empty}>
                  No trades here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > shown && (
        <button type="button" className={s.more} onClick={() => setShown((n) => n + PAGE)}>
          Show {Math.min(PAGE, rows.length - shown)} more <span className={s.dim}>of {rows.length - shown}</span>
        </button>
      )}
    </div>
  );
}
