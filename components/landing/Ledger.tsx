import { LEDGER, LEDGER_STATS, equityPaths } from "@/lib/ledger";
import { SectionLabel } from "./SectionLabel";
import s from "./landing.module.css";

export function Ledger() {
  const eq = equityPaths();
  return (
    <section id="ledger" className={s.ledger}>
      <div className={`${s.container} ${s.stack48}`}>
        <SectionLabel>04 — THE LEDGER</SectionLabel>
        <div className={s.splitHead}>
          <h2 className={s.h2}>
            Losses stay <em>on the record.</em>
          </h2>
          <p className={s.lede}>
            Members see every closed trade with the numbers that matter: size, entry, exit, R and P&amp;L. The sample
            below is demonstration data.
          </p>
        </div>

        <div className={s.statGrid}>
          {LEDGER_STATS.map((st) => (
            <div key={st.label} className={s.statCard}>
              <span>{st.label}</span>
              <span className={`${s.statValue} ${st.accent ? s.blue : ""}`}>{st.value}</span>
              <svg className={s.statArrow} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7C8692" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M7 17L17 7M9 7h8v8" />
              </svg>
            </div>
          ))}
        </div>

        <div className={s.ledgerBox}>
          <div className={s.ledgerTop}>
            <span>CUMULATIVE R · LAST {LEDGER.length} TRADES</span>
            <span>DEMO DATA</span>
          </div>
          <div className={s.equity}>
            <svg viewBox="0 0 1200 180" preserveAspectRatio="none" role="img" aria-label={`Cumulative R across the ${LEDGER.length} sample trades, ending at ${LEDGER_STATS[3].value}`}>
              <defs>
                <linearGradient id="altEq" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#4DA3FF" stopOpacity="0.28" />
                  <stop offset="1" stopColor="#4DA3FF" stopOpacity="0" />
                </linearGradient>
              </defs>
              <g stroke="rgba(255,255,255,0.05)">
                <line x1="0" y1="45" x2="1200" y2="45" />
                <line x1="0" y1="90" x2="1200" y2="90" />
                <line x1="0" y1="135" x2="1200" y2="135" />
              </g>
              <path d={eq.area} fill="url(#altEq)" />
              <path d={eq.line} fill="none" stroke="#4DA3FF" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
          <div className={s.scrollX}>
            <div className={s.table} role="table" aria-label="Sample ledger">
              <div className={s.ledgerHead} role="row">
                {["DATE", "MARKET", "SIDE", "SIZE", "ENTRY", "EXIT", "R"].map((h) => (
                  <span key={h} role="columnheader">{h}</span>
                ))}
                <span role="columnheader" className={s.right}>P&amp;L</span>
              </div>
              {LEDGER.map((r, i) => (
                <div key={i} className={s.ledgerRow} role="row">
                  <span role="cell" style={{ color: "var(--muted)" }}>{r.date}</span>
                  <span role="cell" className={s.mono} style={{ fontSize: 13 }}>{r.mkt}</span>
                  <span role="cell">
                    <span className={`${s.miniPill} ${r.side === "LONG" ? s.long : s.short}`}>{r.side}</span>
                  </span>
                  <span role="cell">{r.size}</span>
                  <span role="cell">{r.entry}</span>
                  <span role="cell">{r.exit}</span>
                  <span role="cell" className={`${s.mono} ${r.win ? s.blue : s.ember}`} style={{ fontSize: 13 }}>{r.r}</span>
                  <span role="cell" className={`${s.right} ${r.win ? s.blue : s.ember}`}>{r.pnl}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
