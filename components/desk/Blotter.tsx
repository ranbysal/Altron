"use client";

import { useState, type CSSProperties } from "react";
import { fmt, money } from "@/lib/format";
import { INSTRUMENTS, SYMS } from "@/lib/desk/instruments";
import { ACCOUNT, cancelAll, cancelOrder, closePercent, dayStart, describe, flatten, openPnl, realizedSince, selectSym, setThread, toggleBlotter, toggleNotes, useDesk } from "@/lib/desk/store";
import s from "./desk.module.css";

type Tab = "positions" | "orders" | "fills" | "trades";

function clock(t: number): string {
  return new Date(t).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", second: "2-digit" });
}

/** Positions, working orders, fills and the day's trades, with the account alongside. */
export function Blotter() {
  const shown = useDesk((st) => st.settings.blotter);
  const positions = useDesk((st) => st.positions);
  const quotes = useDesk((st) => st.quotes);
  const orders = useDesk((st) => st.orders);
  const fills = useDesk((st) => st.fills);
  const trades = useDesk((st) => st.trades);
  const notes = useDesk((st) => st.notes);
  const thread = useDesk((st) => st.thread);
  const [tab, setTab] = useState<Tab>("positions");
  const open = SYMS.filter((x) => positions[x]);
  const tabs: { id: Tab; label: string; n: number }[] = [
    { id: "positions", label: "Positions", n: open.length },
    { id: "orders", label: "Orders", n: orders.length },
    { id: "fills", label: "Fills", n: fills.length },
    { id: "trades", label: "Trades", n: trades.length },
  ];
  const ti = tabs.findIndex((t) => t.id === tab);
  const unreal = openPnl({ positions, quotes });
  const day = realizedSince(trades, dayStart()) + unreal;
  const balance = ACCOUNT.start + trades.reduce((a, t) => a + t.pnl, 0);

  return (
    <div className={s.blotter}>
      <div className={s.blotHead}>
        <div className={s.blotTabs} role="tablist" style={{ "--i": ti } as CSSProperties}>
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
        <dl className={s.acctLine}>
          <div className={s.acctName}>
            <dt>{ACCOUNT.name}</dt>
            <dd>
              <i className={s.okDot} aria-label="Connected" />
            </dd>
          </div>
          <div>
            <dt>Balance</dt>
            <dd>${fmt(balance)}</dd>
          </div>
          <div>
            <dt>Day</dt>
            <dd className={day >= 0 ? s.pos : s.neg}>{money(day)}</dd>
          </div>
          <div>
            <dt>Open</dt>
            <dd className={unreal >= 0 ? s.pos : s.neg}>{money(unreal)}</dd>
          </div>
        </dl>
        <div className={s.blotActions}>
          <button type="button" onClick={() => cancelAll()} disabled={!orders.some((o) => !o.reduceOnly)}>
            Cancel orders
          </button>
          <button type="button" className={s.flat} onClick={() => flatten()} disabled={!open.length && !orders.length}>
            Flatten all
          </button>
          <button type="button" className={s.fold} aria-expanded={shown} onClick={() => toggleBlotter()} title={shown ? "Fold the blotter away" : "Show the blotter"} aria-label={shown ? "Fold the blotter away" : "Show the blotter"}>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      <div className={s.blotBody}>
        {tab === "positions" && (
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
              {open.map((x, i) => {
                const p = positions[x]!;
                const q = quotes[x];
                const pnl = ((p.qty > 0 ? q.bid : q.ask) - p.avg) * p.qty * INSTRUMENTS[x].pv;
                const stop = orders.find((o) => o.sym === x && o.role === "stop");
                const tgt = orders.find((o) => o.sym === x && o.role === "target");
                return (
                  <tr key={x} style={{ "--k": i } as CSSProperties} onClick={() => selectSym(x)}>
                    <td className={s.sym}>{INSTRUMENTS[x].code}</td>
                    <td>
                      <span className={`${s.side} ${p.qty > 0 ? s.sideL : s.sideS}`}>{p.qty > 0 ? "Long" : "Short"}</span>
                    </td>
                    <td>{Math.abs(p.qty)}</td>
                    <td>{fmt(p.avg)}</td>
                    <td>{fmt(q.last)}</td>
                    <td className={s.neg}>{stop ? fmt(stop.stop!) : "–"}</td>
                    <td className={s.pos}>{tgt ? fmt(tgt.limit!) : "–"}</td>
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
              })}
              {!open.length && (
                <tr>
                  <td colSpan={9} className={s.none}>
                    Flat across all four markets.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {tab === "orders" && (
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
        )}

        {tab === "fills" && (
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
                .slice(0, 60)
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
        )}

        {tab === "trades" && (
          <table className={s.tbl}>
            <thead>
              <tr>
                <th>Opened</th>
                <th>Market</th>
                <th>Side</th>
                <th>Size</th>
                <th>Entry</th>
                <th>Exit</th>
                <th>Notes</th>
                <th>R</th>
                <th className={s.r}>P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {[...trades].reverse().map((t, i) => {
                const n = notes.filter((x) => x.tradeId === t.id).length;
                const live = !t.closedAt;
                const pos = positions[t.sym];
                const pnl = live && pos ? t.pnl + ((quotes[t.sym].last - pos.avg) * pos.qty * INSTRUMENTS[t.sym].pv) : t.pnl;
                return (
                  <tr key={t.id} style={{ "--k": Math.min(i, 8) } as CSSProperties} className={thread === t.id ? s.rowOn : undefined} onClick={() => {
                      setThread(t.id);
                      toggleNotes(true);
                    }}>
                    <td className={s.dimCell}>{clock(t.openedAt)}</td>
                    <td className={s.sym}>{INSTRUMENTS[t.sym].code}</td>
                    <td>
                      <span className={`${s.side} ${t.side === "LONG" ? s.sideL : s.sideS}`}>{t.side === "LONG" ? "Long" : "Short"}</span>
                    </td>
                    <td>{t.qty}</td>
                    <td>{fmt(t.entryValue / t.entryQty)}</td>
                    <td>{t.closedAt ? fmt(t.exitValue / Math.max(1, t.exitQty)) : <span className={s.liveTag}>Open</span>}</td>
                    <td className={s.dimCell}>{n ? `${n} note${n > 1 ? "s" : ""}` : "–"}</td>
                    <td className={pnl >= 0 ? s.pos : s.neg}>{t.risk ? `${pnl >= 0 ? "+" : "−"}${Math.abs(pnl / t.risk).toFixed(1)}R` : "–"}</td>
                    <td className={`${s.r} ${pnl >= 0 ? s.pos : s.neg}`}>{money(pnl)}</td>
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
        )}
      </div>
    </div>
  );
}
