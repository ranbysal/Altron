"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as RKE, type PointerEvent as RPE } from "react";
import { fmt, money } from "@/lib/format";
import { dayLabel } from "@/lib/journal";
import { hhmm } from "@/lib/format";
import { clock, clockS } from "@/lib/community/trades";
import { startRoom } from "@/lib/community/room";
import { ACCOUNTS, METHODS, MODE_LABEL, replay, summarize, type Method, type Mode, type Result, type Row } from "@/lib/owner/replay";
import { useFollowPlan, type Plan } from "@/lib/owner/live";
import { setOwner, setSetting, useOwner } from "@/lib/owner/store";
import { Preview, Sheet } from "@/components/community/Community";
import { Cell, Money } from "@/components/trader/parts";
import s from "@/components/trader/trader.module.css";
import { useOwnerReplay } from "./OwnerDashboard";
import f from "./follow.module.css";

const plain = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const signed = (n: number) => (n >= 0 ? "+" : "−") + plain(n);

/** What the agent decided, said the way a person would. */
const CALL: Record<Mode, string> = {
  mirror: "Join him at his entry.",
  staged: "Stage in, three steps toward his stop.",
  late: "Wait near his stop, then go in.",
};

/* ------------------------------------------------------------------ */
/* the pair: Yazan, the call, and us                                    */
/* ------------------------------------------------------------------ */

function Relay({ plan, now }: { plan: Plan; now: number }) {
  const steps = plan.steps;
  const nextAt = steps.find((x) => !x.done)?.at;
  const lastDone = [...steps].reverse().find((x) => x.done);
  const doneN = steps.filter((x) => x.done).length;
  // how far along the way to the next step we are, drawn on the line between them
  const prev = lastDone?.at ?? plan.trade.openedAt;
  const part = nextAt ? Math.max(0, Math.min(1, (now - prev) / (nextAt - prev))) : 0;
  const n = steps.length;
  const fill = n > 1 ? (doneN - 1 + (nextAt ? part : 0)) / (n - 1) : 1;
  return (
    <div className={f.relay} style={{ "--n": n, "--fill": Math.max(0, Math.min(1, fill)) } as CSSProperties}>
      <span className={f.relayTrack} aria-hidden="true">
        <i />
      </span>
      <ol>
        {steps.map((x, k) => (
          <li key={x.at + x.short} data-done={x.done ? "" : undefined} style={{ "--k": k } as CSSProperties} title={x.sub ? `${x.text}. ${x.sub}` : x.text}>
            <i aria-hidden="true" />
            <b>{x.short}</b>
            <time>{clockS(x.at).replace(/ (AM|PM)$/, "")}</time>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Countdown({ to, now }: { to: number; now: number }) {
  const sec = Math.max(0, Math.round((to - now) / 1000));
  return (
    <>
      {Math.floor(sec / 60)}:{String(sec % 60).padStart(2, "0")}
    </>
  );
}

/** Our side of the trade, built the same way as his card beside it. */
function Ours({ plan }: { plan: Plan }) {
  const { dir, stop, target, entry, tranches, filled, avg, pnl, per, live } = plan;
  const left = dir > 0 ? stop : (target ?? entry - (stop - entry) * 2);
  const right = dir > 0 ? (target ?? entry + (entry - stop) * 2) : stop;
  const lo = Math.min(left, right);
  const hi = Math.max(left, right);
  const at = (p: number) => (dir > 0 ? (p - lo) / (hi - lo) : (hi - p) / (hi - lo));
  const tone = pnl >= 0 ? f.pos : f.neg;
  const state = !filled.length ? (live ? "Working" : "Not filled") : live ? "In" : "Closed";
  return (
    <div className={f.ours}>
      <div className={f.oursHead}>
        <span className={`${f.side} ${dir > 0 ? f.sideL : f.sideS}`}>{dir > 0 ? "Long" : "Short"}</span>
        <span>
          {per} micros × {tranches.length} {tranches.length === 1 ? "order" : "orders"}
        </span>
        <em>{state}</em>
      </div>
      <div className={f.oursNum}>
        <span className={`${f.oursPnl} ${filled.length ? tone : ""}`}>{money(filled.length ? pnl : 0)}</span>
        <span className={f.oursMeta}>
          <b>
            {filled.length} of {tranches.length} filled
          </b>
          <em>{avg !== null ? `Average ${fmt(avg)}` : "Nothing filled yet"}</em>
        </span>
      </div>
      {/* his stop on the left, his target on the right; our orders along the way */}
      <div className={f.track} style={{ "--e": at(entry) } as CSSProperties}>
        <span className={f.trackLine} aria-hidden="true" />
        <i className={f.trackStop} aria-hidden="true" />
        <i className={f.trackTarget} aria-hidden="true" />
        <i className={f.trackHis} title={`His entry ${fmt(entry)}`} aria-hidden="true" />
        {tranches.map((x, k) => (
          <i key={k} className={f.trackOrder} data-filled={x.filledAt ? "" : undefined} style={{ "--at": at(x.price) } as CSSProperties} aria-hidden="true" />
        ))}
      </div>
      <dl className={f.lv}>
        <div>
          <dt>Stop, his</dt>
          <dd>{fmt(stop)}</dd>
          <dd className={f.neg}>{money(-plan.worst)}</dd>
        </div>
        <div>
          <dt>Average</dt>
          <dd>{avg !== null ? fmt(avg) : "–"}</dd>
          <dd>{plan.qty ? `${plan.qty} micros` : "None yet"}</dd>
        </div>
        <div>
          <dt>Target, his</dt>
          <dd>{target !== undefined ? fmt(target) : "Open"}</dd>
          <dd className={f.pos}>{target !== undefined && avg !== null ? money(filled.reduce((a, x) => a + per * Math.abs(target - x.price), 0) * (plan.code.includes("NQ") ? 2 : 5)) : "–"}</dd>
        </div>
      </dl>
      <ol className={f.orders}>
        {tranches.map((x, k) => (
          <li key={k} data-filled={x.filledAt ? "" : undefined}>
            <i aria-hidden="true" />
            <span>{x.level === 0 ? "At his entry" : `Add ${k}, ${Math.round(x.level * 100)}% to his stop`}</span>
            <b>{fmt(x.price)}</b>
            <em>{x.filledAt ? `Filled ${clockS(x.filledAt)}` : live ? "Working" : "Cancelled"}</em>
          </li>
        ))}
      </ol>
      <p className={f.fine}>
        Worst case {plain(plan.worst)} if every order fills and his stop is hit, {pct(plan.ourShare)} of our room.
      </p>
    </div>
  );
}

function Pair({ result }: { result: Result }) {
  const settings = useOwner((x) => x.settings);
  const following = useOwner((x) => x.following);
  const { trade, plan, now, ready } = useFollowPlan(result, settings);
  const [open, setOpen] = useState(false);
  useEffect(() => startRoom(), []);
  const next = plan?.steps.find((x) => !x.done);

  return (
    <section className={f.pair}>
      <header className={f.pairHead}>
        <button type="button" className={f.follow} data-on={following ? "" : undefined} aria-pressed={following} onClick={() => setOwner({ following: !following })}>
          <i />
          {following ? "Following Yazan" : "Paused"}
        </button>
        <span className={f.headMeta}>
          {plan?.live && next ? (
            <>
              Next check in{" "}
              <b>
                <Countdown to={next.at} now={now} />
              </b>
            </>
          ) : plan?.live ? (
            "Watching for his exit"
          ) : (
            "Waiting for his next trade"
          )}
        </span>
      </header>

      <div className={f.pairGrid}>
        <div className={f.col} style={{ "--c": 0 } as CSSProperties}>
          <span className={f.colLabel}>
            <span>Yazan</span>
            <em data-live={plan?.live ? "" : undefined}>{plan?.live ? "Live" : trade ? "Last trade" : "No trades yet"}</em>
          </span>
          {ready && trade ? (
            <>
              <Preview trade={trade} now={now} onOpen={() => setOpen(true)} />
              <button type="button" className={f.openBtn} onClick={() => setOpen(true)}>
                <span>Chart and room</span>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3.5 2.5h6v6M9.5 2.5l-7 7" />
                </svg>
              </button>
            </>
          ) : (
            <p className={f.quiet}>When Yazan takes a trade, it shows here.</p>
          )}
        </div>

        <div className={f.bridge} style={{ "--c": 1 } as CSSProperties}>
          <span className={f.colLabel}>
            <span>{plan?.live ? "The call" : "The last call"}</span>
            <em>{plan ? clock(plan.placed) : ""}</em>
          </span>
          {plan ? (
            <>
              <h2 className={f.call} key={plan.trade.id + plan.mode}>
                {CALL[plan.mode].split(" ").map((w, k) => (
                  <span key={k} style={{ "--w": k } as CSSProperties}>
                    {w}{" "}
                  </span>
                ))}
              </h2>
              <p className={f.why}>{plan.reason}.</p>
              {!plan.live && (
                <p className={f.result}>
                  He made <b className={plan.trade.pnl >= 0 ? f.pos : f.neg}>{signed(plan.trade.pnl)}</b>. We made{" "}
                  <b className={plan.pnl >= 0 ? f.pos : f.neg}>{plan.filled.length ? signed(plan.pnl) : "$0"}</b>.
                </p>
              )}
              <Relay plan={plan} now={now} />
              <dl className={f.trio}>
                <div>
                  <dt>His risk</dt>
                  <dd>{pct(plan.share)}</dd>
                  <dd>of his room</dd>
                </div>
                <div>
                  <dt>Ours</dt>
                  <dd>{pct(plan.ourShare)}</dd>
                  <dd>of our room</dd>
                </div>
                <div>
                  <dt>Similar trades</dt>
                  <dd>{plan.look[0]?.n ?? 0}</dd>
                  <dd>{pct(plan.look.find((x) => x.mode === plan.mode)?.win ?? 0)} paid this way</dd>
                </div>
              </dl>
            </>
          ) : (
            <h2 className={f.call}>Waiting for his first trade.</h2>
          )}
        </div>

        <div className={f.col} style={{ "--c": 2 } as CSSProperties}>
          <span className={f.colLabel}>
            <span>You</span>
            <em>{ACCOUNTS.length === 1 ? `${ACCOUNTS[0].name} · ${ACCOUNTS[0].size / 1000}K` : `${ACCOUNTS.length} accounts`}</em>
          </span>
          {plan ? <Ours plan={plan} /> : <p className={f.quiet}>Our orders show here once he trades.</p>}
        </div>
      </div>
      {open && trade && <Sheet trade={trade} kind="live" now={now} onClose={() => setOpen(false)} />}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* the account                                                          */
/* ------------------------------------------------------------------ */

/** Balance against the floor over his history, the room between them in the dither. */
function RoomChart({ track, size }: { track: Result["track"][string]; size: number }) {
  const W = 760;
  const H = 210;
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const n = track.length;
  const lo = Math.min(...track.map((x) => x.floor)) - 300;
  const hi = Math.max(...track.map((x) => x.balance)) + 300;
  const X = (i: number) => (i / (n - 1)) * (W - 70);
  const Y = (v: number) => 10 + (1 - (v - lo) / (hi - lo)) * (H - 28);
  const balPts = track.map((x, i) => [X(i), Y(x.balance)] as const);
  const bal = balPts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  // the floor only moves at the close, so it steps
  const floorPts: [number, number][] = [[0, Y(track[0].floor)]];
  for (let i = 1; i < n; i++) {
    floorPts.push([X(i), floorPts[floorPts.length - 1][1]]);
    floorPts.push([X(i), Y(track[i].floor)]);
  }
  const floor = floorPts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${bal} ${[...floorPts]
    .reverse()
    .map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ")} Z`;
  const lock = size + 100;
  const h = hover !== null ? track[hover] : null;
  const move = (e: RPE<SVGSVGElement>) => {
    const r = ref.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.round((x / (W - 70)) * (n - 1)))));
  };
  const endB = Y(track[n - 1].balance);
  const endF = Y(track[n - 1].floor);
  return (
    <div className={f.roomChart}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onPointerMove={move} onPointerLeave={() => setHover(null)} role="img" aria-label="Balance against the firm's floor over his history">
        <defs>
          <pattern id="room-dots" width="4" height="4" patternUnits="userSpaceOnUse">
            <rect width="1.7" height="1.7" className={f.dot} />
          </pattern>
        </defs>
        <path d={area} fill="url(#room-dots)" />
        {lock > lo && lock < hi && <line x1="0" x2={W - 70} y1={Y(lock)} y2={Y(lock)} className={f.lockRule} />}
        <path d={floor} className={f.floorLine} />
        <path d={bal} className={f.balLine} />
        <rect x={X(n - 1) - 3} y={endB - 3} width="6" height="6" className={f.endSq} />
        {hover !== null && <line x1={X(hover)} x2={X(hover)} y1="4" y2={H - 14} className={f.scrub} />}
      </svg>
      <span className={f.roomTag} style={{ top: `${(endB / H) * 100}%` }}>
        Balance
      </span>
      <span className={`${f.roomTag} ${f.roomTagFloor}`} style={{ top: `${(Math.max(endF, endB + 18) / H) * 100}%` }}>
        Floor
      </span>
      {h && (
        <div className={f.roomTip} style={{ left: `${(X(hover!) / W) * 100}%` }}>
          <span>After trade {hover}</span>
          <b>{plain(h.balance)}</b>
          <em>
            {plain(h.balance - h.floor)} above the floor{h.paid ? ` · ${plain(h.paid)} paid out` : ""}
          </em>
        </div>
      )}
    </div>
  );
}

function Account({ result }: { result: Result }) {
  const a = ACCOUNTS.find((x) => x.lead) ?? ACCOUNTS[0];
  const st = result.accounts[a.id];
  const room = st.balance - st.floor;
  const lock = a.size + 100;
  const locked = st.floor >= lock;
  const payoutAt = st.floor + 5_000;
  const paused = useOwner((x) => x.paused);
  // the gauge runs from the floor to where a payout is due
  const span = Math.max(payoutAt, st.balance) - st.floor;
  const g = (v: number) => Math.max(0, Math.min(1, (v - st.floor) / span));
  return (
    <div className={f.account}>
      <div className={f.acctTop}>
        <div>
          <span className={f.k}>Balance</span>
          <Money value={money(st.balance).replace("+", "")} className={f.acctBal} />
        </div>
        <div className={f.acctRoom}>
          <span className={f.k}>Room to the floor</span>
          <b>{plain(room)}</b>
        </div>
      </div>
      <div className={f.gauge} style={{ "--b": g(st.balance), "--l": g(lock) } as CSSProperties}>
        <span className={f.gaugeLine} aria-hidden="true" />
        <span className={f.gaugeFill} aria-hidden="true" />
        <i className={f.gFloor} />
        <i className={f.gBal} />
        {!locked && <i className={f.gLock} />}
        <i className={f.gPay} />
        <span className={f.gLabels}>
          <span>
            Floor {fmt(st.floor, 0)}
            <em>{locked ? "Locked" : "Trails the close"}</em>
          </span>
          <span data-end="">
            Payout at {fmt(payoutAt, 0)}
            <em>{plain(Math.max(0, payoutAt - st.balance))} to go</em>
          </span>
        </span>
      </div>
      <RoomChart track={result.track[a.id]} size={a.size} />
      <dl className={f.acctFacts}>
        <div>
          <dt>Account</dt>
          <dd>
            {a.name} · {a.size / 1000}K
          </dd>
        </div>
        <div>
          <dt>Firm drawdown</dt>
          <dd>{plain(a.dd)}, end of day</dd>
        </div>
        <div>
          <dt>Paid out</dt>
          <dd>{plain(st.payouts)}</dd>
        </div>
        <div>
          <dt>Worst drawdown</dt>
          <dd className={st.maxDD < 0 ? f.neg : undefined}>{st.maxDD < 0 ? `−${plain(st.maxDD)}` : "None"}</dd>
        </div>
      </dl>
      {ACCOUNTS.length > 1 && (
        <ul className={f.others}>
          {ACCOUNTS.map((x) => {
            const y = result.accounts[x.id];
            const on = !paused[x.id] && y.breachedAt === null;
            return (
              <li key={x.id}>
                <b>{x.name}</b>
                <span>{x.size / 1000}K</span>
                <span>{plain(y.balance - y.floor)} room</span>
                <button type="button" className={f.switch} role="switch" aria-checked={on} onClick={() => setOwner({ paused: { ...paused, [x.id]: on } })} aria-label={`${on ? "Pause" : "Resume"} ${x.name}`}>
                  <i />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* limits: numbers you drag                                             */
/* ------------------------------------------------------------------ */

function Scrub({ label, value, min, max, step, show, hint, onChange }: { label: string; value: number; min: number; max: number; step: number; show: (v: number) => string; hint: string; onChange: (v: number) => void }) {
  const drag = useRef<{ x: number; v: number } | null>(null);
  const [live, setLive] = useState(false);
  const clampTo = (v: number) => Math.round(Math.max(min, Math.min(max, v)) / step) * step;
  const down = (e: RPE<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, v: value };
    setLive(true);
  };
  const move = (e: RPE<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const w = e.currentTarget.clientWidth || 240;
    onChange(clampTo(d.v + ((e.clientX - d.x) / w) * (max - min)));
  };
  const up = () => {
    drag.current = null;
    setLive(false);
  };
  const key = (e: RKE<HTMLDivElement>) => {
    const by = e.shiftKey ? step * 5 : step;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") onChange(clampTo(value + by));
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") onChange(clampTo(value - by));
    else return;
    e.preventDefault();
  };
  const at = (value - min) / (max - min);
  return (
    <div
      className={f.scrubber}
      data-live={live ? "" : undefined}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Number(value.toFixed(3))}
      aria-valuetext={show(value)}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
      style={{ "--at": at } as CSSProperties}
    >
      <span className={f.k}>{label}</span>
      <b className={f.scrubVal}>{show(value)}</b>
      <span className={f.ruler} aria-hidden="true">
        <i />
      </span>
      <small>{hint}</small>
    </div>
  );
}

function Limits() {
  const st = useOwner((x) => x.settings);
  return (
    <div className={f.limits}>
      <div className={f.scrubs}>
        <Scrub label="Follow strength" value={st.follow} min={0.5} max={2} step={0.05} show={(v) => `${v.toFixed(2)}×`} hint="Our risk against his, each as a share of room" onChange={(v) => setSetting("follow", v)} />
        <Scrub label="Max loss a trade" value={st.maxRisk} min={0.05} max={0.4} step={0.01} show={(v) => pct(v)} hint="Of our room, whatever the agent decides" onChange={(v) => setSetting("maxRisk", v)} />
        <Scrub label="Daily stop" value={st.dailyStop} min={0.1} max={0.6} step={0.05} show={(v) => pct(v)} hint="No new trades once the day costs this much" onChange={(v) => setSetting("dailyStop", v)} />
        <Scrub label="Caution" value={st.caution} min={0} max={0.25} step={0.01} show={(v) => v.toFixed(2)} hint="Steadier, smaller results as it rises" onChange={(v) => setSetting("caution", v)} />
      </div>
      <div className={f.toggleRow}>
        <span>
          <b>Skip near releases</b>
          <em>No new trade with a scheduled release due within ten minutes</em>
        </span>
        <button type="button" className={f.switch} role="switch" aria-checked={st.skipNews} onClick={() => setSetting("skipNews", !st.skipNews)} aria-label="Skip near releases">
          <i />
        </button>
      </div>
      <p className={f.fine}>Drag a number sideways, or use the arrow keys. Everything below reruns as you do.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* six ways in                                                          */
/* ------------------------------------------------------------------ */

type Run = { id: Method; label: string; blurb: string; sum: ReturnType<typeof summarize> };

function Ways({ result }: { result: Result }) {
  const settings = useOwner((x) => x.settings);
  const method = useOwner((x) => x.method);
  const runs: Run[] = useMemo(() => METHODS.map((m) => ({ ...m, sum: summarize(m.id === method ? result : replay(m.id, settings)) })), [settings, method, result]);
  const maxNet = Math.max(1, ...runs.map((r) => Math.abs(r.sum.net)));
  const maxDD = Math.max(1, ...runs.map((r) => -r.sum.maxDD));
  const score = (r: Run) => r.sum.net / Math.max(1, -r.sum.maxDD);
  const best = runs.filter((r) => r.id !== "full").reduce((a, r) => (score(r) > score(a) ? r : a));
  const [hot, setHot] = useState<Method | null>(null);
  return (
    <div className={f.ways}>
      <div className={f.spine}>
        <div className={f.spineHead} aria-hidden="true">
          <span />
          <span className={f.spineL}>Worst drawdown</span>
          <span className={f.spineR}>P&amp;L</span>
          <span>Win rate</span>
        </div>
        <ol>
          {runs.map((r, k) => (
            <li
              key={r.id}
              style={{ "--k": k, "--dd": -r.sum.maxDD / maxDD, "--pl": Math.abs(r.sum.net) / maxNet } as CSSProperties}
              data-pick={r.id === method ? "" : undefined}
              data-hot={hot === r.id ? "" : undefined}
              onPointerEnter={() => setHot(r.id)}
              onPointerLeave={() => setHot(null)}
            >
              <button type="button" onClick={() => setOwner({ method: r.id })} aria-pressed={r.id === method} aria-label={`Show ${r.label} on the dashboard`}>
                <span className={f.wayName}>
                  <b>
                    {r.label}
                    {r.id === best.id && <span className={f.best}>Best</span>}
                  </b>
                  <em>{r.blurb}</em>
                </span>
                <span className={f.ddSide}>
                  <em>−{plain(r.sum.maxDD)}</em>
                  <i />
                </span>
                <span className={f.plSide}>
                  <i data-neg={r.sum.net < 0 ? "" : undefined} />
                  <em>{signed(r.sum.net)}</em>
                </span>
                <span className={f.wayMeta}>
                  <b>{pct(r.sum.winRate)}</b>
                  <em>{r.sum.breached ? `Breached` : `$${score(r).toFixed(2)} per $1 down`}</em>
                </span>
              </button>
            </li>
          ))}
        </ol>
        <p className={f.fine}>The marked way is what your Dashboard shows; click another to switch. Best is the most P&amp;L for each dollar of drawdown.</p>
      </div>
      <Curves runs={runs} hot={hot ?? method} result={result} />
    </div>
  );
}

function Curves({ runs, hot, result }: { runs: Run[]; hot: Method; result: Result }) {
  const W = 620;
  const H = 300;
  const ref = useRef<SVGSVGElement>(null);
  const [at, setAt] = useState<number | null>(null);
  const ghost = useMemo(() => summarize(result).ghost, [result]);
  const vals = runs.filter((r) => r.id !== "full").flatMap((r) => r.sum.curve.map((c) => c.eq));
  const lo = Math.min(0, ...vals);
  const hi = Math.max(1, ...vals);
  const n = runs[0].sum.curve.length;
  const X = (i: number) => (i / (n - 1)) * (W - 6);
  const Y = (v: number) => 10 + (1 - (Math.max(lo, Math.min(hi * 1.04, v)) - lo) / (hi * 1.04 - lo)) * (H - 26);
  const path = (v: number[]) => {
    const step = Math.max(1, Math.floor(v.length / 300));
    let d = "";
    for (let i = 0; i < v.length; i += step) d += `${d ? "L" : "M"}${X(i).toFixed(1)} ${Y(v[i]).toFixed(1)}`;
    return `${d}L${X(v.length - 1).toFixed(1)} ${Y(v[v.length - 1]).toFixed(1)}`;
  };
  const sel = runs.find((r) => r.id === hot)!;
  const move = (e: RPE<SVGSVGElement>) => {
    const r = ref.current!.getBoundingClientRect();
    setAt(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width) * (n - 1)))));
  };
  const i = at ?? n - 1;
  return (
    <div className={f.curves}>
      <div className={f.curveHead}>
        <span className={f.k}>{at === null ? "Over his whole record" : `After his trade ${at}`}</span>
        <span className={f.curveRead}>
          <b>{sel.label}</b>
          <span className={sel.sum.curve[i].eq >= 0 ? f.pos : f.neg}>{signed(sel.sum.curve[i].eq)}</span>
        </span>
      </div>
      <div className={f.curveBox}>
        <svg ref={ref} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onPointerMove={move} onPointerLeave={() => setAt(null)} role="img" aria-label="Each way of joining, over his record">
          <line x1="0" x2={W} y1={Y(0)} y2={Y(0)} className={f.zero} />
          {runs.map((r) => (
            <path key={r.id} d={path(r.sum.curve.map((c) => c.eq))} className={f.curve} data-on={r.id === hot ? "" : undefined} data-full={r.id === "full" ? "" : undefined} />
          ))}
          {at !== null && <line x1={X(at)} x2={X(at)} y1="0" y2={H - 10} className={f.scrub} />}
        </svg>
        <i className={f.curveDot} style={{ left: `${(X(i) / W) * 100}%`, top: `${(Y(sel.sum.curve[i].eq) / H) * 100}%` }} />
      </div>
      <p className={f.fine}>
        Yazan made {signed(ghost[ghost.length - 1])} at his full size over the same trades. The 1:1 copy runs off the top: it makes the most and breaches the account.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* recent calls                                                         */
/* ------------------------------------------------------------------ */

function Calls({ rows }: { rows: Row[] }) {
  const list = rows.slice(-8).reverse();
  return (
    <ol className={f.calls}>
      {list.map((r, k) => {
        const filled = r.legs.some((l) => l.filled.length);
        const m = r.decision.mode;
        return (
          <li key={r.t.id} style={{ "--k": k } as CSSProperties}>
            <time>
              {dayLabel(r.t.day)} <span>{hhmm(r.t.minute)}</span>
            </time>
            <span className={f.callHis}>
              <span className={`${f.side} ${r.t.side === "LONG" ? f.sideL : f.sideS}`}>{r.t.side === "LONG" ? "Long" : "Short"}</span>
              <span>{r.t.mkt}</span>
              <b className={r.t.pnl >= 0 ? f.pos : f.neg}>{signed(r.t.pnl)}</b>
            </span>
            <span className={f.callMode} data-m={m} data-unfilled={m !== "skip" && !filled ? "" : undefined}>
              {m === "skip" ? "Skipped" : MODE_LABEL[m]}
              {m !== "skip" && !filled && <em> · not filled</em>}
            </span>
            <p>{r.decision.reason}</p>
            <b className={!filled ? f.dimNum : r.pnl >= 0 ? f.pos : f.neg}>{filled ? signed(r.pnl) : "–"}</b>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* the page                                                             */
/* ------------------------------------------------------------------ */

export function Follow() {
  const { result } = useOwnerReplay();
  const sum = useMemo(() => summarize(result), [result]);
  return (
    <div className={f.page}>
      <Pair result={result} />
      <div className={s.sheet}>
        <i className={s.sheetR} aria-hidden="true" />
        <i className={s.sheetB} aria-hidden="true" />
        <div className={f.acctRow}>
          <Cell i={3} label={ACCOUNTS.length === 1 ? "The account" : "The accounts"} aside="Sample until it's connected">
            <Account result={result} />
          </Cell>
          <Cell i={4} label="Limits" aside="Enforced in code">
            <Limits />
          </Cell>
        </div>
        <div className={s.row1}>
          <Cell i={5} label="Six ways in" aside={`His ${result.rows.length} trades, through our account`}>
            <Ways result={result} />
          </Cell>
        </div>
        <div className={s.row1}>
          <Cell i={6} label="Recent calls" aside={`${sum.taken} taken · ${sum.skipped} skipped · ${sum.unfilled} not filled`}>
            <Calls rows={result.rows} />
          </Cell>
        </div>
      </div>
      <p className={f.sample}>Sample data. Yazan&apos;s record is the seeded one and our account is simulated until both are connected.</p>
    </div>
  );
}
