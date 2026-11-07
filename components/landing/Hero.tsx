"use client";

import Link from "next/link";
import { Mark } from "@/components/Mark";
import { fmt, money } from "@/lib/format";
import { POSITION, positionStats } from "@/lib/feed";
import { TerrainCanvas } from "./TerrainCanvas";
import { useFeed, useNyClock } from "./FeedProvider";
import s from "./landing.module.css";

export function Hero() {
  const { snap } = useFeed();
  const clock = useNyClock();
  const { pnl } = positionStats(snap.nq);

  return (
    <header className={s.hero} id="top">
      <TerrainCanvas className={s.fill} />
      <div aria-hidden="true" className={s.heroShadeTop} />
      <div aria-hidden="true" className={s.heroShadeCorner} />

      <div aria-hidden="true" className={`${s.crossV} ${s.hideSm}`} />
      <div aria-hidden="true" className={`${s.crossH} ${s.hideSm}`} />
      <div aria-hidden="true" className={`${s.reticle} ${s.hideSm}`}>
        <div className={`${s.ring} spin-slow`} />
        <div className={s.core} />
        <div className={s.lineH} />
        <div className={s.lineV} />
        <div className={s.pip} />
      </div>

      <div className={`${s.readout} ${s.hideSm}`}>
        <div className={s.row}>
          <span>{POSITION.symbol} · 1M</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--ember-soft)" }}>
            <span className={`${s.dotEmber} pulse-ember`} />
            LIVE
          </span>
        </div>
        <div className={s.price}>{fmt(snap.nq)}</div>
        <div className={s.row}>
          <span>
            LONG {POSITION.size} @ {fmt(POSITION.entry)}
          </span>
          <span className={pnl >= 0 ? s.blue : s.ember}>{money(pnl)}</span>
        </div>
      </div>

      <div className={`${s.tag} ${s.hideSm}`} style={{ left: "55%", top: "24%" }}>
        <span className={s.tagSq} style={{ background: "var(--blue)" }} />
        ENTRY LOGGED
      </div>
      <div className={`${s.tag} ${s.hideSm}`} style={{ left: "87%", top: "61%" }}>
        <span className={s.tagSq} style={{ border: "1px solid var(--text)" }} />
        NOTE ADDED
      </div>
      <div className={`${s.tag} ${s.hideSm}`} style={{ left: "47%", top: "52%", color: "var(--ember-soft)" }}>
        <span className={s.tagSq} style={{ background: "var(--ember)" }} />
        STOP {fmt(POSITION.stop)}
      </div>

      <div aria-hidden="true" className={s.frame}>
        <div className={s.frameInner}>
          <div className={s.frameRule} />
          <div className={s.node} style={{ left: -4 }} />
          <div className={s.node} style={{ right: -4 }} />
        </div>
      </div>

      <nav aria-label="Primary" className={`${s.container} ${s.nav}`}>
        <Link href="/" className={s.brand} aria-label="Altron home">
          <Mark size={30} />
          <span className={s.brandName}>Altron</span>
        </Link>
        <div className={`${s.navLinks} ${s.hideSm}`}>
          <a className={s.link} href="#desk">Desk</a>
          <a className={s.link} href="#method">Method</a>
          <a className={s.link} href="#ledger">Ledger</a>
        </div>
        <div className={s.navRight}>
          <Link className={`${s.link} ${s.hideSm}`} href="/login">
            Sign in
          </Link>
          <a className={`${s.btnLight} ${s.navCta}`} href="#access">
            Request access
          </a>
        </div>
      </nav>

      <div className={`${s.container} ${s.heroCopy}`}>
        <div className={`${s.kicker} rise`}>[ PRIVATE FUTURES DESK · ES · NQ · MES · MNQ ]</div>
        <h1 className={`${s.h1} rise`} style={{ animationDelay: ".08s" }}>
          Every trade,
          <br />
          <em>in plain sight.</em>
        </h1>
        <div className={`${s.heroRow} rise`} style={{ animationDelay: ".16s" }}>
          <div className={s.heroLeft}>
            <p className={s.heroP}>
              Altron is a private futures desk that trades in the open. Members watch our quant’s positions the moment
              he takes them — entry, size, stop, target, and the reasoning behind each one.
            </p>
            <div className={s.ctaRow}>
              <a className={`${s.btnLight} ${s.btnLg}`} href="#access">
                Request access <span aria-hidden="true">→</span>
              </a>
              <a className={`${s.btnGhost} ${s.btnLg}`} href="#desk">
                See the desk
              </a>
            </div>
          </div>
          <div className={s.heroMeta}>
            <span>
              NEW YORK · <strong>{clock}</strong> ET
            </span>
            <span>INVITE ONLY · FREE FOR MEMBERS</span>
          </div>
        </div>
      </div>
    </header>
  );
}
