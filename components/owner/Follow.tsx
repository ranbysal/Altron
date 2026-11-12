"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { fmt, money } from "@/lib/format";
import { INSTRUMENTS } from "@/lib/desk/instruments";
import { getMarket, sizeWords, useDesk, type Trade } from "@/lib/desk/store";
import { clock, clockS, currentTrade, dirOf, entryOf, held, stopOf, targetOf } from "@/lib/community/trades";
import { ACCOUNTS, HIS_ROOM, LEVELS, METHODS, MICRO_VALUE, MODE_LABEL, dipCurve, microsFor, planLive, replay, summarize, type Method, type Result, type Settings } from "@/lib/owner/replay";
import { setOwner, setSetting, useOwner } from "@/lib/owner/store";
import { Cell } from "@/components/trader/parts";
import s from "@/components/trader/trader.module.css";
import { Decisions, k, useOwnerReplay } from "./OwnerDashboard";
import o from "./owner.module.css";
import f from "./follow.module.css";

const plain = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;

/* ------------------------------------------------------------------ */
/* the live trade: his, and what the agent made of it                  */
/* ------------------------------------------------------------------ */

type Tranche = { level: number; price: number; filledAt: number | null };

function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

/** The plan for his open trade, and which of its orders the tape has reached. */
function useLivePlan(trade: Trade | undefined, result: Result, settings: Settings, now: number) {
  const orders = useDesk((x) => x.orders);
  return useMemo(() => {
    if (!trade) return null;
    const inst = INSTRUMENTS[trade.sym];
    const dir = dirOf(trade);
    const entry = entryOf(trade);
    const stop = stopOf(trade, orders) ?? entry - dir * 20 * inst.tick * 4;
    const target = targetOf(trade, orders);
    const D = Math.abs(entry - stop) || inst.tick * 40;
    const lead = ACCOUNTS.find((a) => a.lead)!;
    const leadRoom = result.accounts[lead.id].balance - result.accounts[lead.id].floor;
    const plan = planLive(inst.under === "NQ", trade.side, leadRoom, settings);
    const share = (trade.risk ?? D * inst.pv * trade.qty) / HIS_ROOM;
    const pv = MICRO_VALUE[inst.under];
    const placed = trade.openedAt + 7_000;
    // how far the tape has gone against him since the orders went in, and when it got there
    const bars = getMarket()?.bars(inst.under, 1) ?? [];
    let worst = 0;
    const firstAt = new Map<number, number>();
    let from = bars.length;
    while (from > 0 && bars[from - 1].t >= placed - 1000) from--;
    for (let i = from; i < bars.length; i++) {
      const b = bars[i];
      const against = dir > 0 ? (entry - b.l) / D : (b.h - entry) / D;
      if (against > worst) worst = against;
      for (const d of LEVELS[plan.mode]) if (!firstAt.has(d) && against + 1e-9 >= d) firstAt.set(d, b.t);
    }
    const tranches: Tranche[] = LEVELS[plan.mode].map((d) => ({ level: d, price: Math.round((entry - dir * d * D) / inst.tick) * inst.tick, filledAt: d === 0 ? placed : (firstAt.get(d) ?? null) }));
    const accounts = ACCOUNTS.map((a) => {
      const x = result.accounts[a.id];
      const room = x.balance - x.floor;
      const budget = Math.min(share * settings.follow, settings.maxRisk) * room;
      return { a, room, micros: microsFor(budget, D, pv, plan.mode), budget };
    });
    return { inst, dir, entry, stop, target, D, plan, share, pv, placed, worst, tranches, accounts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trade, orders, result, settings, Math.floor(now / 1000)]);
}

function Ladder({ live, last }: { live: NonNullable<ReturnType<typeof useLivePlan>>; last: number }) {
  const { dir, entry, stop, target, D, tranches } = live;
  const top = dir > 0 ? (target ?? entry + 2 * D) : stop;
  const bottom = dir > 0 ? stop : (target ?? entry - 2 * D);
  const hi = Math.max(top, bottom, last) + D * 0.12;
  const lo = Math.min(top, bottom, last) - D * 0.12;
  const y = (p: number) => ((hi - p) / (hi - lo)) * 100;
  const rows: { p: number; label: string; kind: string; sub?: string }[] = [
    ...(target !== undefined ? [{ p: target, label: "His target", kind: "target" }] : []),
    { p: stop, label: "His stop", kind: "stop" },
    ...tranches.map((t, i) => ({ p: t.price, label: t.level === 0 ? "His entry" : `Add ${i}`, kind: t.filledAt ? "filled" : "working", sub: t.filledAt ? `Filled ${clockS(t.filledAt)}` : "Working" })),
  ];
  if (!tranches.some((t) => t.level === 0)) rows.push({ p: entry, label: "His entry", kind: "his" });
  return (
    <div className={f.ladder}>
      <div className={f.rail}>
        {rows.map((r) => (
          <span key={r.label + r.p} className={f.lvl} data-k={r.kind} style={{ top: `${y(r.p)}%` }}>
            <i />
            <b>
              {r.label}
              {r.sub && <small>{r.sub}</small>}
            </b>
            <em>{fmt(r.p)}</em>
          </span>
        ))}
        <span className={f.now} style={{ top: `${y(last)}%` }}>
          <i />
          <b>{fmt(last)}</b>
        </span>
      </div>
    </div>
  );
}

type Step = { at: number; text: string; sub?: string; done: boolean };

function Live({ result, settings }: { result: Result; settings: Settings }) {
  const trades = useDesk((x) => x.trades);
  const quotes = useDesk((x) => x.quotes);
  const ready = useDesk((x) => x.ready);
  const following = useOwner((x) => x.following);
  const now = useNow(1000);
  const cur = currentTrade(trades);
  const open = cur && !cur.closedAt ? cur : undefined;
  const live = useLivePlan(open, result, settings, now);

  if (!ready) return <div className={f.liveRow} />;
  if (!open || !live)
    return (
      <div className={f.liveRow}>
        <Cell i={1} noTop label="Yazan" aside="Closed" className={f.liveCell}>
          <p className={f.quiet}>Yazan has no open trade. When he opens one, the agent builds its brief and plans within a few seconds.</p>
          {cur?.closedAt && (
            <p className={o.none}>
              Last: {cur.side.toLowerCase()} {sizeWords(cur.sym, cur.qty)}, closed {clock(cur.closedAt)} for {money(cur.pnl)}.
            </p>
          )}
        </Cell>
      </div>
    );

  const { inst, dir, entry, stop, target, plan, tranches, accounts, pv, placed, share } = live;
  const last = quotes[open.sym].last;
  const hisPnl = (last - entry) * dir * open.qty * inst.pv;
  const filled = tranches.filter((t) => t.filledAt);
  const total = accounts.reduce((a, x) => a + x.micros, 0);
  const ours = filled.reduce((a, t) => a + total * (last - t.price) * dir * pv, 0);
  const worstOurs = tranches.reduce((a, t) => a + total * Math.abs(t.price - stop) * pv, 0);
  const steps: Step[] = [
    { at: open.openedAt, text: `Yazan ${dir > 0 ? "bought" : "sold"} ${sizeWords(open.sym, open.qty)} at ${fmt(entry)}`, done: true },
    { at: open.openedAt + 3_000, text: "Brief built", sub: `His risk is ${pct(share)} of his room. ${plan.look[0].n} similar trades in his history`, done: true },
    { at: placed, text: `Plan: ${MODE_LABEL[plan.mode].toLowerCase()}, ${total} micros across ${accounts.filter((a) => a.micros).length} accounts`, sub: plan.reason, done: true },
    ...tranches
      .filter((t) => t.filledAt && t.level > 0)
      .map((t) => ({ at: t.filledAt!, text: `Add filled at ${fmt(t.price)}`, done: true })),
    { at: open.openedAt + 60_000, text: "Check at one minute", sub: now >= open.openedAt + 60_000 ? `Price ${fmt(last)}. His stop and size unchanged, plan holds` : undefined, done: now >= open.openedAt + 60_000 },
    { at: open.openedAt + 240_000, text: "Check at four minutes", sub: now >= open.openedAt + 240_000 ? "Working orders left in place until he exits or moves his stop" : undefined, done: now >= open.openedAt + 240_000 },
  ].sort((a, b) => a.at - b.at);
  const next = steps.find((x) => !x.done);

  return (
    <div className={f.liveRow}>
      <Cell i={1} noTop label="Yazan" aside={<span className={f.liveTag}><i />Live</span>} className={f.liveCell}>
        <div className={f.who}>
          <span className={`${s.side} ${dir > 0 ? s.sideL : s.sideS}`}>{dir > 0 ? "Long" : "Short"}</span>
          <span>{sizeWords(open.sym, open.qty)}</span>
          <span className={f.code}>{inst.code}</span>
        </div>
        <span className={`${f.pnl} ${hisPnl >= 0 ? o.pos : o.neg}`}>{money(hisPnl)}</span>
        <dl className={f.levels}>
          <div>
            <dt>Entry</dt>
            <dd>{fmt(entry)}</dd>
          </div>
          <div>
            <dt>Stop</dt>
            <dd>{fmt(stop)}</dd>
          </div>
          <div>
            <dt>Target</dt>
            <dd>{target !== undefined ? fmt(target) : "Open"}</dd>
          </div>
          <div>
            <dt>Held</dt>
            <dd>{held(now - open.openedAt)}</dd>
          </div>
        </dl>
        <p className={f.quiet}>His risk on this trade is {pct(share)} of his room.</p>
      </Cell>

      <Cell i={2} noTop label="Our plan" aside={following ? MODE_LABEL[plan.mode] : "Paused"} className={f.liveCell}>
        <div className={f.planTop}>
          <span className={`${f.pnl} ${ours >= 0 ? o.pos : o.neg}`}>{filled.length ? money(ours) : "$0.00"}</span>
          <span className={f.planMeta}>
            <b>
              {filled.length} of {tranches.length} filled
            </b>
            <em>Worst case {plain(worstOurs)} if every order fills and his stop hits</em>
          </span>
        </div>
        <Ladder live={live} last={last} />
        <table className={f.split}>
          <thead>
            <tr>
              <th>Account</th>
              <th>Room</th>
              <th>Micros per order</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map(({ a, room, micros }) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td>{plain(room)}</td>
                <td>{micros || "Too small"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Cell>

      <Cell i={3} noTop label="Agent" aside={next ? `Next ${clock(next.at)}` : "Watching"} className={f.liveCell}>
        <ol className={f.steps}>
          {steps.map((x) => (
            <li key={x.at + x.text} data-done={x.done ? "" : undefined}>
              <i />
              <time>{clockS(x.at)}</time>
              <b>{x.text}</b>
              {x.sub && <p>{x.sub}</p>}
            </li>
          ))}
        </ol>
        <p className={f.quiet}>Sample. The agent&apos;s reasoning here is written by the rules engine until the model is connected.</p>
      </Cell>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* accounts and settings                                               */
/* ------------------------------------------------------------------ */

function Slider({ label, value, min, max, step, show, onChange, hint }: { label: string; value: number; min: number; max: number; step: number; show: string; onChange: (v: number) => void; hint: string }) {
  return (
    <label className={f.slider}>
      <span className={f.slHead}>
        <b>{label}</b>
        <em>{show}</em>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ "--v": (value - min) / (max - min) } as CSSProperties} />
      <small>{hint}</small>
    </label>
  );
}

function Accounts({ result }: { result: Result }) {
  const paused = useOwner((x) => x.paused);
  const lead = ACCOUNTS.find((a) => a.lead)!;
  const leadRoom = result.accounts[lead.id].balance - result.accounts[lead.id].floor;
  return (
    <table className={`${s.mkts} ${f.accts}`}>
      <thead>
        <tr>
          <th>Account</th>
          <th>Balance</th>
          <th>Room</th>
          <th>Size vs lead</th>
          <th>Following</th>
        </tr>
      </thead>
      <tbody>
        {ACCOUNTS.map((a, i) => {
          const x = result.accounts[a.id];
          const room = x.balance - x.floor;
          const on = !paused[a.id] && x.breachedAt === null;
          return (
            <tr key={a.id} style={{ "--k": i } as CSSProperties}>
              <td>
                <span className={s.sym}>
                  {a.name}
                  {a.lead && <span className={o.lead}>Lead</span>}
                </span>
                <span className={s.symName}>
                  {a.size / 1000}K · {plain(a.dd)} drawdown
                </span>
              </td>
              <td>{plain(x.balance)}</td>
              <td>{plain(room)}</td>
              <td>{(room / leadRoom).toFixed(2)}×</td>
              <td>
                <button type="button" className={f.toggle} role="switch" aria-checked={on} disabled={x.breachedAt !== null} onClick={() => setOwner({ paused: { ...paused, [a.id]: on } })} aria-label={`${on ? "Pause" : "Resume"} ${a.name}`}>
                  <i />
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Rules() {
  const st = useOwner((x) => x.settings);
  return (
    <div className={f.rules}>
      <Slider label="Follow strength" value={st.follow} min={0.5} max={2} step={0.05} show={`${st.follow.toFixed(2)}×`} onChange={(v) => setSetting("follow", v)} hint="Risk per trade as a share of room, against his. 1× matches his." />
      <Slider label="Max loss per trade" value={st.maxRisk} min={0.05} max={0.4} step={0.01} show={`${pct(st.maxRisk)} of room`} onChange={(v) => setSetting("maxRisk", v)} hint="A hard cap, whatever the agent decides." />
      <Slider label="Daily stop" value={st.dailyStop} min={0.1} max={0.6} step={0.05} show={`${pct(st.dailyStop)} of room`} onChange={(v) => setSetting("dailyStop", v)} hint="No new trades once the day has cost this much." />
      <Slider label="Caution" value={st.caution} min={0} max={0.25} step={0.01} show={st.caution.toFixed(2)} onChange={(v) => setSetting("caution", v)} hint="How much the agent marks down uneven ways of joining. Rises as room thins." />
      <label className={f.check}>
        <input type="checkbox" checked={st.skipNews} onChange={(e) => setSetting("skipNews", e.target.checked)} />
        <span>
          <b>Skip near releases</b>
          <small>No new trade with a scheduled release due within ten minutes.</small>
        </span>
      </label>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* the replay: every way of joining, on his whole history              */
/* ------------------------------------------------------------------ */

const LINE: Record<Method, string> = { ai: "var(--blue)", mirror: "var(--text)", staged: "var(--muted)", late: "var(--dim)", delay: "var(--dim)", full: "var(--neg)" };

function Curves({ runs, pick }: { runs: { id: Method; sum: ReturnType<typeof summarize> }[]; pick: Method }) {
  const W = 640;
  const H = 230;
  const all = runs.flatMap((r) => r.sum.curve.map((c) => c.eq));
  const lo = Math.min(0, ...all);
  const hi = Math.max(1, ...all);
  const n = runs[0].sum.curve.length;
  const X = (i: number) => (i / (n - 1)) * (W - 120);
  const Y = (v: number) => 10 + (1 - (v - lo) / (hi - lo)) * (H - 20);
  const ends = runs.map((r) => ({ id: r.id, y: Y(r.sum.net) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
  return (
    <svg className={f.curves} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Combined P&L of each way of joining over his history">
      <line x1="0" x2={W - 120} y1={Y(0)} y2={Y(0)} className={f.zero} />
      {runs.map((r) => {
        const step = Math.max(1, Math.floor(n / 320));
        const d = r.sum.curve
          .filter((_, i) => i % step === 0 || i === n - 1)
          .map((c, i, arr) => `${i ? "L" : "M"}${X(Math.round((i / (arr.length - 1)) * (n - 1))).toFixed(1)} ${Y(c.eq).toFixed(1)}`)
          .join(" ");
        return <path key={r.id} d={d} fill="none" stroke={LINE[r.id]} strokeWidth={r.id === pick ? 1.8 : 1} strokeDasharray={r.id === "full" ? "3 3" : undefined} opacity={r.id === pick ? 1 : 0.7} />;
      })}
      {ends.map((e) => (
        <text key={e.id} x={W - 112} y={e.y} dominantBaseline="central" className={f.endLabel} data-pick={e.id === pick ? "" : undefined}>
          {METHODS.find((m) => m.id === e.id)!.label}
        </text>
      ))}
    </svg>
  );
}

function DipCurve() {
  const rows = useMemo(() => dipCurve(), []);
  return (
    <div className={f.dip}>
      <div className={f.dipBars}>
        {rows.map((r, i) => (
          <div key={r.d} className={f.dipCol} style={{ "--h": r.win, "--k": i } as CSSProperties} data-late={Math.abs(r.d - 0.7) < 0.01 ? "" : undefined}>
            <b>{pct(r.win)}</b>
            <i />
            <span>{r.d === 0 ? "Any" : `${r.d.toFixed(1)}R`}</span>
            <em>{r.n}</em>
          </div>
        ))}
      </div>
      <p className={f.quiet}>
        Of his trades that went at least this far toward his stop, the share that still won. The number under each bar is how many trades got that far. Late entries sit around 0.7R, so this is the curve that decides whether they pay.
      </p>
    </div>
  );
}

function Replay({ result }: { result: Result }) {
  const settings = useOwner((x) => x.settings);
  const method = useOwner((x) => x.method);
  const runs = useMemo(() => METHODS.map((m) => ({ id: m.id, sum: summarize(m.id === method ? result : replay(m.id, settings)) })), [settings, method, result]);
  const best = runs.filter((r) => r.id !== "full").reduce((a, r) => (r.sum.net / Math.max(1, -r.sum.maxDD) > a.sum.net / Math.max(1, -a.sum.maxDD) ? r : a));
  return (
    <div className={f.replay}>
      <div className={s.tableWrap}>
        <table className={`${s.log} ${f.score}`}>
          <thead>
            <tr>
              <th>Way of joining</th>
              <th>Win rate</th>
              <th>P&amp;L</th>
              <th>Max drawdown</th>
              <th>P&amp;L per $1 of drawdown</th>
              <th>Breached</th>
              <th>Paid out</th>
              <th>On dashboard</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} data-pick={r.id === method ? "" : undefined}>
                <td>
                  <span className={f.method}>
                    <i style={{ background: LINE[r.id] }} />
                    <b>{METHODS.find((m) => m.id === r.id)!.label}</b>
                    {r.id === best.id && <span className={f.best}>Best</span>}
                  </span>
                  <span className={f.blurb}>{METHODS.find((m) => m.id === r.id)!.blurb}</span>
                </td>
                <td>{pct(r.sum.winRate)}</td>
                <td className={r.sum.net >= 0 ? s.pos : s.neg}>{money(r.sum.net)}</td>
                <td className={s.neg}>{k(r.sum.maxDD)}</td>
                <td>${(r.sum.net / Math.max(1, -r.sum.maxDD)).toFixed(2)}</td>
                <td className={r.sum.breached ? s.neg : s.dimCell}>{r.sum.breached ? `${r.sum.breached} of ${ACCOUNTS.length}` : "None"}</td>
                <td>{plain(r.sum.payouts)}</td>
                <td>
                  <button type="button" className={f.radio} aria-pressed={r.id === method} onClick={() => setOwner({ method: r.id })} aria-label={`Show ${METHODS.find((m) => m.id === r.id)!.label} on the dashboard`}>
                    <i />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReplayCurves({ result }: { result: Result }) {
  const settings = useOwner((x) => x.settings);
  const method = useOwner((x) => x.method);
  const runs = useMemo(() => METHODS.map((m) => ({ id: m.id, sum: summarize(m.id === method ? result : replay(m.id, settings)) })), [settings, method, result]);
  return (
    <div className={f.replay}>
      <Curves runs={runs} pick={method} />
      <p className={f.quiet}>
        All {ACCOUNTS.length} accounts together over his {result.rows.length} trades, with the limits above. Sample data: settings tuned on one history fit it better than the future, so rerun on his real record before trusting a number.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* the page                                                            */
/* ------------------------------------------------------------------ */

export function Follow() {
  const { result, settings, method } = useOwnerReplay();
  const sum = useMemo(() => summarize(result), [result]);
  return (
    <div className={f.page}>
      <Live result={result} settings={settings} />
      <div className={s.sheet}>
        <i className={s.sheetR} aria-hidden="true" />
        <i className={s.sheetB} aria-hidden="true" />
        <div className={f.setRow}>
          <Cell i={4} label="Accounts" aside="The copier sizes each by its room">
            <Accounts result={result} />
          </Cell>
          <Cell i={5} label="Limits" aside="Code enforces these">
            <Rules />
          </Cell>
        </div>
        <div className={s.row1}>
          <Cell i={6} label="Replay" aside={`His ${result.rows.length} trades · ${METHODS.find((m) => m.id === method)!.label} on the dashboard`}>
            <Replay result={result} />
          </Cell>
        </div>
        <div className={f.repRow}>
          <Cell i={7} label="Combined P&L" aside="Every way of joining">
            <ReplayCurves result={result} />
          </Cell>
          <Cell i={8} label="Win rate by dip" aside="His whole record">
            <DipCurve />
          </Cell>
        </div>
        <div className={s.row1}>
          <Cell i={9} label="Agent decisions" aside={`${sum.taken} taken · ${sum.skipped} skipped · ${sum.unfilled} not filled`}>
            <Decisions rows={sum.rows} day={null} />
          </Cell>
        </div>
      </div>
    </div>
  );
}
