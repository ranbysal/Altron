"use client";

import { memo, useState, type CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";
import { fmt, money } from "@/lib/format";
import { DAY_MARGIN, INSTRUMENTS, SYMS, type Sym } from "@/lib/desk/instruments";
import { ACCOUNT, OWNER_ACCOUNT, cancelAll, cancelOrder, closePercent, dayStart, describe, flatten, noticeText, openPnl, realizedSince, selectSym, toggleBlotter, useDesk, type Trade } from "@/lib/desk/store";
import s from "./desk.module.css";

/*
 * The blotter is split so the tape only re-renders what moves with it: the
 * account line, the open position rows and the P&L of an open trade. Orders,
 * fills and closed trades sit still between ticks.
 */

type Tab = "positions" | "orders" | "fills" | "trades" | "notified";

function clock(t: number): string {
  return new Date(t).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", second: "2-digit" });
}

const AccountLine = memo(function AccountLine() {
  const positions = useDesk((st) => st.positions);
  const quotes = useDesk((st) => st.quotes);
  const trades = useDesk((st) => st.trades);
  const start = useDesk((st) => st.start);
  const owner = useDesk((st) => st.seat === "owner");
  const unreal = openPnl({ positions, quotes });
  const realized = realizedSince(trades, dayStart());
  const equity = start + trades.reduce((a, t) => a + t.pnl, 0) + unreal;
  const margin = SYMS.reduce((a, x) => a + Math.abs(positions[x]?.qty ?? 0) * DAY_MARGIN[x], 0);
  return (
    <dl className={s.acctLine}>
      <div className={s.acctName}>
        <dt>{owner ? OWNER_ACCOUNT.name : ACCOUNT.name}</dt>
        <dd>
          <i className={s.okDot} aria-label="Connected" />
        </dd>
      </div>
      <div>
        <dt>Equity</dt>
        <dd>${fmt(equity)}</dd>
      </div>
      <div>
        <dt>Realized</dt>
        <dd className={realized > 0 ? s.pos : realized < 0 ? s.neg : undefined}>{money(realized)}</dd>
      </div>
      <div>
        <dt>Unrealized</dt>
        <dd className={unreal > 0 ? s.pos : unreal < 0 ? s.neg : undefined}>{money(unreal)}</dd>
      </div>
      <div className={s.acctWide}>
        <dt>Margin</dt>
        <dd>${fmt(margin)}</dd>
      </div>
      <div>
        <dt>Available</dt>
        <dd>${fmt(equity - margin)}</dd>
      </div>
    </dl>
  );
});

const PositionRow = memo(function PositionRow({ x, i }: { x: Sym; i: number }) {
  const p = useDesk((st) => st.positions[x]);
  const q = useDesk((st) => st.quotes[x]);
  const stop = useDesk((st) => st.orders.find((o) => o.sym === x && o.role === "stop")?.stop);
  const tgt = useDesk((st) => st.orders.find((o) => o.sym === x && o.role === "target")?.limit);
  if (!p) return null;
  const pnl = ((p.qty > 0 ? q.bid : q.ask) - p.avg) * p.qty * INSTRUMENTS[x].pv;
  return (
    <tr style={{ "--k": i } as CSSProperties} onClick={() => selectSym(x)}>
      <td className={s.sym}>{INSTRUMENTS[x].code}</td>
      <td>
        <span className={`${s.side} ${p.qty > 0 ? s.sideL : s.sideS}`}>{p.qty > 0 ? "Long" : "Short"}</span>
      </td>
      <td>{Math.abs(p.qty)}</td>
      <td>{fmt(p.avg)}</td>
      <td>{fmt(q.last)}</td>
      <td className={s.neg}>{stop !== undefined ? fmt(stop) : "–"}</td>
      <td className={s.pos}>{tgt !== undefined ? fmt(tgt) : "–"}</td>
      <td className={`${s.r} ${pnl >= 0 ? s.pos : s.neg}`}>{money(pnl)}</td>
      <td className={s.r}>
        <button
          type="button"
          className={s.rowBtn}
          onClick={(e) => {
            e.stopPropagation();
            closePercent(x, 1);
          }}
        >
          Close
        </button>
      </td>
    </tr>
  );
});

function PositionsTab() {
  const open = useDesk(useShallow((st) => SYMS.filter((x) => st.positions[x])));
  return (
    <table className={s.tbl}>
      <thead>
        <tr>
          <th>Market</th>
          <th>Side</th>
          <th>Qty</th>
          <th>Avg</th>
          <th>Last</th>
          <th>Stop</th>
          <th>Target</th>
          <th className={s.r}>Open P&amp;L</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {open.map((x, i) => (
          <PositionRow key={x} x={x} i={i} />
        ))}
        {!open.length && (
          <tr>
            <td colSpan={9} className={s.none}>
              No open positions.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function OrdersTab() {
  const orders = useDesk((st) => st.orders);
  return (
    <table className={s.tbl}>
      <thead>
        <tr>
          <th>Placed</th>
          <th>Market</th>
          <th>Side</th>
          <th>Role</th>
          <th>Qty</th>
          <th>Order</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {[...orders].reverse().map((o, i) => (
          <tr key={o.id} style={{ "--k": i } as CSSProperties}>
            <td className={s.dimCell}>{clock(o.at)}</td>
            <td className={s.sym}>{INSTRUMENTS[o.sym].code}</td>
            <td>
              <span className={`${s.side} ${o.side > 0 ? s.sideL : s.sideS}`}>{o.side > 0 ? "Buy" : "Sell"}</span>
            </td>
            <td className={s.dimCell}>{o.role === "entry" ? "Entry" : o.role === "stop" ? "Stop" : o.role === "target" ? "Target" : "Exit"}</td>
            <td>{o.qty}</td>
            <td>{describe(o)}</td>
            <td className={s.r}>
              <button type="button" className={s.rowBtn} onClick={() => cancelOrder(o.id)}>
                Cancel
              </button>
            </td>
          </tr>
        ))}
        {!orders.length && (
          <tr>
            <td colSpan={7} className={s.none}>
              No working orders.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function FillsTab() {
  const fills = useDesk((st) => st.fills);
  return (
    <table className={s.tbl}>
      <thead>
        <tr>
          <th>Time</th>
          <th>Market</th>
          <th>Side</th>
          <th>Qty</th>
          <th>Price</th>
          <th>Via</th>
          <th className={s.r}>Realized</th>
        </tr>
      </thead>
      <tbody>
        {[...fills]
          .reverse()
          .slice(0, 80)
          .map((f, i) => (
            <tr key={f.id} style={{ "--k": Math.min(i, 8) } as CSSProperties}>
              <td className={s.dimCell}>{clock(f.at)}</td>
              <td className={s.sym}>{INSTRUMENTS[f.sym].code}</td>
              <td>
                <span className={`${s.side} ${f.side > 0 ? s.sideL : s.sideS}`}>{f.side > 0 ? "Buy" : "Sell"}</span>
              </td>
              <td>{f.qty}</td>
              <td>{fmt(f.price)}</td>
              <td className={s.dimCell}>{f.role === "entry" ? "Order" : f.role === "stop" ? "Stop" : f.role === "target" ? "Target" : "Exit"}</td>
              <td className={`${s.r} ${f.pnl > 0 ? s.pos : f.pnl < 0 ? s.neg : s.dimCell}`}>{f.pnl ? money(f.pnl) : "–"}</td>
            </tr>
          ))}
        {!fills.length && (
          <tr>
            <td colSpan={7} className={s.none}>
              No fills yet.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

/** R and P&L of a trade; only an open trade listens to the tape. */
function TradeNumbers({ t }: { t: Trade }) {
  const live = useDesk((st) => {
    if (t.closedAt) return 0;
    const p = st.positions[t.sym];
    return p ? ((p.qty > 0 ? st.quotes[t.sym].bid : st.quotes[t.sym].ask) - p.avg) * p.qty * INSTRUMENTS[t.sym].pv : 0;
  });
  const pnl = t.pnl + live;
  return (
    <>
      <td className={pnl >= 0 ? s.pos : s.neg}>{t.risk ? `${pnl >= 0 ? "+" : "−"}${Math.abs(pnl / t.risk).toFixed(1)}R` : "–"}</td>
      <td className={`${s.r} ${pnl >= 0 ? s.pos : s.neg}`}>{money(pnl)}</td>
    </>
  );
}

function TradesTab() {
  const trades = useDesk((st) => st.trades);
  const owner = useDesk((st) => st.seat === "owner");
  return (
    <table className={s.tbl}>
      <thead>
        <tr>
          <th>Opened</th>
          <th>Market</th>
          <th>Side</th>
          <th>Size</th>
          <th>Entry</th>
          <th>Exit</th>
          <th>{owner ? "Placed by" : "Members"}</th>
          <th>R</th>
          <th className={s.r}>P&amp;L</th>
        </tr>
      </thead>
      <tbody>
        {[...trades].reverse().map((t, i) => {
          return (
            <tr key={t.id} style={{ "--k": Math.min(i, 8) } as CSSProperties}>
              <td className={s.dimCell}>{clock(t.openedAt)}</td>
              <td className={s.sym}>{INSTRUMENTS[t.sym].code}</td>
              <td>
                <span className={`${s.side} ${t.side === "LONG" ? s.sideL : s.sideS}`}>{t.side === "LONG" ? "Long" : "Short"}</span>
              </td>
              <td>{t.qty}</td>
              <td>{fmt(t.entryValue / t.entryQty)}</td>
              <td>{t.closedAt ? fmt(t.exitValue / Math.max(1, t.exitQty)) : <span className={s.liveTag}>Open</span>}</td>
              <td className={s.dimCell}>{owner ? (t.follows ? "Agent" : "You") : t.notify ? "Notified" : "–"}</td>
              <TradeNumbers t={t} />
            </tr>
          );
        })}
        {!trades.length && (
          <tr>
            <td colSpan={9} className={s.none}>
              No trades yet.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

/** Everything members have been sent, newest first, to the second. */
function NotifiedTab() {
  const notices = useDesk((st) => st.notices);
  return (
    <table className={s.tbl}>
      <thead>
        <tr>
          <th>Sent</th>
          <th>Market</th>
          <th>What members read</th>
          <th>Note</th>
        </tr>
      </thead>
      <tbody>
        {[...notices]
          .reverse()
          .slice(0, 120)
          .map((n, i) => {
            const { head, body } = noticeText(n);
            return (
              <tr key={n.id} style={{ "--k": Math.min(i, 8) } as CSSProperties}>
                <td className={s.dimCell}>{clock(n.at)}</td>
                <td className={s.sym}>{INSTRUMENTS[n.sym].code}</td>
                <td className={s.noticeCell}>
                  <b>{head}</b>
                  {body && <span>{body}</span>}
                </td>
                <td className={s.noteCell}>{n.note ?? "–"}</td>
              </tr>
            );
          })}
        {!notices.length && (
          <tr>
            <td colSpan={4} className={s.none}>
              Nothing sent yet. Use the bell next to Buy or Sell to notify members with an order.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

/** Positions, working orders, fills and the day's trades, with the account alongside. */
export function Blotter() {
  const shown = useDesk((st) => st.settings.blotter);
  const [nPos, nOrd, nFill, nTrade, nSent, cancellable] = useDesk(
    useShallow((st) => [SYMS.filter((x) => st.positions[x]).length, st.orders.length, st.fills.length, st.trades.length, st.notices.length, st.orders.some((o) => !o.reduceOnly)] as const),
  );
  const owner = useDesk((st) => st.seat === "owner");
  const [picked, setTab] = useState<Tab>("positions");
  // what members were sent is Yazan's to read, not the owner's
  const tab: Tab = owner && picked === "notified" ? "positions" : picked;
  const tabs: { id: Tab; label: string; n: number }[] = [
    { id: "positions", label: "Positions", n: nPos },
    { id: "orders", label: "Orders", n: nOrd },
    { id: "fills", label: "Fills", n: nFill },
    { id: "trades", label: "Trades", n: nTrade },
    ...(owner ? [] : [{ id: "notified" as Tab, label: "Notified", n: nSent }]),
  ];

  return (
    <div className={s.blotter}>
      <div className={s.blotHead}>
        <div className={s.blotTabs} role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === tab}
              onClick={() => {
                setTab(t.id);
                if (!shown) toggleBlotter(true);
              }}
            >
              {t.label}
              <em>{t.n}</em>
            </button>
          ))}
        </div>
        <AccountLine />
        <div className={s.blotActions}>
          <button type="button" className={s.blotCancel} onClick={() => cancelAll()} disabled={!cancellable}>
            Cancel orders
          </button>
          <button type="button" className={s.flat} onClick={() => flatten()} disabled={!nPos && !nOrd}>
            Close all
          </button>
          <button type="button" className={s.fold} aria-expanded={shown} onClick={() => toggleBlotter()} title="Put the blotter away" aria-label="Put the blotter away">
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      <div className={s.blotBody}>
        {tab === "positions" && <PositionsTab />}
        {tab === "orders" && <OrdersTab />}
        {tab === "fills" && <FillsTab />}
        {tab === "trades" && <TradesTab />}
        {tab === "notified" && <NotifiedTab />}
      </div>
    </div>
  );
}
