"use client";

import { useMemo, type CSSProperties } from "react";
import { fmt } from "@/lib/format";
import { INSTRUMENTS, SYMS, type Sym } from "@/lib/desk/instruments";
import { getMarket, selectSym, useDesk } from "@/lib/desk/store";
import { Odometer, Spark } from "@/components/trader/parts";
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
  // the last two hours or so, every third minute
  const path = useMemo(() => getMarket()?.closes(inst.under, 48, 3) ?? [], [q.at, inst.under]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <Spark values={path} tone={chg >= 0 ? "pos" : "neg"} height={26} width={196} className={s.wSpark} delay={420 + i * 90} />
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

/** The four markets, with the last two hours drawn in when there's room. */
export function Watchlist() {
  return (
    <div className={s.watch}>
      <div className={s.wList}>
        {SYMS.map((x, i) => (
          <Row key={x} sym={x} i={i} />
        ))}
      </div>
    </div>
  );
}
