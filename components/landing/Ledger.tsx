import { LEDGER, LEDGER_SUMMARY, equityPaths } from "@/lib/ledger";
import s from "./landing.module.css";

export function Ledger() {
  const eq = equityPaths();
  const k = LEDGER_SUMMARY;
  const chron = [...LEDGER].reverse();

  return (
    <section id="ledger" className={s.ledger}>
      <div className={`${s.container} ${s.stack48}`}>
        <h2 className={s.h2}>
          Every trade stays <em>on the books.</em>
        </h2>

        <div className={s.ledgerBox}>
          <div className={s.ledgerTop}>
            <span>PERFORMANCE · LAST {k.trades} TRADES</span>
            <span>DEMO DATA</span>
          </div>

          <div className={s.kpis}>
            <div className={s.kpi}>
              <span className={s.kpiLabel}>NET</span>
              <span className={`${s.kpiValue} ${s.up}`}>{k.netR}</span>
              <span className={s.kpiSub}>{k.netUsd}</span>
            </div>
            <div className={s.kpi}>
              <span className={s.kpiLabel}>WIN RATE</span>
              <span className={s.kpiValue}>{k.winRate}</span>
              <span className={s.kpiSub}>
                <span className={s.seq} aria-label={`${k.wins} wins, ${k.losses} losses, oldest to newest`}>
                  {chron.map((r, i) => (
                    <i key={i} style={{ background: r.win ? "var(--blue)" : "var(--ember)" }} />
                  ))}
                </span>
                {k.wins}W · {k.losses}L
              </span>
            </div>
            <div className={s.kpi}>
              <span className={s.kpiLabel}>PROFIT FACTOR</span>
              <span className={s.kpiValue}>{k.profitFactor}</span>
              <span className={s.kpiSub}>
                <span className={s.ratio} aria-hidden="true">
                  <i style={{ width: `${k.winShare}%` }} />
                </span>
                {k.grossWin} / {k.grossLoss}
              </span>
            </div>
            <div className={s.kpi}>
              <span className={s.kpiLabel}>AVG TRADE</span>
              <span className={s.kpiValue}>{k.avgR}</span>
              <span className={s.kpiSub}>
                Win {k.avgWin} · Loss {k.avgLoss}
              </span>
            </div>
          </div>

          <div className={s.equity}>
            <svg
              viewBox="0 0 1200 180"
              preserveAspectRatio="none"
              role="img"
              aria-label={`Cumulative R across the ${k.trades} sample trades, ending at ${k.netR}`}
            >
              <defs>
                <linearGradient id="altEq" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="var(--blue)" stopOpacity="0.26" />
                  <stop offset="1" stopColor="var(--blue)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <g stroke="var(--line)">
                <line x1="0" y1="45" x2="1200" y2="45" />
                <line x1="0" y1="90" x2="1200" y2="90" />
                <line x1="0" y1="135" x2="1200" y2="135" />
              </g>
              <path d={eq.area} fill="url(#altEq)" />
              <path d={eq.line} fill="none" stroke="var(--blue)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>

          <div className={s.scrollX}>
            <div className={s.table} role="table" aria-label="Sample ledger">
              <div className={s.ledgerHead} role="row">
                {["DATE", "MARKET", "SIDE", "SIZE", "ENTRY", "EXIT", "R"].map((h) => (
                  <span key={h} role="columnheader">
                    {h}
                  </span>
                ))}
                <span role="columnheader" className={s.right}>
                  P&amp;L
                </span>
              </div>
              {LEDGER.map((r, i) => (
                <div key={i} className={s.ledgerRow} role="row">
                  <span role="cell" style={{ color: "var(--muted)" }}>
                    {r.date}
                  </span>
                  <span role="cell" className={s.mono} style={{ fontSize: 13 }}>
                    {r.mkt}
                  </span>
                  <span role="cell">
                    <span className={`${s.miniPill} ${r.side === "LONG" ? s.long : s.short}`}>{r.side}</span>
                  </span>
                  <span role="cell">{r.size}</span>
                  <span role="cell">{r.entry}</span>
                  <span role="cell">{r.exit}</span>
                  <span role="cell" className={`${s.mono} ${r.win ? s.up : s.down}`} style={{ fontSize: 13 }}>
                    {r.r}
                  </span>
                  <span role="cell" className={`${s.right} ${r.win ? s.up : s.down}`}>
                    {r.pnl}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
