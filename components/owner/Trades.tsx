"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { fmt } from "@/lib/format";
import { INSTRUMENTS } from "@/lib/desk/instruments";
import { hisBook, openPnl, useDesk, type Order, type Trade } from "@/lib/desk/store";
import { clockS, currentTrade } from "@/lib/community/trades";
import { startRoom } from "@/lib/community/room";
import { account, PHASE_LABEL, type Follow, type LogItem } from "@/lib/follow/engine";
import { hisOf, useFollow } from "@/lib/follow/runner";
import { Sheet } from "@/components/community/Community";
import x from "./trades.module.css";

/*
 * What every owner page reads about the follow: Yazan's trade (open, else his last), what
 * the engine has done with it, our own trade in the book, the account, and the reasoning.
 */

export const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
export const signed = (n: number) => (n >= 0 ? "+" : "−") + `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;

export function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

const NO_LOG: LogItem[] = [];

export function useFollowView() {
  const now = useNow(1000);
  useEffect(() => startRoom(), []);
  const ready = useDesk((d) => d.ready && d.seat === "owner" && !!d.other);
  const hisTrades = useDesk((d) => hisBook(d).trades);
  const hisOrders = useDesk((d) => hisBook(d).orders);
  const trade = currentTrade(hisTrades);
  const st = useFollow((f) => f.state);
  const rules = useFollow((f) => f.rules);
  const limits = useFollow((f) => f.limits);
  const thinking = useFollow((f) => (trade ? !!f.thinking[trade.id] : false));
  const own = useDesk((d) => (trade ? [...d.trades].reverse().find((t) => t.follows === trade.id) : undefined));
  const equity = useDesk((d) => Math.round((d.start + d.trades.reduce((a, t) => a + t.pnl, 0) + openPnl(d)) * 100) / 100);
  const ownOrders = useDesk((d) => d.orders);
  const f: Follow | undefined = trade && st ? st.follows[trade.id] : undefined;
  const log = useMemo(() => (st && trade ? st.log.filter((l) => l.his === trade.id) : NO_LOG), [st, trade]);
  const his = useMemo(() => (trade ? hisOf(trade, { orders: hisOrders } as never) : null), [trade, hisOrders]);
  const acct = st ? account(rules, limits, st, equity) : null;
  const orders = useMemo(() => (trade ? ownOrders.filter((o) => o.follows === trade.id) : []), [ownOrders, trade]);
  return { now, ready: ready && !!st, trade, his, f, own, log, st, rules, limits, acct, orders, thinking };
}

export type View = ReturnType<typeof useFollowView>;

/* ------------------------------------------------------------------ */
/* words                                                               */
/* ------------------------------------------------------------------ */

const clockOf = (ms: number) => clockS(ms).replace(/ (AM|PM)$/, "");
export const mmss = (sec: number) => `${Math.floor(Math.max(0, sec) / 60)}:${String(Math.floor(Math.max(0, sec) % 60)).padStart(2, "0")}`;

/** Where our side of his trade stands, as a heading. */
export function headline(v: View): string {
  const { f, trade, own, st } = v;
  if (st?.halted) return "Stopped at the stop line.";
  if (!trade) return "Waiting for his first trade.";
  if (!f) return "Reading his trade.";
  if (f.status === "watching") return "Watching his trade.";
  if (f.status === "working") return f.limit !== undefined ? `Asking for ${fmt(f.limit)}.` : "Going in.";
  if (f.status === "in") return f.tp1Done ? "First target banked." : own ? "In with him." : "Going in.";
  if (f.status === "done") return f.exitWhy === "His target" || f.exitWhy === "His first target" ? "Out at his target." : f.exitWhy === "Our stop" ? "Out at our stop." : f.exitWhy === "You closed it by hand" ? "You closed it." : f.exitWhy === "He closed, so did we" ? "Out with him." : `Out. ${f.exitWhy ?? ""}`.trim();
  if (f.why === "Before following started" || f.why?.startsWith("Missed")) return "Before we were following.";
  return "Passed on this one.";
}

/** The reason under the heading: the engine's latest thought on this trade. */
export function latestThought(v: View): LogItem | undefined {
  return [...v.log].reverse().find((l) => l.kind === "think" || l.kind === "guard" || l.kind === "out") ?? v.log[v.log.length - 1];
}

export const KIND_LABEL: Record<LogItem["kind"], string> = { see: "Saw", think: "Decided", act: "Did", fill: "Filled", out: "Out", guard: "Guardrail", alert: "Alert" };

/* ------------------------------------------------------------------ */
/* the reasoning, step by step                                         */
/* ------------------------------------------------------------------ */

export function Reasoning({ log, thinking = false, compact = false }: { log: LogItem[]; thinking?: boolean; compact?: boolean }) {
  if (!log.length && !thinking) return <p className={x.fine}>Nothing yet.</p>;
  return (
    <ol className={x.steps} data-compact={compact ? "" : undefined}>
      {log.map((l, k) => (
        <li key={l.at + l.text} data-done="" data-k={l.kind} style={{ "--k": Math.min(k, 12) } as CSSProperties}>
          <i aria-hidden="true" />
          <time>{clockOf(l.at)}</time>
          <b>
            {l.text}
            {l.by === "ai" && <span className={x.ai}>AI</span>}
          </b>
          {l.sub && <p>{l.sub}</p>}
        </li>
      ))}
      {thinking && (
        <li style={{ "--k": 0 } as CSSProperties}>
          <i aria-hidden="true" />
          <time>now</time>
          <b>Asking the AI</b>
        </li>
      )}
    </ol>
  );
}

/** Our orders for his trade, from the book. */
export function OrderList({ orders }: { orders: Order[] }) {
  if (!orders.length) return <p className={x.fine}>No orders working.</p>;
  const label = (o: Order) => (o.tag === "entry" ? "Entry" : o.tag === "stop" ? "Our stop" : o.tag === "tp1" ? "His first target" : o.tag === "tp2" ? "His second target" : o.role);
  return (
    <ol className={x.orders}>
      {orders.map((o) => (
        <li key={o.id}>
          <i aria-hidden="true" data-k={o.tag} />
          <span>{label(o)}</span>
          <b>{fmt((o.type === "STP" ? o.stop : o.limit) ?? 0)}</b>
          <em>
            {o.side > 0 ? "Buy" : "Sell"} {o.qty} {INSTRUMENTS[o.sym].code} · {o.type === "STP" ? "stop" : o.type === "LMT" ? "limit" : o.type.toLowerCase()}
          </em>
        </li>
      ))}
    </ol>
  );
}

/** Our side before there's a trade of ours to open: what the engine is doing instead. */
export function Pending({ v }: { v: View }) {
  const { f, his, now, limits, trade } = v;
  const t = trade ? (now - trade.openedAt) / 1000 : 0;
  const last = latestThought(v);
  return (
    <div className={x.waiting}>
      {his && (
        <div className={x.waitHead}>
          <span className={`${x.side} ${his.dir > 0 ? x.sideL : x.sideS}`}>{his.dir > 0 ? "Long" : "Short"}</span>
          <span>{INSTRUMENTS[his.under === "NQ" ? "MNQ" : "MES"].name.replace("Micro E-mini ", "")} micros</span>
          <em>{f?.status === "watching" ? mmss(limits.window - t) : ""}</em>
        </div>
      )}
      <p className={x.waitSay}>{headline(v)}</p>
      {f?.status === "watching" && (
        <span className={x.window} style={{ "--p": Math.min(1, t / limits.window) } as CSSProperties} aria-label={`${Math.round(t)} of ${limits.window} seconds`}>
          <i />
        </span>
      )}
      {last && (
        <p className={x.waitWhy}>
          {last.sub ? `${last.text}. ${last.sub}.` : `${last.text}.`}
          {last.by === "ai" && <span className={x.ai}>AI</span>}
        </p>
      )}
      {f?.status === "passed" && f.why && last?.text.indexOf(f.why) === -1 && <p className={x.waitWhy}>{f.why}.</p>}
    </div>
  );
}

/** Beside our own trade's chart, in place of the members' room. */
export function MineSide({ v }: { v: View }) {
  const last = latestThought(v);
  return (
    <div className={x.mine}>
      <section>
        <header>
          <span>Where it stands</span>
          <em>{v.acct ? PHASE_LABEL[v.acct.phase] : ""}</em>
        </header>
        <p className={x.mineCall}>{headline(v)}</p>
        {last?.sub && <p className={x.mineWhy}>{last.sub}.</p>}
      </section>
      <section>
        <header>
          <span>Our orders</span>
          <em>{v.orders.length} working</em>
        </header>
        <OrderList orders={v.orders} />
      </section>
      <section>
        <header>
          <span>The agent</span>
          <em>{v.log.length} steps</em>
        </header>
        <Reasoning log={v.log} thinking={v.thinking} />
      </section>
    </div>
  );
}

export type Open = null | "his" | "mine";

export function TradeSheets({ open, v, onClose }: { open: Open; v: View; onClose: () => void }) {
  if (open === "his" && v.trade) return <Sheet trade={v.trade} kind="live" now={v.now} onClose={onClose} />;
  if (open === "mine" && v.own) return <Sheet who="mine" trade={v.own as Trade} kind={v.own.closedAt ? "history" : "live"} now={v.now} onClose={onClose} side={<MineSide v={v} />} />;
  return null;
}
