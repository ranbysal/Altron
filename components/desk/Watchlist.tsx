"use client";

import type { CSSProperties } from "react";
import { fmt, money } from "@/lib/format";
import { INSTRUMENTS, SYMS, type Sym } from "@/lib/desk/instruments";
import { ACCOUNT, dayStart, openPnl, realizedSince, resetPaper, selectSym, useDesk } from "@/lib/desk/store";
import { Odometer } from "@/components/trader/parts";
import s from "./desk.module.css";

function Row({ sym, i }: { sym: Sym; i: number }) {
  const q = useDesk((st) => st.quotes[sym]);
  const selected = useDesk((st) => st.settings.sym === sym);
  const pos = useDesk((st) => st.positions[sym]);
  const inst = INSTRUMENTS[sym];
  const chg = q.last - q.prev;
  const pct = q.prev ? (chg / q.prev) * 100 : 0;
  const range = q.hi - q.lo || 1;
  const at = Math.max(0, Math.min(1, (q.last - q.lo) / range));

  return (
    <button type="button" className={`${s.wRow} ${selected ? s.wOn : ""}`} onClick={() => selectSym(sym)} style={{ "--k": i } as CSSProperties} aria-pressed={selected}>
      <span className={s.wTop}>
        <span className={s.wSym}>
          {inst.code}
          {pos && <i className={pos.qty > 0 ? s.wLong : s.wShort} title={pos.qty > 0 ? "Long" : "Short"} />}
        </span>
        <span className={s.wPx}>
          <i key={q.at} className={`${s.wFlash} ${q.dir > 0 ? s.tickUp : q.dir < 0 ? s.tickDn : ""}`} aria-hidden="true" />
          <Odometer value={q.last ? fmt(q.last) : "0.00"} delay={120 + i * 60} />
        </span>
      </span>
      <span className={s.wSub}>
        <span>{inst.name}</span>
        <span className={chg >= 0 ? s.pos : s.neg}>
          {chg >= 0 ? "+" : "−"}
          {Math.abs(pct).toFixed(2)}%
        </span>
      </span>
      <span className={s.wRange} aria-hidden="true">
        <i style={{ left: `${at * 100}%` }} />
      </span>
      {selected && (
        <span className={s.wRangeLbl} aria-hidden="true">
          <span>{fmt(q.lo)}</span>
          <span>
            ${(inst.tick * inst.pv).toFixed(2)} / tick
          </span>
          <span>{fmt(q.hi)}</span>
        </span>
      )}
    </button>
  );
}

/** Markets on the left, the account underneath. */
export function Watchlist() {
  const positions = useDesk((st) => st.positions);
  const quotes = useDesk((st) => st.quotes);
  const trades = useDesk((st) => st.trades);
  const open = openPnl({ positions, quotes });
  const realized = trades.reduce((a, t) => a + t.pnl, 0);
  const day = realizedSince(trades, dayStart()) + open;
  const balance = ACCOUNT.start + realized;

  return (
    <div className={s.watch}>
      <div className={s.wList}>
        {SYMS.map((x, i) => (
          <Row key={x} sym={x} i={i} />
        ))}
      </div>
      <div className={s.acct}>
        <div className={s.acctHead}>
          <span className={s.label}>
            {ACCOUNT.name}
            <i className={s.okDot} />
          </span>
          <button
            type="button"
            className={s.reset}
            onClick={() => {
              if (window.confirm("Reset the paper account? Positions, orders, trades and notes on this browser are cleared.")) resetPaper();
            }}
          >
            Reset
          </button>
        </div>
        <dl className={s.acctStats}>
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
            <dd className={open >= 0 ? s.pos : s.neg}>{money(open)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
