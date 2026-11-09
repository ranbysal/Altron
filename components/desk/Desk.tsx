"use client";

import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";
import { Cell } from "@/components/trader/parts";
import t from "@/components/trader/trader.module.css";
import { INSTRUMENTS, SYMS, TIMEFRAMES } from "@/lib/desk/instruments";
import { ACCOUNT, cancelAll, flatten, placeOrder, resetPaper, selectSym, setPick, setSettings, showShortcuts, toggleBlotter, toggleFull, toggleNotes, togglePanel, useDesk } from "@/lib/desk/store";
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
  ["Esc", "Close a pop-up, leave full screen, then cancel working entries"],
  ["1 – 4", "Switch market"],
  ["T", "Next timeframe"],
  ["M", "Markets panel"],
  ["N", "Notes (other keys pause while it's open)"],
  ["L", "Live P&L panel"],
  ["Shift F", "Full screen chart (Esc to leave)"],
  ["Del", "Remove the selected drawing"],
  ["Shift", "Hold and drag on the chart to measure"],
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

const COL = { min: 280, def: 300, max: 360 }; // the right column moves only a little

export function Desk() {
  const ready = useDesk((st) => st.ready);
  const sym = useDesk((st) => st.settings.sym);
  const markets = useDesk((st) => st.settings.panels.markets);
  const blotter = useDesk((st) => st.settings.blotter);
  const layout = useDesk((st) => st.settings.layout);
  const counts = useDesk(useShallow((st) => [Object.keys(st.positions).length, st.orders.length]));
  const shortcuts = useDesk((st) => st.shortcuts);
  const full = useDesk((st) => st.full);
  const deskRef = useRef<HTMLDivElement>(null);
  const centerRef = useRef<HTMLDivElement>(null);
  const grab = useRef<null | { kind: "blot" | "col"; start: number; from: number; now: number }>(null);

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
        else if (st.full) toggleFull(false);
        else if (st.settings.hotkeys) cancelAll(cur);
        return;
      }
      // Shift F is full screen, as on TradingView; it must never reach the flatten key
      if (k === "F" && e.shiftKey) {
        if (!st.notesOpen) toggleFull();
        return;
      }
      const lower = k.toLowerCase();
      // with Notes open, a stray letter is far more likely to be a note than an order
      if (st.notesOpen && lower !== "n") {
        if (k.length === 1) e.preventDefault();
        return;
      }
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
      if (lower === "f" && !e.shiftKey) flatten(cur);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // full screen: the page's nav steps aside too. Set before paint, so the transition
  // starts on its own timing in the very same frame as the change.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (full) root.dataset.deskFull = "on";
    else delete root.dataset.deskFull;
    // the transition runs on its own quick timing, then hands back to the usual one
    const desk = deskRef.current;
    desk?.setAttribute("data-fx", "");
    const id = window.setTimeout(() => desk?.removeAttribute("data-fx"), 520);
    return () => window.clearTimeout(id);
  }, [full]);
  useEffect(
    () => () => {
      delete document.documentElement.dataset.deskFull;
      toggleFull(false);
    },
    [],
  );

  /** The tallest the blotter gets: up to the chart's toolbar and range bar, never over them. */
  const blotMax = () => {
    const center = centerRef.current;
    if (!center) return 600;
    const chart = center.querySelector<HTMLElement>("[data-chart]");
    const body = center.querySelector<HTMLElement>("[data-chart-body]");
    const chrome = chart && body ? chart.offsetHeight - body.offsetHeight : 77;
    return Math.max(0, center.clientHeight - chrome);
  };

  /* ---------- resizing: CSS variables while dragging, settings once dropped ---------- */
  const startGrab = (kind: "blot" | "col") => (e: React.PointerEvent) => {
    const desk = deskRef.current;
    if (!desk) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const st = useDesk.getState().settings;
    const from = kind === "blot" ? (st.blotter ? Math.min(st.layout.blot, blotMax()) : 0) : st.layout.right;
    grab.current = { kind, start: kind === "blot" ? e.clientY : e.clientX, from, now: from };
    desk.classList.add(s.resizing);
  };
  const moveGrab = (e: React.PointerEvent) => {
    const g = grab.current;
    const desk = deskRef.current;
    if (!g || !desk) return;
    if (g.kind === "blot") {
      g.now = Math.max(0, Math.min(blotMax(), g.from + (g.start - e.clientY)));
      desk.style.setProperty("--bl", `${g.now}px`);
    } else {
      g.now = Math.max(COL.min, Math.min(COL.max, g.from + (g.start - e.clientX)));
      desk.style.setProperty("--rw", `${g.now}px`);
    }
  };
  const endGrab = () => {
    const g = grab.current;
    const desk = deskRef.current;
    grab.current = null;
    if (!g || !desk) return;
    desk.classList.remove(s.resizing);
    const st = useDesk.getState().settings;
    if (g.kind === "blot") {
      const top = blotMax();
      if (g.now < 56) {
        // dropped near the bottom: put it away, keep the last useful height
        setSettings({ blotter: false });
        desk.style.removeProperty("--bl");
      } else {
        const blot = g.now > top - 40 ? 10000 : Math.round(g.now);
        setSettings({ blotter: true, layout: { ...st.layout, blot } });
        desk.style.removeProperty("--bl");
      }
    } else {
      setSettings({ layout: { ...st.layout, right: Math.round(g.now) } });
      desk.style.removeProperty("--rw");
    }
  };

  const style = {
    "--rw-set": `${Math.max(COL.min, Math.min(COL.max, layout.right))}px`,
    "--bl-set": blotter ? `${layout.blot}px` : "0px",
  } as CSSProperties;

  return (
    <div ref={deskRef} className={s.desk} data-mk={markets ? "on" : "off"} data-blot={blotter ? "open" : "shut"} data-full={full ? "on" : "off"} style={style}>
      <i className={t.sheetR} aria-hidden="true" />
      <i className={t.sheetB} aria-hidden="true" />
      <Cell i={0} noTop className={s.aMarkets} label="Markets" aside="CME Globex" bodyClass={s.body}>
        <div className={s.mkIn} inert={!markets}>
          {ready && <Watchlist />}
        </div>
      </Cell>
      <div ref={centerRef} className={s.center}>
        <Cell i={1} noTop className={s.aChart} bodyClass={s.bodyFlush}>
          {ready && <Chart />}
        </Cell>
        <div
          className={s.blotGrip}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Drag to resize the blotter"
          onPointerDown={startGrab("blot")}
          onPointerMove={moveGrab}
          onPointerUp={endGrab}
          onPointerCancel={endGrab}
          onDoubleClick={() => setSettings({ blotter: true, layout: { ...layout, blot: 158 } })}
        />
        <Cell i={4} className={s.aBlotter} bodyClass={s.bodyFlush}>
          <div className={s.sideIn} inert={full}>
            {ready && <Blotter />}
          </div>
        </Cell>
        {!blotter && ready && (
          <button type="button" className={s.blotOpen} onClick={() => toggleBlotter(true)}>
            <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2.5 7.5 6 4l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Positions <em>{counts[0]}</em> Orders <em>{counts[1]}</em>
          </button>
        )}
      </div>
      <Cell i={2} noTop className={s.aTicket} label="Order" aside={INSTRUMENTS[sym].code} bodyClass={s.body}>
        <div className={s.sideIn} inert={full}>
          {ready && <Ticket />}
        </div>
      </Cell>
      <Cell i={3} className={s.aPos} label="Position" aside={INSTRUMENTS[sym].code} bodyClass={s.body}>
        <div className={s.sideIn} inert={full}>
          {ready && <Position />}
        </div>
      </Cell>
      <div
        className={s.colGrip}
        role="separator"
        aria-orientation="vertical"
        aria-label="Drag to widen the order column a little"
        onPointerDown={startGrab("col")}
        onPointerMove={moveGrab}
        onPointerUp={endGrab}
        onPointerCancel={endGrab}
        onDoubleClick={() => setSettings({ layout: { ...layout, right: COL.def } })}
      />
      {shortcuts && <Shortcuts />}
    </div>
  );
}
