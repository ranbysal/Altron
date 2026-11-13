"use client";

import { useEffect, useState } from "react";
import { INSTRUMENTS } from "@/lib/desk/instruments";
import { selectSym, useDesk } from "@/lib/desk/store";
import { MODE_LABEL } from "@/lib/owner/replay";
import { MICRO_OF } from "@/lib/owner/live";
import { setOwner, useOwner } from "@/lib/owner/store";
import { Desk } from "@/components/desk/Desk";
import { Preview } from "@/components/community/Community";
import { AgentSteps, TradeSheets, useLive, Waiting, type Open } from "./Trades";
import d from "./ownerDesk.module.css";

/*
 * The owner's desk is Yazan's desk on the owner's own book: the same chart, ticket, position
 * and blotter. Yazan's live levels sit on the chart in his own colour, and the right column
 * has a second view with his trade, ours, and what the agent did.
 */

export function OwnerDesk() {
  const { trade, plan, now, ready } = useLive();
  const view = useOwner((x) => x.deskView);
  const following = useOwner((x) => x.following);
  const [open, setOpen] = useState<Open>(null);
  const mineSym = trade ? MICRO_OF[INSTRUMENTS[trade.sym].under] : null;
  const hisId = trade?.id;
  const hisLive = !!trade && !trade.closedAt;

  // when he opens a trade, the chart goes to that market's micro, where our orders are
  useEffect(() => {
    if (!ready || !hisLive || !mineSym) return;
    if (INSTRUMENTS[useDesk.getState().settings.sym].under !== INSTRUMENTS[mineSym].under) selectSym(mineSym);
  }, [ready, hisLive, hisId, mineSym]);

  const panel = (
    <div className={d.panel}>
      <section className={d.block} style={{ "--k": 0 } as React.CSSProperties}>
        <header className={d.blockHead}>
          <span data-who="his">Yazan</span>
          <em data-live={hisLive ? "" : undefined}>{hisLive ? "Live" : "Last trade"}</em>
        </header>
        {trade ? <Preview compact trade={trade} now={now} onOpen={() => setOpen("his")} /> : <p className={d.quiet}>No trades from Yazan yet.</p>}
      </section>
      <section className={d.block} style={{ "--k": 1 } as React.CSSProperties}>
        <header className={d.blockHead}>
          <span data-who="you">You</span>
          <em data-live={plan?.ownLive ? "" : undefined}>{plan ? (plan.byHand ? "Closed by hand" : plan.state) : following ? "Following" : "Paused"}</em>
        </header>
        {plan?.own ? <Preview compact who="mine" trade={plan.own} now={now} onOpen={() => setOpen("mine")} /> : plan ? <Waiting plan={plan} /> : <p className={d.quiet}>Our side shows here once Yazan trades.</p>}
      </section>
      <section className={d.block} style={{ "--k": 2 } as React.CSSProperties}>
        <header className={d.blockHead}>
          <span>The agent</span>
          <em>{plan ? MODE_LABEL[plan.mode] : ""}</em>
        </header>
        {plan ? <AgentSteps plan={plan} /> : <p className={d.quiet}>Waiting for his first trade.</p>}
      </section>
    </div>
  );

  return (
    <>
      <Desk owner={{ view, onView: (v) => setOwner({ deskView: v }), live: hisLive, panel, aside: following ? "Following" : "Paused" }} />
      <TradeSheets open={open} trade={trade} plan={plan} now={now} onClose={() => setOpen(null)} />
    </>
  );
}
