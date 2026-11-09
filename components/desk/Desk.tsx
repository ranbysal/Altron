"use client";

import { useEffect } from "react";
import { Cell } from "@/components/trader/parts";
import t from "@/components/trader/trader.module.css";
import { INSTRUMENTS, SYMS, TIMEFRAMES } from "@/lib/desk/instruments";
import { ACCOUNT, cancelAll, flatten, placeOrder, resetPaper, selectSym, setPick, setSettings, showShortcuts, toggleNotes, togglePanel, useDesk } from "@/lib/desk/store";
import { Blotter } from "./Blotter";
import { Chart } from "./Chart";
import { Position } from "./Position";
import { Ticket } from "./Ticket";
import { Watchlist } from "./Watchlist";
import s from "./desk.module.css";

const KEYS: [string, string][] = [
  ["B", "Buy at market, ticket size, with bracket"],
  ["S", "Sell at market, ticket size, with bracket"],
  ["F", "Flatten the selected market"],
  ["Esc", "Close a pop-up, then cancel working entries"],
  ["1 – 4", "Switch market"],
  ["T", "Next timeframe"],
  ["M", "Markets panel"],
  ["N", "Notes (other keys pause while it's open)"],
  ["I", "Instant trade panel"],
  ["L", "Live P&L panel"],
  ["?", "These shortcuts"],
];

function Shortcuts() {
  const on = useDesk((st) => st.settings.hotkeys);
  return (
    <div className={s.keysBack} onClick={() => showShortcuts(false)}>
      <div className={s.keys} role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <header>
          <span className={s.label}>Keyboard</span>
          <button type="button" className={s.keysX} onClick={() => showShortcuts(false)} aria-label="Close">
            ×
          </button>
        </header>
        <ul>
          {KEYS.map(([k, d]) => (
            <li key={k}>
              <kbd>{k}</kbd>
              <span>{d}</span>
            </li>
          ))}
        </ul>
        <label className={s.keysToggle}>
          <button type="button" role="switch" aria-checked={on} className={s.switch} onClick={() => setSettings({ hotkeys: !on })} />
          <span>
            Trading keys {on ? "on" : "off"}
            <em>B, S, F and Esc send orders straight away, with no confirmation.</em>
          </span>
        </label>
        <div className={s.keysFoot}>
          <span>{ACCOUNT.name} · paper</span>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Reset the paper account? Positions, orders, trades and notes on this browser are cleared.")) {
                resetPaper();
                showShortcuts(false);
              }
            }}
          >
            Reset account
          </button>
        </div>
      </div>
    </div>
  );
}

export function Desk() {
  const ready = useDesk((st) => st.ready);
  const sym = useDesk((st) => st.settings.sym);
  const markets = useDesk((st) => st.settings.panels.markets);
  const blotter = useDesk((st) => st.settings.blotter);
  const shortcuts = useDesk((st) => st.shortcuts);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const st = useDesk.getState();
      if (!st.ready) return;
      const cur = st.settings.sym;
      const k = e.key;
      if (k === "?") {
        showShortcuts(!st.shortcuts);
        return;
      }
      if (k === "Escape") {
        if (st.pick) setPick(null);
        else if (st.shortcuts) showShortcuts(false);
        else if (st.notesOpen) toggleNotes(false);
        else if (st.settings.hotkeys) cancelAll(cur);
        return;
      }
      const lower = k.toLowerCase();
      // with Notes open, a stray letter is far more likely to be a note than an order
      if (st.notesOpen && lower !== "n") {
        if (k.length === 1) e.preventDefault();
        return;
      }
      if (lower === "i") return togglePanel("instant");
      if (lower === "l") return togglePanel("pnl");
      if (lower === "m") return togglePanel("markets");
      if (lower === "n") {
        e.preventDefault();
        return toggleNotes();
      }
      if (lower === "t") {
        const i = TIMEFRAMES.findIndex((x) => x.id === st.settings.tf);
        return setSettings({ tf: TIMEFRAMES[(i + 1) % TIMEFRAMES.length].id });
      }
      if (["1", "2", "3", "4"].includes(k)) return selectSym(SYMS[+k - 1]);
      if (!st.settings.hotkeys) return;
      if (lower === "b" || lower === "s") {
        e.preventDefault();
        placeOrder({ sym: cur, side: lower === "b" ? 1 : -1, qty: st.settings.qty[cur], type: "MKT", bracket: true });
      }
      if (lower === "f") flatten(cur);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={s.desk} data-mk={markets ? "on" : "off"} data-blot={blotter ? "open" : "shut"}>
      <i className={t.sheetR} aria-hidden="true" />
      <i className={t.sheetB} aria-hidden="true" />
      <Cell i={0} noTop className={s.aMarkets} label="Markets" aside="CME Globex" bodyClass={s.body}>
        <div className={s.mkIn} inert={!markets}>
          {ready && <Watchlist />}
        </div>
      </Cell>
      <Cell i={1} noTop className={s.aChart} bodyClass={s.bodyFlush}>
        {ready && <Chart />}
      </Cell>
      <Cell i={2} noTop className={s.aTicket} label="Order" aside={INSTRUMENTS[sym].code} bodyClass={s.body}>
        {ready && <Ticket />}
      </Cell>
      <Cell i={3} className={s.aPos} label="Position" aside={INSTRUMENTS[sym].code} bodyClass={s.body}>
        {ready && <Position />}
      </Cell>
      <Cell i={4} className={s.aBlotter} bodyClass={s.bodyFlush}>
        {ready && <Blotter />}
      </Cell>
      {shortcuts && <Shortcuts />}
    </div>
  );
}
