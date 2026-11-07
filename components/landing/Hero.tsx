"use client";

import { fmt, money, signed } from "@/lib/format";
import { POSITION, positionStats } from "@/lib/feed";
import { DitherGlow } from "./DitherCanvas";
import { useFeed } from "./FeedProvider";
import { HeroRuler } from "./HeroRuler";
import { Nav } from "./Nav";
import { RollingNumber } from "./RollingNumber";
import { Sparkline } from "./Sparkline";
import s from "./landing.module.css";

export function Hero() {
  const { sim, snap } = useFeed();
  const { pnl, r } = positionStats(snap.nq);
  const up = pnl >= 0;
  const closes = sim.candles.slice(-48).map((c) => c.c);

  return (
    <header className={s.hero} id="top">
      <DitherGlow variant="horizon" className={`${s.fill} ${s.heroDome}`} />
      <Nav />

      <div className={s.heroStage}>
        <section className={`${s.instrument} rise`} aria-label="Live position (simulated)">
          <span className={s.instChip}>{POSITION.symbol} · 1M</span>
          <span className={s.instStatus}>
            <span className={`${s.dotEmber} pulse-ember`} />
            SIMULATED FEED
          </span>
          <i className={`${s.corner} ${s.cTL}`} aria-hidden="true" />
          <i className={`${s.corner} ${s.cTR}`} aria-hidden="true" />
          <i className={`${s.corner} ${s.cBL}`} aria-hidden="true" />
          <i className={`${s.corner} ${s.cBR}`} aria-hidden="true" />

          <div className={s.instTop}>
            <RollingNumber value={fmt(snap.nq)} className={s.instPrice} />
            <Sparkline values={closes} up={up} className={s.spark} />
          </div>
          <div className={s.instMeta}>
            <span>
              {POSITION.side} {POSITION.size} @ {fmt(POSITION.entry)}
            </span>
            <span className={up ? s.up : s.down}>
              {money(pnl)}
              <span className={s.instSep}>/</span>
              {signed(r, 2, "R")}
            </span>
          </div>
          <HeroRuler price={snap.nq} />
        </section>

        <div className={`${s.heroCopy} rise`} style={{ animationDelay: ".12s" }}>
          <h1 className={s.heroLine}>Proprietary futures trading, shared live.</h1>
          <div className={s.ctaRow}>
            <a className={s.ctaPrimary} href="#access">
              <span>Request access</span>
              <span className={s.ctaIcon} aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </span>
            </a>
            <a className={s.ctaText} href="#desk">
              See the desk
            </a>
          </div>
        </div>
      </div>
    </header>
  );
}
