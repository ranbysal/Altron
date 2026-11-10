"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { useFeed } from "@/components/landing/FeedProvider";
import { POSITION, positionStats } from "@/lib/feed";
import { fmt, money, signed } from "@/lib/format";
import { LAST_DAY, PERIODS, TRADES, computeStats, dayLabel, tradesFor, type Period } from "@/lib/journal";
import { Calendar } from "./Calendar";
import { EquityChart } from "./EquityChart";
import { Journal, LongShort, Markets, RiskGauge, SessionDots } from "./Panels";
import { Cell, LineMeter, Money, Odometer, Spark } from "./parts";
import { useMarketClock } from "./clock";
import s from "./trader.module.css";

function k(n: number): string {
  const a = Math.abs(n);
  const v = a >= 1000 ? `$${(a / 1000).toFixed(1)}k` : `$${a.toFixed(0)}`;
  return (n < 0 ? "−" : "+") + v;
}

export function Dashboard() {
  const { snap } = useFeed();
  const clock = useMarketClock();
  const [period, setPeriod] = useState<Period>("3M");
  const [day, setDay] = useState<string | null>(null);
  const trades = useMemo(() => tradesFor(period), [period]);
  const st = useMemo(() => computeStats(trades), [trades]);
  const pos = positionStats(snap.nq);
  const net = st.net + pos.pnl;
  const meta = PERIODS.find((p) => p.id === period)!;
  const today = TRADES.filter((t) => t.day === LAST_DAY);
  const todayNet = today.reduce((a, t) => a + t.pnl, 0);
  const pi = PERIODS.findIndex((p) => p.id === period);
  const ddSeries = useMemo(() => st.curve.map((c) => c.dd), [st]);
  const curve = st.curve;

  return (
    <>

          {/* headline number + equity */}
            <section className={s.hero}>
              <div className={s.heroTop}>
                <div className={s.heroNum}>
                  <span className={s.label}>
                    Net P&amp;L<span className={s.dim}> · {meta.long} · realized + open</span>
                  </span>
                  <Money value={money(net)} className={`${s.big} ${net >= 0 ? s.bigPos : s.bigNeg}`} />
                </div>
                <div className={s.acctSide}>
                  <div className={s.acctRight}>
                    <span className={s.label}>
                      <i className={`${s.statusDot} ${clock?.open ? s.statusOpen : ""}`} />
                      {clock?.status ?? "\u00a0"}
                    </span>
                    <span className={s.mono}>{clock?.detail ?? "\u00a0"}</span>
                  </div>
                  <div className={s.acctRight}>
                    <span className={s.label}>{dayLabel(LAST_DAY, { weekday: "short", month: "short", day: "2-digit" })}</span>
                    <span className={s.mono}>Last session</span>
                  </div>
                </div>
              </div>
              <div className={s.factsRow}>
              <dl className={s.facts}>
                <div>
                  <dt>Realized</dt>
                  <dd className={st.net >= 0 ? s.pos : s.neg}>{money(st.net)}</dd>
                </div>
                <div>
                  <dt>
                    Open <i className={s.liveDot} />
                  </dt>
                  <dd className={pos.pnl >= 0 ? s.pos : s.neg}>
                    <Odometer value={money(pos.pnl)} delay={0} />
                  </dd>
                </div>
                <div>
                  <dt>Total R</dt>
                  <dd>{signed(st.totalR, 1, "R")}</dd>
                </div>
                <div>
                  <dt>Trades</dt>
                  <dd>{st.count}</dd>
                </div>
                <div>
                  <dt>Avg hold</dt>
                  <dd>{Math.round(st.avgHold)}m</dd>
                </div>
              </dl>
                <div className={s.periods} role="tablist" aria-label="Period" style={{ "--pi": pi, "--pn": PERIODS.length } as CSSProperties}>
                  <span className={s.periodPill} aria-hidden="true" />
                  {PERIODS.map((p) => (
                    <button key={p.id} type="button" role="tab" aria-selected={p.id === period} onClick={() => setPeriod(p.id)}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <EquityChart curve={curve} trades={trades} />
            </section>

        <div className={s.sheet}>
          <i className={s.sheetR} aria-hidden="true" />
          <i className={s.sheetB} aria-hidden="true" />

          {/* key numbers */}
          <div className={s.row5}>
            <Cell i={2} label="Win rate" className={s.stat}>
              <Odometer value={`${(st.winRate * 100).toFixed(1)}%`} className={s.statVal} />
              <LineMeter share={st.winRate} count={48} />
              <p className={s.statSub}>
                {st.wins} wins · {st.losses} losses · {st.flat} breakeven
              </p>
            </Cell>
            <Cell i={3} label="Profit factor" className={s.stat}>
              <Odometer value={st.pf.toFixed(2)} className={s.statVal} />
              <Spark key={`pf${period}`} values={st.rollPF} baseline={1} delay={600} />
              <p className={s.statSub}>
                {k(st.grossWin)} won · {k(-st.grossLoss)} lost
              </p>
            </Cell>
            <Cell i={4} label="Expectancy" className={s.stat}>
              <Odometer value={signed(st.expectancy, 2, "R")} className={s.statVal} />
              <Spark key={`r${period}`} values={st.cumR} baseline={0} tone="pos" delay={700} />
              <p className={s.statSub}>
                Avg win {signed(st.avgWinR, 1, "R")} · avg loss {signed(st.avgLossR, 1, "R")}
              </p>
            </Cell>
            <Cell i={5} label="Max drawdown" className={s.stat}>
              <Odometer value={money(st.maxDD)} className={`${s.statVal} ${s.neg}`} />
              <Spark key={`dd${period}`} values={ddSeries} baseline={0} tone="neg" delay={800} />
              <p className={s.statSub}>
                {st.ddFrom ? `${dayLabel(st.ddFrom)} to ${dayLabel(st.ddTo!)}` : "None"} · {st.recovered ? "recovered" : "still open"}
              </p>
            </Cell>
            <Cell
              i={6}
              label={
                <>
                  Open · {POSITION.symbol}
                  <i className={s.liveDot} />
                </>
              }
              className={`${s.stat} ${s.openCell}`}
            >
              <Odometer value={money(pos.pnl)} className={`${s.statVal} ${pos.pnl >= 0 ? s.pos : s.neg}`} />
              <div className={s.ruler} aria-hidden="true">
                <i className={s.rulerTrack} />
                <i
                  className={`${s.rulerFill} ${pos.pct >= pos.entryPct ? s.fillPos : s.fillNeg}`}
                  style={{ left: `${Math.min(pos.pct, pos.entryPct)}%`, width: `${Math.abs(pos.pct - pos.entryPct)}%` }}
                />
                <i className={s.rulerEntry} style={{ left: `${pos.entryPct}%` }} />
                <i className={s.rulerNow} style={{ left: `${pos.pct}%` }} />
              </div>
              <div className={s.rulerLabels}>
                <span className={s.neg}>{fmt(POSITION.stop)}</span>
                <span>{fmt(snap.nq)}</span>
                <span className={s.pos}>{fmt(POSITION.target)}</span>
              </div>
              <p className={s.statSub}>
                Long {POSITION.size} @ {fmt(POSITION.entry)} · {signed(pos.r, 2, "R")}
              </p>
            </Cell>
          </div>

          {/* calendar + risk */}
          <div className={s.row2}>
            <Cell i={7} label="Daily P&L" aside={day ? "Day below" : "26 weeks"}>
              <Calendar period={period} selected={day} onSelect={setDay} />
            </Cell>
            <Cell i={8} label="Long vs short" aside={meta.long}>
              <LongShort key={period} trades={trades} />
            </Cell>
            <Cell i={9} label="Risk today" aside={`Session ${k(todayNet)}`}>
              <RiskGauge used={Math.max(0, -todayNet) + pos.risk} limit={2000} tradesToday={today.length + 1} maxTrades={6} />
            </Cell>
          </div>

          {/* markets + time of day */}
          <div className={s.row3}>
            <Cell i={10} label="By market" aside={meta.long}>
              <Markets trades={trades} />
            </Cell>
            <Cell i={11} label="Time of day" aside="ET · 30 min">
              <SessionDots trades={trades} />
            </Cell>
          </div>

          {/* journal */}
          <div className={s.row1}>
            <Cell i={12} label="Journal" aside={day ? dayLabel(day, { weekday: "long", month: "long", day: "numeric" }) : `${trades.length} trades · ${meta.long}`}>
              <Journal key={day ?? period} trades={trades} day={day} onClearDay={() => setDay(null)} />
            </Cell>
          </div>
        </div>

    </>
  );
}
