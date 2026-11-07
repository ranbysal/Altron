"use client";

import { fmt, money, signed } from "@/lib/format";
import { POSITION, SETTLE, positionStats } from "@/lib/feed";
import { CandleChart } from "./CandleChart";
import { useFeed } from "./FeedProvider";
import { useQuotes } from "./MarketStrip";
import { PositionTrack } from "./PositionTrack";
import s from "./landing.module.css";

const TAPE = [
  { time: "10:21:40", kind: "NOTE", color: "var(--text)", text: "Watching NQZ6 for a reclaim of the overnight high" },
  { time: "10:33:07", kind: "FILLED", color: "var(--blue)", text: "BUY 2 NQZ6 @ 24,476.50" },
  { time: "10:33:07", kind: "BRACKET", color: "var(--muted)", text: "SL 24,452.00 · TP 24,525.00 · risk $980.00" },
  { time: "10:33:08", kind: "ALERT", color: "var(--ember-soft)", text: "Sent to members on Discord and WhatsApp" },
  { time: "10:34:52", kind: "NOTE", color: "var(--text)", text: "Invalidation updated: below 10:15 higher low" },
];

function Icon({ d, children }: { d?: string; children?: React.ReactNode }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d ? <path d={d} /> : children}
    </svg>
  );
}

export function Desk() {
  const { sim, snap } = useFeed();
  const quotes = useQuotes();
  const { pnl, r, pct, entryPct, risk } = positionStats(snap.nq);
  const diff = snap.nq - SETTLE.NQ;
  const up = pnl >= 0;

  return (
    <section id="desk" className={s.desk}>
      <div className={`${s.container} ${s.stack56}`}>
        <div className={s.splitHead}>
          <h2 className={s.h2}>
            See the trade <em>as it happens.</em>
          </h2>
          <p className={s.lede}>
            Follow every position in real time, with live P&amp;L, entry levels, stops, and targets directly on the chart.
          </p>
        </div>
      </div>

      <div className={`${s.wide} ${s.deskWide}`}>
        <div className={s.window}>
          <div className={s.titlebar}>
            <div className={s.lights} aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <span style={{ fontSize: 12, letterSpacing: "0.06em" }}>altron / desk</span>
            <span aria-hidden="true" />
          </div>
          <div className={s.windowBody}>
            <div className={`${s.rail} ${s.hideSm}`}>
              <button type="button" aria-label="Chart" className={`${s.railBtn} ${s.railBtnActive}`}>
                <Icon>
                  <path d="M7 4v16M17 4v16" />
                  <rect x="4.5" y="8" width="5" height="7" rx="1" />
                  <rect x="14.5" y="6" width="5" height="9" rx="1" />
                </Icon>
              </button>
              <button type="button" aria-label="Ledger" className={s.railBtn}>
                <Icon d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
              </button>
              <button type="button" aria-label="Notes" className={s.railBtn}>
                <Icon d="M5 4h10l4 4v12H5zM9 12h6M9 16h4" />
              </button>
              <button type="button" aria-label="Alerts" className={s.railBtn}>
                <Icon d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0" />
              </button>
              <span className={s.railSep} />
              <button type="button" aria-label="Settings" className={s.railBtn}>
                <Icon>
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
                </Icon>
              </button>
            </div>

            <div className={s.deskMain}>
              <div className={s.toolbar}>
                <div className={s.toolbarLeft}>
                  <div role="group" aria-label="View" className={s.segment}>
                    <button type="button" aria-pressed="true" className={`${s.segBtn} ${s.segBtnOn}`}>
                      Live
                    </button>
                    <button type="button" aria-pressed="false" className={s.segBtn}>
                      History
                    </button>
                  </div>
                  <div className={`${s.tabs} ${s.hideSm}`}>
                    <span className={s.on}>Chart</span>
                    <span>Ledger</span>
                    <span>Notes</span>
                    <span>Alerts</span>
                  </div>
                </div>
                <div className={s.toolbarRight}>
                  <span className={s.who}>
                    <span className={s.avatarWrap}>
                      <span className={s.avatar}>Y</span>
                      <span className={s.presence} role="img" aria-label="Active now" />
                    </span>
                    Yazan · GP
                  </span>
                </div>
              </div>

              <div className={s.chips}>
                {quotes.map((q, i) => (
                  <div key={q.sym} className={`${s.chip} ${i === 0 ? s.chipOn : ""}`}>
                    <span className={s.chipIcon}>{q.sym}</span>
                    <span className={s.chipText}>
                      <span>{q.sym}Z6</span>
                      <span>{q.price}</span>
                    </span>
                  </div>
                ))}
              </div>

              <div className={s.deskGrid}>
                <div className={s.chartPanel}>
                  <div className={s.chartHead}>
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <span className={s.symBadge}>NQ</span>
                      <span className={s.bigPrice}>{fmt(snap.nq)}</span>
                    </div>
                    <div className={s.stats}>
                      <div className={s.stat}>
                        <span>Change</span>
                        <span className={diff >= 0 ? s.up : s.down}>
                          {(diff >= 0 ? "+" : "−") + fmt(Math.abs(diff))} ({quotes[0].chg})
                        </span>
                      </div>
                      <div className={s.stat}>
                        <span>Session high / low</span>
                        <span>
                          {fmt(snap.high)} / {fmt(snap.low)}
                        </span>
                      </div>
                      <div className={`${s.stat} ${s.hideSm}`}>
                        <span>Interval</span>
                        <span>1 min</span>
                      </div>
                    </div>
                  </div>
                  <CandleChart sim={sim} className={s.chartCanvas} />
                </div>

                <div className={s.side}>
                  <div className={`${s.card} ${s.cardGlass}`}>
                    <div className={s.cardHead}>
                      <span>OPEN POSITION</span>
                      <span className={`${s.sidePill} ${s.long}`}>{POSITION.side}</span>
                    </div>
                    <div className={s.posTitle}>
                      {POSITION.size} × {POSITION.symbol}
                    </div>
                    <div className={s.tiles}>
                      <div className={s.tile}>
                        <div>Entry</div>
                        <div>{fmt(POSITION.entry)}</div>
                      </div>
                      <div className={s.tile}>
                        <div>Risk</div>
                        <div>${fmt(risk)} · 1R</div>
                      </div>
                      <div className={s.tile}>
                        <div>Stop</div>
                        <div className={s.down}>{fmt(POSITION.stop)}</div>
                      </div>
                      <div className={s.tile}>
                        <div>Target</div>
                        <div className={s.up}>{fmt(POSITION.target)}</div>
                      </div>
                    </div>
                    <div className={s.pnlRow}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ fontSize: 12, color: "var(--dim)" }}>Unrealized P&amp;L</span>
                        <span className={`${s.pnl} ${up ? s.up : s.down}`}>{money(pnl)}</span>
                      </div>
                      <span className={`${s.rMult} ${up ? s.up : s.down}`}>{signed(r, 2, "R")}</span>
                    </div>
                    <PositionTrack pct={pct} entryPct={entryPct} />
                  </div>

                  <div className={s.card}>
                    <div className={s.cardHead}>
                      <span>DESK NOTE · 10:21 ET</span>
                      <span>BEFORE ENTRY</span>
                    </div>
                    <p className={s.note}>
                      “Watching for a reclaim of the overnight high on volume. Stop goes under the 10:15 higher low. If
                      that breaks, the idea is wrong. First target is yesterday’s value-area high.”
                    </p>
                    <div className={s.noteBy}>
                      <span className={`${s.avatar} ${s.avatarSm}`}>Y</span>Yazan
                    </div>
                  </div>
                </div>
              </div>

              <div className={s.tape}>
                <div className={s.tapeHead}>
                  <span>TAPE</span>
                  <span>TODAY · NOV 06</span>
                </div>
                <div className={s.scrollX}>
                  {TAPE.map((e, i) => (
                    <div key={i} className={s.tapeRow}>
                      <span style={{ color: "var(--dim)" }}>[{e.time}]</span>
                      <span className={s.tapeKind} style={{ color: e.color }}>
                        <i style={{ background: e.color }} />
                        {e.kind}
                      </span>
                      <span style={{ color: "var(--soft)" }}>{e.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
