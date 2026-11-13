"use client";

import { useEffect, type CSSProperties } from "react";
import { fmt } from "@/lib/format";
import { clockS } from "@/lib/community/trades";
import { startRoom } from "@/lib/community/room";
import { MODE_LABEL, type Mode } from "@/lib/owner/replay";
import { useFollowPlan, type Plan } from "@/lib/owner/live";
import { Sheet } from "@/components/community/Community";
import type { Trade } from "@/lib/desk/store";
import { useOwnerReplay } from "./OwnerDashboard";
import x from "./trades.module.css";

/** What the agent decided, said the way a person would. */
export const CALL: Record<Mode, string> = {
  mirror: "Join him at his entry.",
  staged: "Stage in, three steps toward his stop.",
  late: "Wait near his stop, then go in.",
};

const pct = (n: number) => `${Math.round(n * 100)}%`;
const plain = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;

/** Yazan's trade (live, or his last) and ours, for every owner page that shows them. */
export function useLive() {
  const { result, settings } = useOwnerReplay();
  const live = useFollowPlan(result, settings);
  useEffect(() => startRoom(), []);
  return { ...live, result };
}

/** Every step the agent took on this trade, in order, with the reason under each. */
export function AgentSteps({ plan }: { plan: Plan }) {
  return (
    <ol className={x.steps}>
      {plan.steps.map((st, k) => (
        <li key={st.at + st.short} data-done={st.done ? "" : undefined} style={{ "--k": k } as CSSProperties}>
          <i aria-hidden="true" />
          <time>{clockS(st.at).replace(/ (AM|PM)$/, "")}</time>
          <b>{st.text}</b>
          {st.sub && <p>{st.sub}</p>}
        </li>
      ))}
    </ol>
  );
}

/** Our orders for this trade: where each sits against his stop, and what became of it. */
export function OrderList({ plan }: { plan: Plan }) {
  const over = !plan.live || plan.byHand;
  return (
    <ol className={x.orders}>
      {plan.tranches.map((t, k) => (
        <li key={k} data-filled={t.filledAt ? "" : undefined}>
          <i aria-hidden="true" />
          <span>{t.level === 0 ? "At his entry" : `${Math.round(t.level * 100)}% of the way to his stop`}</span>
          <b>{fmt(t.price)}</b>
          <em>
            {plan.per} micros · {t.filledAt ? `Filled ${clockS(t.filledAt)}` : plan.state === "Deciding" ? "Not placed yet" : over ? "Cancelled" : "Working"}
          </em>
        </li>
      ))}
    </ol>
  );
}

const WAIT: Record<Plan["state"], (p: Plan) => string> = {
  Deciding: () => "Reading his trade.",
  Working: (p) => (p.tranches.length > 1 ? "Orders are in, waiting for price." : "One order in, waiting for price."),
  "Standing by": () => "Nothing working on this one.",
  "Not filled": () => "Price never came to us.",
  In: () => "",
  Closed: () => "",
};

/** Our side before anything has filled: there's no trade to open yet, so say what's waiting. */
export function Waiting({ plan }: { plan: Plan }) {
  return (
    <div className={x.waiting}>
      <div className={x.waitHead}>
        <span className={`${x.side} ${plan.dir > 0 ? x.sideL : x.sideS}`}>{plan.dir > 0 ? "Long" : "Short"}</span>
        <span>
          {plan.per} micros × {plan.tranches.length} {plan.tranches.length === 1 ? "order" : "orders"}
        </span>
        <em>{plan.state}</em>
      </div>
      <p className={x.waitSay}>{WAIT[plan.state](plan)}</p>
      <OrderList plan={plan} />
      <p className={x.fine}>
        {plan.live ? `Worst case ${plain(plan.worst)} if every order fills and his stop is hit, ${pct(plan.ourShare)} of our room.` : "He was in and out before price reached our orders, so they were cancelled."}
      </p>
    </div>
  );
}

/** Beside our own trade's chart, in place of the members' room: the call, our orders, the agent. */
export function MineSide({ plan }: { plan: Plan }) {
  return (
    <div className={x.mine}>
      <section>
        <header>
          <span>The call</span>
          <em>{MODE_LABEL[plan.mode]}</em>
        </header>
        <p className={x.mineCall}>{CALL[plan.mode]}</p>
        <p className={x.mineWhy}>{plan.reason}.</p>
      </section>
      <section>
        <header>
          <span>Our orders</span>
          <em>
            {plan.filled.length} of {plan.tranches.length} filled
          </em>
        </header>
        <OrderList plan={plan} />
      </section>
      <section>
        <header>
          <span>The agent</span>
          <em>{plan.byHand ? "You closed by hand" : plan.ownLive ? "Following" : "Done"}</em>
        </header>
        <AgentSteps plan={plan} />
      </section>
    </div>
  );
}

export type Open = null | "his" | "mine";

/** The pop-up for either trade: Community's own sheet, with our side's panel when it's ours. */
export function TradeSheets({ open, trade, plan, now, onClose }: { open: Open; trade?: Trade; plan: Plan | null; now: number; onClose: () => void }) {
  if (open === "his" && trade) return <Sheet trade={trade} kind="live" now={now} onClose={onClose} />;
  if (open === "mine" && plan?.own) return <Sheet who="mine" trade={plan.own} kind={plan.ownLive ? "live" : "history"} now={now} onClose={onClose} side={<MineSide plan={plan} />} />;
  return null;
}
