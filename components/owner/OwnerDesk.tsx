"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { fmt, money } from "@/lib/format";
import { selectSym, useDesk } from "@/lib/desk/store";
import { clockS } from "@/lib/community/trades";
import { startRoom } from "@/lib/community/room";
import { MODE_LABEL } from "@/lib/owner/replay";
import { useFollowPlan, type Plan } from "@/lib/owner/live";
import { useOwner } from "@/lib/owner/store";
import { Chart, type FollowLine } from "@/components/desk/Chart";
import { Preview, Sheet } from "@/components/community/Community";
import { Cell } from "@/components/trader/parts";
import t from "@/components/trader/trader.module.css";
import { useOwnerReplay } from "./OwnerDashboard";
import d from "./ownerDesk.module.css";

/** Our levels on the chart: the position once something fills, the orders still working, and his stop and target as ours. */
function linesOf(plan: Plan | null): FollowLine[] {
  if (!plan || !plan.live) return [];
  const out: FollowLine[] = [];
  const { dir, per, filled, avg, qty, pnl, stop, target, tranches } = plan;
  if (avg !== null) out.push({ id: "o-pos", price: avg, kind: "entry", title: `You ${dir > 0 ? "long" : "short"} ${qty}`, value: money(pnl), tone: pnl >= 0 ? "pos" : "neg" });
  tranches.forEach((x, k) => {
    if (!x.filledAt) out.push({ id: `o-add${k}`, price: x.price, kind: "order", title: `${dir > 0 ? "Buy" : "Sell"} lmt ${per}`, value: k ? `Add ${k}` : "Entry" });
  });
  out.push({ id: "o-stop", price: stop, kind: "stop", title: "Your stop", value: money(-plan.worst), tone: "neg" });
  if (target !== undefined && avg !== null) {
    const pv = plan.code.includes("NQ") ? 2 : 5;
    const gain = filled.reduce((a, x) => a + per * Math.abs(target - x.price) * pv, 0);
    out.push({ id: "o-target", price: target, kind: "target", title: "Your target", value: money(gain), tone: "pos" });
  }
  return out;
}

function You({ plan }: { plan: Plan | null }) {
  if (!plan) return <p className={d.quiet}>Our position shows here once Yazan trades.</p>;
  const { filled, tranches, avg, pnl, live, dir, per } = plan;
  return (
    <div className={d.you}>
      <div className={d.youHead}>
        <span className={`${d.side} ${dir > 0 ? d.sideL : d.sideS}`}>{dir > 0 ? "Long" : "Short"}</span>
        <span>
          {plan.qty || per} {plan.code.replace(/Z\d$/, "")} micros
        </span>
        <em>{!filled.length ? (live ? "Working" : "Not filled") : live ? "In" : "Closed"}</em>
      </div>
      <span className={`${d.pnl} ${filled.length ? (pnl >= 0 ? d.pos : d.neg) : ""}`}>{money(filled.length ? pnl : 0)}</span>
      <dl className={d.facts}>
        <div>
          <dt>Way in</dt>
          <dd>{MODE_LABEL[plan.mode]}</dd>
        </div>
        <div>
          <dt>Filled</dt>
          <dd>
            {filled.length} of {tranches.length}
          </dd>
        </div>
        <div>
          <dt>Average</dt>
          <dd>{avg !== null ? fmt(avg) : "–"}</dd>
        </div>
        <div>
          <dt>Worst case</dt>
          <dd className={d.neg}>{money(-plan.worst)}</dd>
        </div>
      </dl>
    </div>
  );
}

export function OwnerDesk() {
  const ready = useDesk((x) => x.ready);
  const { result, settings } = useOwnerReplay();
  const { trade, plan, now } = useFollowPlan(result, settings);
  const following = useOwner((x) => x.following);
  const [open, setOpen] = useState(false);
  useEffect(() => startRoom(), []);
  // the chart follows his market
  useEffect(() => {
    if (trade && useDesk.getState().settings.sym !== trade.sym) selectSym(trade.sym);
  }, [trade]);
  const lines = useMemo(() => linesOf(plan), [plan]);

  return (
    <div className={d.desk}>
      <i className={t.sheetR} aria-hidden="true" />
      <i className={t.sheetB} aria-hidden="true" />
      <Cell i={0} noTop className={d.aChart} bodyClass={d.flush}>
        {ready && <Chart viewer follow={lines} />}
        <span className={d.key} aria-hidden="true">
          <span>
            <i data-k="his" />
            Yazan
          </span>
          <span>
            <i data-k="you" />
            You
          </span>
        </span>
      </Cell>
      <div className={d.side_}>
        <Cell i={1} noTop label={plan?.live ? "Yazan" : "Yazan's last trade"} aside={plan?.live ? <span className={d.live}>Live</span> : "Closed"} bodyClass={d.body}>
          {ready && trade ? (
            <>
              <Preview trade={trade} now={now} onOpen={() => setOpen(true)} />
              <button type="button" className={d.openBtn} onClick={() => setOpen(true)}>
                <span>Chart and room</span>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3.5 2.5h6v6M9.5 2.5l-7 7" />
                </svg>
              </button>
            </>
          ) : (
            <p className={d.quiet}>No trades from Yazan yet.</p>
          )}
        </Cell>
        <Cell i={2} label="You" aside={following ? "Following" : "Paused"} bodyClass={d.body}>
          <You plan={plan} />
        </Cell>
        <Cell i={3} label="Agent" aside={plan ? MODE_LABEL[plan.mode] : ""} bodyClass={d.body}>
          {plan ? (
            <ol className={d.steps}>
              {plan.steps.map((x, k) => (
                <li key={x.at + x.short} data-done={x.done ? "" : undefined} style={{ "--k": k } as CSSProperties}>
                  <i />
                  <time>{clockS(x.at)}</time>
                  <b>{x.text}</b>
                  {x.sub && <p>{x.sub}</p>}
                </li>
              ))}
            </ol>
          ) : (
            <p className={d.quiet}>Waiting for his first trade.</p>
          )}
        </Cell>
      </div>
      {open && trade && <Sheet trade={trade} kind="live" now={now} onClose={() => setOpen(false)} />}
    </div>
  );
}
