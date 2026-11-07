"use client";

import { fmt, money, signed } from "@/lib/format";
import { POSITION, positionStats } from "@/lib/feed";
import { DitherGlow } from "./DitherCanvas";
import { useFeed } from "./FeedProvider";
import { Nav } from "./Nav";
import { PositionTrack } from "./PositionTrack";
import s from "./landing.module.css";

export function Hero() {
  const { snap } = useFeed();
  const { pnl, r, pct, entryPct } = positionStats(snap.nq);
  const up = pnl >= 0;

  return (
    <header className={s.hero} id="top">
      <DitherGlow variant="horizon" className={s.fill} />
      <div aria-hidden="true" className={s.heroFade} />
      <Nav />

      <div className={s.heroCenter}>
        <div className={`${s.heroCard} rise`}>
          <div className={s.heroCardTop}>
            <span>
              {POSITION.symbol} · 1M · SIMULATED
            </span>
            <span className={s.heroLive}>
              <span className={`${s.dotEmber} pulse-ember`} />
              LIVE
            </span>
          </div>
          <div className={s.heroPrice}>{fmt(snap.nq)}</div>
          <div className={s.heroCardRow}>
            <span>
              {POSITION.side} {POSITION.size} @ {fmt(POSITION.entry)}
            </span>
            <span className={up ? s.up : s.down}>
              <strong>{money(pnl)}</strong> · {signed(r, 2, "R")}
            </span>
          </div>
          <PositionTrack pct={pct} entryPct={entryPct} />
        </div>

        <div className={`${s.ctaRow} rise`} style={{ animationDelay: ".12s" }}>
          <a className={`${s.btnSolid} ${s.btnLg}`} href="#access">
            Request access <span aria-hidden="true">→</span>
          </a>
          <a className={`${s.btnGhost} ${s.btnLg}`} href="#desk">
            See the desk
          </a>
        </div>
      </div>
    </header>
  );
}
