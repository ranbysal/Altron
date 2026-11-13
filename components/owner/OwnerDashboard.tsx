"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { money, hhmm } from "@/lib/format";
import { PERIODS, TRADING_DAYS, dayLabel, periodStartIndex, type Period } from "@/lib/journal";
import { ACCOUNTS, FEES_TOTAL, HIS_ROOM, METHODS, MODE_LABEL, dailyOf, replay, summarize, type Result, type Row, type Summary } from "@/lib/owner/replay";
import { setOwner, startOwner, useOwner } from "@/lib/owner/store";
import { Calendar } from "@/components/trader/Calendar";
import { EquityChart } from "@/components/trader/EquityChart";
import { Cell, LineMeter, Money, Odometer, Spark } from "@/components/trader/parts";
import { useMarketClock } from "@/components/trader/clock";
import s from "@/components/trader/trader.module.css";
import o from "./owner.module.css";

export function k(n: number): string {
  const a = Math.abs(n);
  const v = a >= 1000 ? `$${(a / 1000).toFixed(1)}k` : `$${a.toFixed(0)}`;
  return (n < 0 ? "−" : "+") + v;
}
const plain = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;

/** The replay the owner's pages read from: Yazan's history through the owner's accounts, as set. */
export function useOwnerReplay() {
  useEffect(() => startOwner(), []);
  const settings = useOwner((x) => x.settings);
  const method = useOwner((x) => x.method);
  const result = useMemo(() => replay(method, settings), [method, settings]);
  return { result, settings, method };
}

export function ModeChip({ row }: { row: Row }) {
  const m = row.decision.mode;
  const filled = row.legs.some((l) => l.filled.length);
  if (m === "skip") return <span className={`${o.mode} ${o.modeSkip}`}>Skipped</span>;
  return (
    <span className={`${o.mode} ${o[`mode_${m}`]}`} data-unfilled={filled ? undefined : ""}>
      {MODE_LABEL[m]}
      {!filled && <em> · not filled</em>}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* accounts                                                            */
/* ------------------------------------------------------------------ */

function AccountCell({ i, id, result, from }: { i: number; id: string; result: Result; from: number }) {
  const a = ACCOUNTS.find((x) => x.id === id)!;
  const st = result.accounts[id];
  const paused = useOwner((x) => !!x.paused[id]);
  const track = result.track[id];
  const room = st.balance - st.floor;
  const locked = st.floor >= a.size + 100;
  // where the balance sits between the floor and the floor plus the firm's drawdown
  const fill = Math.max(0, Math.min(1, room / Math.max(a.dd, room)));
  const start = result.rows.findIndex((r) => r.t.dayIndex >= from);
  const series = track.slice(Math.max(0, start)).map((x) => x.balance + x.paid - a.size);
  const net = series[series.length - 1] - series[0];
  const last = TRADING_DAYS[TRADING_DAYS.length - 1];
  const today = result.rows.filter((r) => r.t.day === last).reduce((acc, r) => acc + (r.legs.find((l) => l.acct === id)?.pnl ?? 0), 0);
  const status = st.breachedAt !== null ? "Breached" : paused ? "Paused" : "Following";
  return (
    <Cell
      i={i}
      className={o.acct}
      label={
        <>
          {a.name}
          {a.lead && <span className={o.lead}>Lead</span>}
        </>
      }
      aside={`${a.size / 1000}K`}
    >
      <span className={o.acctBal}>{money(st.balance).replace("+", "")}</span>
      <div className={o.room} style={{ "--f": fill } as CSSProperties} aria-label={`Room to the floor ${plain(room)}`}>
        <i className={o.roomFill} />
        <i className={o.roomFloor} />
      </div>
      <dl className={o.acctFacts}>
        <div>
          <dt>Room</dt>
          <dd>{plain(room)}</dd>
        </div>
        <div>
          <dt>{locked ? "Floor, locked" : "Floor"}</dt>
          <dd>{plain(st.floor)}</dd>
        </div>
        <div>
          <dt>Period</dt>
          <dd className={net >= 0 ? s.pos : s.neg}>{k(net)}</dd>
        </div>
        <div>
          <dt>Last session</dt>
          <dd className={today > 0 ? s.pos : today < 0 ? s.neg : undefined}>{today ? k(today) : "–"}</dd>
        </div>
      </dl>
      <span className={o.acctStatus} data-s={status.toLowerCase()}>
        <i />
        {status}
        {st.payouts > 0 && <em>{plain(st.payouts)} paid out</em>}
      </span>
    </Cell>
  );
}

/* ------------------------------------------------------------------ */
/* panels                                                              */
/* ------------------------------------------------------------------ */

function ByJoin({ sum }: { sum: Summary }) {
  const groups = (["mirror", "staged", "late"] as const).map((m) => {
    const xs = sum.rows.filter((r) => r.decision.mode === m && r.legs.some((l) => l.filled.length));
    const wins = xs.filter((r) => r.pnl > 0).length;
    return { id: m, label: MODE_LABEL[m], n: xs.length, win: xs.length ? wins / xs.length : 0, net: xs.reduce((a, r) => a + r.pnl, 0) };
  });
  const skipped = sum.rows.filter((r) => r.decision.mode === "skip");
  const unfilled = sum.rows.filter((r) => r.decision.mode !== "skip" && !r.legs.some((l) => l.filled.length));
  const max = Math.max(1, ...groups.map((g) => Math.abs(g.net)));
  return (
    <div className={o.join}>
      {groups.map((g, i) => (
        <div key={g.id} className={o.joinRow} style={{ "--k": i } as CSSProperties}>
          <span className={o.joinName}>{g.label}</span>
          <span className={o.joinTrack}>
            <i className={g.net < 0 ? o.joinNeg : undefined} style={{ width: `${(Math.abs(g.net) / max) * 100}%` }} />
          </span>
          <b className={g.net >= 0 ? s.pos : s.neg}>{k(g.net)}</b>
          <em>
            {g.n} trades · {g.n ? `${Math.round(g.win * 100)}% won` : "–"}
          </em>
        </div>
      ))}
      <div className={o.joinOut}>
        <div>
          <span>Skipped</span>
          <b>{skipped.length}</b>
          <em>He made {k(skipped.reduce((a, r) => a + r.t.pnl, 0))} on them</em>
        </div>
        <div>
          <span>Not filled</span>
          <b>{unfilled.length}</b>
          <em>He made {k(unfilled.reduce((a, r) => a + r.t.pnl, 0))} on them</em>
        </div>
      </div>
    </div>
  );
}

function Costs({ sum }: { sum: Summary }) {
  const list = sum.payoutList.slice().reverse();
  return (
    <div className={o.costs}>
      <dl className={o.costFacts}>
        <div>
          <dt>Paid out</dt>
          <dd className={s.pos}>{plain(sum.payouts)}</dd>
        </div>
        <div>
          <dt>Account fees</dt>
          <dd className={s.neg}>{plain(FEES_TOTAL)}</dd>
        </div>
        <div>
          <dt>Payouts less fees</dt>
          <dd>{money(sum.payouts - FEES_TOTAL)}</dd>
        </div>
      </dl>
      <ol className={o.payouts}>
        {list.slice(0, 7).map((p) => (
          <li key={p.acct + p.day}>
            <time>{dayLabel(p.day, { month: "short", day: "numeric" })}</time>
            <span>{ACCOUNTS.find((a) => a.id === p.acct)!.name}</span>
            <b>{plain(p.amount)}</b>
          </li>
        ))}
        {!list.length && <li className={o.none}>No payouts in this period. An account pays out once its floor has locked and it holds $5,000 of room.</li>}
      </ol>
    </div>
  );
}

function ByAccount({ result, from }: { result: Result; from: number }) {
  const start = Math.max(0, result.rows.findIndex((r) => r.t.dayIndex >= from));
  return (
    <table className={s.mkts}>
      <thead>
        <tr>
          <th>Account</th>
          <th>Trades</th>
          <th>Win</th>
          <th>Max DD</th>
          <th>Net</th>
          <th className={s.trendCol}>Trend</th>
        </tr>
      </thead>
      <tbody>
        {ACCOUNTS.map((a, i) => {
          const legs = result.rows.slice(start).flatMap((r) => r.legs.filter((l) => l.acct === a.id && l.filled.length));
          const wins = legs.filter((l) => l.pnl > 0).length;
          const series = result.track[a.id].slice(start).map((x) => x.balance + x.paid);
          let peak = -Infinity;
          let dd = 0;
          for (const v of series) {
            peak = Math.max(peak, v);
            dd = Math.min(dd, v - peak);
          }
          const net = series[series.length - 1] - series[0];
          return (
            <tr key={a.id} style={{ "--k": i } as CSSProperties}>
              <td>
                <span className={s.sym}>{a.name}</span>
                <span className={s.symName}>
                  {a.size / 1000}K · {plain(a.dd)} drawdown
                </span>
              </td>
              <td>{legs.length}</td>
              <td>{legs.length ? `${Math.round((wins / legs.length) * 100)}%` : "–"}</td>
              <td className={s.neg}>{dd < 0 ? k(dd) : "–"}</td>
              <td className={net >= 0 ? s.pos : s.neg}>{k(net)}</td>
              <td className={s.trendCol}>
                <Spark values={series} tone={net >= 0 ? "pos" : "neg"} width={120} height={30} delay={700 + i * 90} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const PAGE = 10;
type Filter = "all" | "taken" | "skipped" | "unfilled";

export function Decisions({ rows, day, onClearDay }: { rows: Row[]; day: string | null; onClearDay?: () => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(PAGE);
  const list = rows
    .filter((r) => !day || r.t.day === day)
    .filter((r) => {
      const filled = r.legs.some((l) => l.filled.length);
      if (filter === "taken") return filled;
      if (filter === "skipped") return r.decision.mode === "skip";
      if (filter === "unfilled") return r.decision.mode !== "skip" && !filled;
      return true;
    })
    .slice()
    .reverse();
  return (
    <div className={s.journal}>
      <div className={s.filters}>
        {(
          [
            ["all", "All"],
            ["taken", "Taken"],
            ["skipped", "Skipped"],
            ["unfilled", "Not filled"],
          ] as [Filter, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={s.chip}
            aria-pressed={filter === id}
            onClick={() => {
              setFilter(id);
              setShown(PAGE);
            }}
          >
            {label}
          </button>
        ))}
        {day && onClearDay && (
          <button type="button" className={`${s.chip} ${s.chipDay}`} onClick={onClearDay}>
            {dayLabel(day, { weekday: "short", month: "short", day: "numeric" })}
            <span aria-hidden="true">×</span>
          </button>
        )}
      </div>
      <div className={s.tableWrap}>
        <table className={`${s.log} ${o.dec}`}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Market</th>
              <th>His trade</th>
              <th>His P&amp;L</th>
              <th>Plan</th>
              <th>Why</th>
              <th>Micros</th>
              <th>Yours</th>
              <th>Copy would</th>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, shown).map((r, i) => {
              const micros = r.legs.reduce((a, l) => a + l.micros * Math.max(1, l.filled.length), 0);
              const filled = r.legs.some((l) => l.filled.length);
              return (
                <tr key={r.t.id} style={{ "--k": i % PAGE } as CSSProperties}>
                  <td className={s.dimCell}>
                    {dayLabel(r.t.day)} <span>{hhmm(r.t.minute)}</span>
                  </td>
                  <td className={s.sym}>{r.t.mkt}Z6</td>
                  <td>
                    <span className={`${s.side} ${r.t.side === "LONG" ? s.sideL : s.sideS}`}>{r.t.side}</span> <span className={o.size}>{r.t.size}</span>
                  </td>
                  <td className={r.t.pnl >= 0 ? s.pos : s.neg}>{money(r.t.pnl)}</td>
                  <td>
                    <ModeChip row={r} />
                  </td>
                  <td className={o.why}>{r.decision.reason}</td>
                  <td className={s.dimCell}>{filled ? micros : "–"}</td>
                  <td className={!filled ? s.dimCell : r.pnl >= 0 ? s.pos : s.neg}>{filled ? money(r.pnl) : "–"}</td>
                  <td className={`${s.dimCell} ${o.rule}`}>{money(r.rules.mirror)}</td>
                </tr>
              );
            })}
            {!list.length && (
              <tr>
                <td colSpan={9} className={s.empty}>
                  Nothing here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {list.length > shown && (
        <button type="button" className={s.more} onClick={() => setShown((n) => n + PAGE)}>
          Show {Math.min(PAGE, list.length - shown)} more <span className={s.dim}>of {list.length - shown}</span>
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* the page                                                            */
/* ------------------------------------------------------------------ */

export function OwnerDashboard() {
  const { result, method } = useOwnerReplay();
  const following = useOwner((x) => x.following);
  const clock = useMarketClock();
  const [period, setPeriod] = useState<Period>("6M");
  const [day, setDay] = useState<string | null>(null);
  const from = periodStartIndex(period);
  const sum = useMemo(() => summarize(result, from), [result, from]);
  const meta = PERIODS.find((p) => p.id === period)!;
  const pi = PERIODS.findIndex((p) => p.id === period);
  const daily = useMemo(() => dailyOf(result.rows), [result]);
  const trades = useMemo(() => sum.rows.map((r) => r.t), [sum]);
  const ddSeries = useMemo(() => sum.curve.map((c) => c.dd), [sum]);
  // what we kept per dollar he made, as it built up
  const capSeries = useMemo(() => sum.curve.map((c, i) => (sum.ghost[i] > 500 ? c.eq / sum.ghost[i] : NaN)).filter((v) => Number.isFinite(v)), [sum]);
  const captured = sum.his ? sum.net / sum.his : 0;
  // his curve scaled from his room to ours, so the two can be read on one axis
  const scale = ACCOUNTS.reduce((x, a) => x + a.dd, 0) / HIS_ROOM;
  const ghost = useMemo(() => sum.ghost.map((v) => v * scale), [sum, scale]);
  const rooms = ACCOUNTS.map((a) => ({ a, room: result.accounts[a.id].balance - result.accounts[a.id].floor }));
  const totalRoom = rooms.reduce((x, r) => x + r.room, 0);
  const thin = rooms.reduce((x, r) => (r.room < x.room ? r : x));
  const label = METHODS.find((m) => m.id === method)!.label;

  return (
    <>
      <section className={s.hero}>
        <div className={s.heroTop}>
          <div className={s.heroNum}>
            <span className={s.label}>
              Net P&amp;L<span className={s.dim}> · {meta.long} · {ACCOUNTS.length === 1 ? ACCOUNTS[0].name : `${ACCOUNTS.length} accounts`}</span>
            </span>
            <Money value={money(sum.net)} className={`${s.big} ${sum.net >= 0 ? s.bigPos : s.bigNeg}`} />
          </div>
          <div className={s.acctSide}>
            <div className={s.acctRight}>
              <button type="button" className={o.follow} data-on={following ? "" : undefined} onClick={() => setOwner({ following: !following })} aria-pressed={following}>
                <i />
                {following ? "Following Yazan" : "Paused"}
              </button>
              <span className={s.mono}>
                {label} · {ACCOUNTS.find((a) => a.lead)!.name} leads
              </span>
            </div>
            <div className={s.acctRight}>
              <span className={s.label}>
                <i className={`${s.statusDot} ${clock?.open ? s.statusOpen : ""}`} />
                {clock?.status ?? " "}
              </span>
              <span className={s.mono}>{clock?.detail ?? " "}</span>
            </div>
          </div>
        </div>
        <div className={s.factsRow}>
          <dl className={s.facts}>
            <div>
              <dt>Yazan</dt>
              <dd className={sum.his >= 0 ? s.pos : s.neg}>{money(sum.his)}</dd>
            </div>
            <div>
              <dt>Captured</dt>
              <dd>${captured.toFixed(2)} per $1</dd>
            </div>
            <div>
              <dt>Paid out</dt>
              <dd>{plain(sum.payouts)}</dd>
            </div>
            <div>
              <dt>Fees</dt>
              <dd>{plain(FEES_TOTAL)}</dd>
            </div>
            <div>
              <dt>Taken</dt>
              <dd>
                {sum.taken} of {sum.rows.length}
              </dd>
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
        <EquityChart curve={sum.curve} trades={trades} ghost={ghost} ghostLabel="Yazan at our size" />
      </section>

      <div className={s.sheet}>
        <i className={s.sheetR} aria-hidden="true" />
        <i className={s.sheetB} aria-hidden="true" />

        <div className={s.row5}>
          <Cell i={2} label="Win rate" className={s.stat}>
            <Odometer value={`${(sum.winRate * 100).toFixed(1)}%`} className={s.statVal} />
            <LineMeter share={sum.winRate} count={48} />
            <p className={s.statSub}>
              Yazan {(sum.hisWinRate * 100).toFixed(0)}% · {sum.wins} won · {sum.losses} lost
            </p>
          </Cell>
          <Cell i={3} label="Max drawdown" className={s.stat}>
            <Odometer value={money(sum.maxDD)} className={`${s.statVal} ${s.neg}`} />
            <Spark key={`dd${period}`} values={ddSeries} baseline={0} tone="neg" delay={600} />
            <p className={s.statSub}>
              {ACCOUNTS.length === 1 ? (sum.breached ? "Breached" : "Never breached") : `All accounts together · worst single ${k(sum.worstAcctDD)}`}
            </p>
          </Cell>
          <Cell i={4} label={ACCOUNTS.length === 1 ? "Room to the floor" : "Room to the floors"} className={s.stat}>
            <Odometer value={plain(totalRoom)} className={s.statVal} />
            <LineMeter share={Math.min(1, totalRoom / ACCOUNTS.reduce((x, a) => x + a.dd * 2, 0))} count={48} />
            <p className={s.statSub}>
              {ACCOUNTS.length === 1 ? `Floor ${plain(result.accounts[thin.a.id].floor)}` : `Thinnest: ${thin.a.name}, ${plain(thin.room)}`}
            </p>
          </Cell>
          <Cell i={5} label="Captured" className={s.stat}>
            <Odometer value={`$${captured.toFixed(2)}`} className={s.statVal} />
            <Spark key={`c${period}`} values={capSeries} baseline={1} tone="pos" delay={700} />
            <p className={s.statSub}>For every $1 Yazan made · {sum.breached ? `${sum.breached} breached` : "none breached"}</p>
          </Cell>
          <Cell i={6} label="Skipped" className={s.stat}>
            <Odometer value={`${sum.skipped}`} className={s.statVal} />
            <LineMeter share={sum.rows.length ? sum.skipped / sum.rows.length : 0} count={48} tone="neg" />
            <p className={s.statSub}>
              {sum.unfilled} planned but not filled · he took {sum.rows.length}
            </p>
          </Cell>
        </div>

        <div className={o.accts} data-n={ACCOUNTS.length}>
          {ACCOUNTS.map((a, i) => (
            <AccountCell key={a.id} i={7 + i} id={a.id} result={result} from={from} />
          ))}
        </div>

        <div className={s.row2}>
          <Cell i={12} label="Daily P&L" aside={day ? "Day below" : ACCOUNTS.length === 1 ? ACCOUNTS[0].name : "All accounts"}>
            <Calendar period={period} selected={day} onSelect={setDay} daily={daily} />
          </Cell>
          <Cell i={13} label="How we joined" aside={meta.long}>
            <ByJoin sum={sum} />
          </Cell>
          <Cell i={14} label="Payouts and fees" aside={meta.long}>
            <Costs sum={sum} />
          </Cell>
        </div>

        {ACCOUNTS.length > 1 && (
          <div className={s.row1}>
            <Cell i={15} label="By account" aside={meta.long}>
              <ByAccount result={result} from={from} />
            </Cell>
          </div>
        )}

        <div className={s.row1}>
          <Cell i={16} label="Decisions" aside={day ? dayLabel(day, { weekday: "long", month: "long", day: "numeric" }) : `${sum.rows.length} of his trades · ${meta.long}`}>
            <Decisions key={day ?? period} rows={sum.rows} day={day} onClearDay={() => setDay(null)} />
          </Cell>
        </div>
      </div>
      <p className={o.sample}>Sample data. Yazan&apos;s record is the seeded one, and how far each trade went against him is generated until his real fills are recorded.</p>
    </>
  );
}
