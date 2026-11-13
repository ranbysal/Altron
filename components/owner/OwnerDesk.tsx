"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { INSTRUMENTS } from "@/lib/desk/instruments";
import { selectSym, useDesk } from "@/lib/desk/store";
import { MICRO } from "@/lib/follow/engine";
import { setOwner, useOwner } from "@/lib/owner/store";
import { Desk } from "@/components/desk/Desk";
import { Preview } from "@/components/community/Community";
import { Pending, Reasoning, TradeSheets, useFollowView, type Open } from "./Trades";
import d from "./ownerDesk.module.css";

/*
 * The owner's desk is Yazan's desk on the owner's own book: the same chart, ticket, position
 * and blotter. Yazan's live levels sit on the chart in his own colour, and the right column
 * has a second view with his trade, ours, and every step the agent took.
 */

export function OwnerDesk() {
  const v = useFollowView();
  const view = useOwner((x) => x.deskView);
  const following = useOwner((x) => x.following);
  const [open, setOpen] = useState<Open>(null);
  const { trade, his, own, f } = v;
  const mineSym = his ? MICRO[his.under].sym : null;
  const hisLive = !!trade && !trade.closedAt;
  const hisId = trade?.id;

  // when he opens a trade, the chart goes to that market's micro, where our orders are
  useEffect(() => {
    if (!v.ready || !hisLive || !mineSym) return;
    if (INSTRUMENTS[useDesk.getState().settings.sym].under !== INSTRUMENTS[mineSym].under) selectSym(mineSym);
  }, [v.ready, hisLive, hisId, mineSym]);

  const ownState = own ? (own.closedAt ? "Closed" : "In") : f?.status === "passed" ? "Passed" : f?.status === "watching" ? "Deciding" : f?.status === "working" ? "Working" : following ? "Following" : "Paused";
  const panel = (
    <div className={d.panel}>
      <section className={d.block} style={{ "--k": 0 } as CSSProperties}>
        <header className={d.blockHead}>
          <span data-who="his">Yazan</span>
          <em data-live={hisLive ? "" : undefined}>{hisLive ? "Live" : "Last trade"}</em>
        </header>
        {trade ? <Preview compact trade={trade} now={v.now} onOpen={() => setOpen("his")} /> : <p className={d.quiet}>No trades from Yazan yet.</p>}
      </section>
      <section className={d.block} style={{ "--k": 1 } as CSSProperties}>
        <header className={d.blockHead}>
          <span data-who="you">You</span>
          <em data-live={own && !own.closedAt ? "" : undefined}>{ownState}</em>
        </header>
        {own ? <Preview compact who="mine" trade={own} now={v.now} onOpen={() => setOpen("mine")} /> : trade ? <Pending v={v} /> : <p className={d.quiet}>Our side shows here once Yazan trades.</p>}
      </section>
      <section className={d.block} style={{ "--k": 2 } as CSSProperties}>
        <header className={d.blockHead}>
          <span>The agent</span>
          <em>{v.thinking ? "Thinking" : `${v.log.length} steps`}</em>
        </header>
        <Reasoning log={v.log} thinking={v.thinking} compact />
      </section>
    </div>
  );

  return (
    <>
      <Desk owner={{ view, onView: (x) => setOwner({ deskView: x }), live: hisLive, panel, aside: following ? "Following" : "Paused" }} />
      <TradeSheets open={open} v={v} onClose={() => setOpen(null)} />
    </>
  );
}
