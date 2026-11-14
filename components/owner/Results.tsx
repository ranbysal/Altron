"use client";

import Link from "next/link";
import { useMemo, type CSSProperties } from "react";
import { fmt } from "@/lib/format";
import { clock } from "@/lib/community/trades";
import { INSTRUMENTS, UNDER_NAME } from "@/lib/desk/instruments";
import { dayStart, hisBook, openPnl, realizedSince, useDesk, type Trade } from "@/lib/desk/store";
import { PHASE_LABEL, PRESETS, account, type Follow } from "@/lib/follow/engine";
import { useFollow } from "@/lib/follow/runner";
import { setOwner, useOwner } from "@/lib/owner/store";
import { Cell, LineMeter, Money, Odometer, Spark } from "@/components/trader/parts";
import { useMarketClock } from "@/components/trader/clock";
import s from "@/components/trader/trader.module.css";
import o from "./owner.module.css";
import r from "./results.module.css";

/*
 * The owner's dashboard: the paper account's real results, trade by trade, from the book the
 * follow engine trades. Nothing here is sampled or replayed.
 */

const money = (n: number) => `${n < 0 ? "−" : n > 0 ? "+" : ""}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
const plain = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const nyDay = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const dayName = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/** The trading day a close belongs to (sessions open at 6 PM New York the evening before). */
const sessionOf = (ms: number) => nyDay(ms + 6 * 3_600_000);

export function Results() {
  const clockNow = useMarketClock();
  const following = useOwner((x) => x.following);
  const ready = useDesk((d) => d.ready && d.seat === "owner");
  const trades = useDesk((d) => d.trades);
  const start = useDesk((d) => d.start);
  const open = useDesk((d) => openPnl(d));
  const hisTrades = useDesk((d) => hisBook(d).trades);
  const st = useFollow((x) => x.state);
  const rules = useFollow((x) => x.rules);
  const limits = useFollow((x) => x.limits);
  const reviews = useFollow((x) => x.reviews);
  const spend = useFollow((x) => x.spend);
  const wiring = useFollow((x) => x.wiring);

  const closed = useMemo(() => trades.filter((t) => t.closedAt).sort((a, b) => a.closedAt! - b.closedAt!), [trades]);
  const realized = closed.reduce((a, t) => a + t.pnl, 0);
  const equity = start + realized + open;
  const net = equity - start;
  const today = realizedSince(trades, dayStart()) + open;
  const acct = st ? account(rules, limits, st, equity) : null;

  // equity after each closed trade, and how far below its high it sat
  const curve = useMemo(() => {
    let eq = 0;
    let peak = 0;
    return closed.map((t) => {
      eq += t.pnl;
      peak = Math.max(peak, eq);
      return { eq, dd: eq - peak };
    });
  }, [closed]);
  const maxDD = Math.min(0, ...curve.map((c) => c.dd));
  const wins = closed.filter((t) => t.pnl > 0).length;
  const winRate = closed.length ? wins / closed.length : 0;

  // his trades since following started, and what we did with each
  const since = st?.startedAt ?? 0;
  const his = useMemo(() => hisTrades.filter((t) => t.openedAt >= since).sort((a, b) => b.openedAt - a.openedAt), [hisTrades, since]);
  const hisNet = his.reduce((a, t) => a + (t.closedAt ? t.pnl : 0), 0);
  const followed = his.filter((t) => st?.follows[t.id]?.enteredAt).length;

  // by day: our P&L, his, and the review if there is one
  const days = useMemo(() => {
    const m = new Map<string, { ours: number; his: number; n: number }>();
    for (const t of closed) {
      const k = sessionOf(t.closedAt!);
      const d = m.get(k) ?? { ours: 0, his: 0, n: 0 };
      d.ours += t.pnl;
      d.n++;
      m.set(k, d);
    }
    for (const t of his) {
      if (!t.closedAt) continue;
      const k = sessionOf(t.closedAt);
      const d = m.get(k) ?? { ours: 0, his: 0, n: 0 };
      d.his += t.pnl;
      m.set(k, d);
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 10);
  }, [closed, his]);
  const maxDay = Math.max(1, ...days.map(([, d]) => Math.abs(d.ours)));
  const latest = [...reviews].reverse().find((x) => x.coach);
  const preset = PRESETS.find((p) => p.id === rules.preset);

  return (
    <>
      <section className={s.hero}>
        <div className={s.heroTop}>
          <div className={s.heroNum}>
            <span className={s.label}>
              Net P&amp;L<span className={s.dim}> · paper · {preset?.label ?? `${rules.size / 1000}K`}</span>
            </span>
            <Money value={money(net)} className={`${s.big} ${net >= 0 ? s.bigPos : s.bigNeg}`} />
          </div>
          <div className={s.acctSide}>
            <div className={s.acctRight}>
              <button type="button" className={o.follow} data-on={following ? "" : undefined} onClick={() => setOwner({ following: !following })} aria-pressed={following}>
                <i />
                {st?.halted ? "Stopped at the stop line" : following ? "Following Yazan" : "Paused"}
              </button>
              <span className={s.mono}>{acct ? PHASE_LABEL[acct.phase] : "Starting"}</span>
            </div>
            <div className={s.acctRight}>
              <span className={s.label}>
                <i className={`${s.statusDot} ${clockNow?.open ? s.statusOpen : ""}`} />
                {clockNow?.status ?? " "}
              </span>
              <span className={s.mono}>{clockNow?.detail ?? " "}</span>
            </div>
          </div>
        </div>
        <div className={s.factsRow}>
          <dl className={s.facts}>
            <div>
              <dt>Equity</dt>
              <dd>{plain(equity)}</dd>
            </div>
            <div>
              <dt>Today</dt>
              <dd className={today > 0 ? s.pos : today < 0 ? s.neg : undefined}>{today ? money(today) : "$0"}</dd>
            </div>
            <div>
              <dt>Yazan</dt>
              <dd className={hisNet > 0 ? s.pos : hisNet < 0 ? s.neg : undefined}>{money(hisNet)}</dd>
            </div>
            <div>
              <dt>Followed</dt>
              <dd>
                {followed} of {his.length}
              </dd>
            </div>
            <div>
              <dt>Started</dt>
              <dd>{st ? dayName(nyDay(st.startedAt)) : "–"}</dd>
            </div>
          </dl>
        </div>
        <Curve curve={curve} />
      </section>

      <div className={s.sheet}>
        <i className={s.sheetR} aria-hidden="true" />
        <i className={s.sheetB} aria-hidden="true" />

        <div className={s.row5}>
          <Cell i={2} label="Toward the target" className={s.stat}>
            <Odometer value={acct ? `${Math.max(0, Math.min(100, (net / rules.profitTarget) * 100)).toFixed(0)}%` : "0%"} className={s.statVal} />
            <LineMeter share={Math.max(0, Math.min(1, net / rules.profitTarget))} count={48} tone="pos" />
            <p className={s.statSub}>
              {rules.funded ? "Funded" : `${plain(Math.max(0, rules.profitTarget - net))} to pass · target ${plain(rules.profitTarget)}`}
            </p>
          </Cell>
          <Cell i={3} label="Win rate" className={s.stat}>
            <Odometer value={`${(winRate * 100).toFixed(0)}%`} className={s.statVal} />
            <LineMeter share={winRate} count={48} />
            <p className={s.statSub}>
              {wins} won · {closed.length - wins} lost
            </p>
          </Cell>
          <Cell i={4} label="Max drawdown" className={s.stat}>
            <Odometer value={money(maxDD)} className={`${s.statVal} ${maxDD < 0 ? s.neg : ""}`} />
            <Spark values={curve.map((c) => c.dd)} baseline={0} tone="neg" delay={600} />
            <p className={s.statSub}>From the high, closed trades</p>
          </Cell>
          <Cell i={5} label="Before the stop line" className={s.stat}>
            <Odometer value={acct ? plain(Math.max(0, acct.usable)) : "$0"} className={s.statVal} />
            <LineMeter share={acct ? Math.max(0, Math.min(1, acct.usable / (rules.drawdown * limits.stopLine))) : 0} count={48} tone={acct && acct.used > 0.5 ? "neg" : "plain"} />
            <p className={s.statSub}>
              {acct ? `${Math.round(acct.used * 100)}% of the ${plain(rules.drawdown)} drawdown used · floor ${plain(acct.floor)}` : "Waiting for the engine"}
            </p>
          </Cell>
          <Cell i={6} label="AI this week" className={s.stat}>
            <Odometer value={`$${(spend?.usd ?? 0).toFixed(2)}`} className={s.statVal} />
            <LineMeter share={Math.min(1, (spend?.usd ?? 0) / (wiring?.cap ?? 25))} count={48} />
            <p className={s.statSub}>
              {spend?.calls ?? 0} calls · cap ${wiring?.cap ?? 25}
            </p>
          </Cell>
        </div>

        <div className={r.split}>
          <Cell i={7} label="By day" aside="Ours, and his">
            {days.length ? (
              <ul className={r.days}>
                {days.map(([d, x]) => (
                  <li key={d}>
                    <span>{dayName(d)}</span>
                    <span className={r.bar} style={{ "--w": Math.abs(x.ours) / maxDay } as CSSProperties} data-neg={x.ours < 0 ? "" : undefined} aria-hidden="true" />
                    <b className={x.ours > 0 ? s.pos : x.ours < 0 ? s.neg : undefined}>{money(x.ours)}</b>
                    <em>
                      {x.n} {x.n === 1 ? "trade" : "trades"} · his {money(x.his)}
                    </em>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={r.empty}>The first day shows here after his first trade closes.</p>
            )}
          </Cell>
          <Cell i={8} label="The day's review" aside={latest?.coach ? `by ${latest.coach.label}` : undefined}>
            {latest?.coach ? (
              <div className={r.review}>
                <span className={r.when}>{dayName(nyDay(latest.at))}</span>
                <p>{firstParagraph(latest.coach.text)}</p>
                <Link href="/owner/review" className={r.more}>
                  Every review
                  <span aria-hidden="true">↗</span>
                </Link>
              </div>
            ) : (
              <p className={r.empty}>After each 5 PM close the day is reviewed: what went right, what cost us, and one setting to consider. It shows here and goes to Discord.</p>
            )}
          </Cell>
        </div>

        <div className={s.row1}>
          <Cell i={9} label="His trades and ours" aside={ready ? `${his.length} since following started` : undefined}>
            {his.length ? (
              <div className={r.tableWrap}>
                <table className={r.table}>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Market</th>
                      <th>Yazan</th>
                      <th>What we did</th>
                      <th className={r.num}>His P&amp;L</th>
                      <th className={r.num}>Ours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {his.slice(0, 40).map((t) => (
                      <Row key={t.id} t={t} f={st?.follows[t.id]} ours={trades.filter((x) => x.follows === t.id)} />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={r.empty}>Nothing yet. When Yazan takes a trade on his desk, it lands here with what the engine did and why.</p>
            )}
          </Cell>
        </div>
      </div>
      <p className={o.sample}>Paper trading on Altron&apos;s shared simulated prices. Real prices arrive with the Databento feed.</p>
    </>
  );
}

function firstParagraph(text: string): string {
  const body = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^#+\s|^\*\*.*\*\*$|^(The day|What went right|What cost us|One change to consider):?$/i.test(l));
  return (body[0] ?? "").replace(/^[-*]\s*/, "").replace(/\*\*/g, "");
}

function Row({ t, f, ours }: { t: Trade; f: Follow | undefined; ours: Trade[] }) {
  const inst = INSTRUMENTS[t.sym];
  const our = ours.reduce((a, x) => a + (x.closedAt ? x.pnl : 0), 0);
  const live = ours.some((x) => !x.closedAt);
  const what = !f ? "Not seen" : f.status === "passed" ? `Passed: ${f.why ?? ""}` : f.status === "watching" ? "Watching" : f.status === "working" ? "Working an order" : f.status === "in" ? `In with ${f.micros} micros` : `${f.micros ?? ""} micros · ${f.exitWhy ?? "out"}`;
  return (
    <tr>
      <td className={r.mono}>{clock(t.openedAt)}</td>
      <td>{UNDER_NAME[inst.under]}</td>
      <td>
        <span className={r.side} data-s={t.side === "LONG" ? "l" : "s"}>
          {t.side === "LONG" ? "Long" : "Short"}
        </span>{" "}
        {t.qty} @ {fmt(t.entryValue / Math.max(1, t.entryQty))}
      </td>
      <td className={r.what} title={what}>
        {f?.by === "ai" && <span className={r.by}>AI</span>}
        {what}
      </td>
      <td className={`${r.num} ${t.closedAt ? (t.pnl >= 0 ? s.pos : s.neg) : ""}`}>{t.closedAt ? money(t.pnl) : "Open"}</td>
      <td className={`${r.num} ${ours.length && !live ? (our >= 0 ? s.pos : s.neg) : ""}`}>{live ? "Open" : ours.length ? money(our) : "–"}</td>
    </tr>
  );
}

/** Equity after each closed trade, as a line with its drawdown below. */
function Curve({ curve }: { curve: { eq: number; dd: number }[] }) {
  if (curve.length < 2)
    return (
      <div className={r.curveEmpty}>
        <span>The equity curve starts with the second closed trade.</span>
      </div>
    );
  const W = 1000;
  const H = 220;
  const vals = curve.map((c) => c.eq);
  const min = Math.min(0, ...vals);
  const max = Math.max(0, ...vals);
  const span = max - min || 1;
  const x = (i: number) => (i / (curve.length - 1)) * (W - 40);
  const y = (v: number) => 14 + (1 - (v - min) / span) * (H - 28);
  const d = [`M0 ${y(0)}`, ...curve.map((c, i) => `L${x(i).toFixed(1)} ${y(c.eq).toFixed(1)}`)].join(" ");
  const area = `${d} L${x(curve.length - 1).toFixed(1)} ${y(min)} L0 ${y(min)} Z`;
  const last = curve[curve.length - 1].eq;
  return (
    <div className={r.curve}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label={`Equity ${money(last)} after ${curve.length} trades`}>
        <defs>
          <linearGradient id="rq-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.16" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" x2={W} y1={y(0)} y2={y(0)} className={r.zero} />
        <path d={area} fill="url(#rq-fill)" className={last >= 0 ? r.up : r.down} />
        <path d={d} className={`${r.line} ${last >= 0 ? r.up : r.down}`} vectorEffect="non-scaling-stroke" />
      </svg>
      <span className={r.curveEnd}>{money(last)}</span>
    </div>
  );
}
