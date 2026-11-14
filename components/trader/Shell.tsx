"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Mark } from "@/components/Mark";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { FloatLayer } from "@/components/desk/Floating";
import { Toaster } from "@/components/desk/Toaster";
import { SYMS } from "@/lib/desk/instruments";
import { arm, openPnl, selectSym, sit, startDesk, togglePanel, useDesk } from "@/lib/desk/store";
import { startFollow } from "@/lib/follow/runner";
import { startOwner } from "@/lib/owner/store";
import { useMarketClock } from "./clock";
import s from "./trader.module.css";

const TRADER_TABS = [
  { href: "/trader", label: "Dashboard" },
  { href: "/trader/desk", label: "Desk" },
  { href: "/community", label: "Community" },
];
const OWNER_TABS = [
  { href: "/owner", label: "Dashboard" },
  { href: "/owner/desk", label: "Desk" },
  { href: "/owner/follow", label: "Follow" },
  { href: "/owner/review", label: "Review" },
  { href: "/community", label: "Community" },
  { href: "/owner/admin", label: "Admin" },
];
const SIDE_KEY = "altron-side";

/** Whose pages these are. Community is shared, so it keeps the side the visitor came from. */
function useSide(path: string): "trader" | "owner" {
  const [side, setSide] = useState<"trader" | "owner">(path.startsWith("/owner") ? "owner" : "trader");
  useEffect(() => {
    let next: "trader" | "owner" = "trader";
    try {
      if (path.startsWith("/owner")) next = "owner";
      else if (path.startsWith("/community")) next = sessionStorage.getItem(SIDE_KEY) === "owner" ? "owner" : "trader";
      sessionStorage.setItem(SIDE_KEY, next);
    } catch {
      next = path.startsWith("/owner") ? "owner" : "trader";
    }
    setSide(next);
  }, [path]);
  return side;
}

/**
 * The way to the open trade from any page: the live P&L panel, already armed, so Close is
 * one more click. Only there while a trade is open.
 */
function Bolt() {
  const sym = useDesk((st) => SYMS.find((x) => st.positions[x]));
  const up = useDesk((st) => openPnl(st) >= 0);
  const shown = useDesk((st) => st.settings.panels.pnl);
  if (!sym) return null;
  return (
    <button
      type="button"
      className={s.bolt}
      data-up={up ? "" : undefined}
      aria-pressed={shown}
      aria-label="Open trade: show live P&L, armed to close"
      data-tip="Live P&L, armed"
      onClick={() => {
        const st = useDesk.getState();
        if (st.settings.sym !== sym) selectSym(sym);
        togglePanel("pnl", true);
        arm();
      }}
    >
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M9.4 1 3 9.2h4.2L6.4 15 13 6.6H8.7L9.4 1Z" fill="currentColor" />
      </svg>
    </button>
  );
}

/** Same shape as the public nav. Lives in the layout so the tab pill can slide between views. */
function Nav({ side }: { side: "trader" | "owner" }) {
  const path = usePathname() ?? "/trader";
  const clock = useMarketClock();
  const TABS = side === "owner" ? OWNER_TABS : TRADER_TABS;
  // the tab whose address is the longest match for this page
  const active = TABS.reduce((best, t, i) => (path === t.href || path.startsWith(t.href + "/") ? (best < 0 || t.href.length > TABS[best].href.length ? i : best) : best), -1);
  const refs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const el = refs.current[active];
      if (el) setPill({ x: el.offsetLeft, w: el.offsetWidth });
    };
    measure();
    window.addEventListener("resize", measure);
    document.fonts?.ready.then(measure);
    return () => window.removeEventListener("resize", measure);
  }, [active, side]);

  return (
    <nav className={s.nav} aria-label={side === "owner" ? "Owner" : "Trader"}>
      <Link href="/" className={s.brand} aria-label="Altron home">
        <Mark size={26} />
        <span className={s.brandName}>Altron</span>
      </Link>
      <div className={s.tabs} role="tablist" aria-label="Views">
        {pill && <span className={s.tabPill} style={{ transform: `translateX(${pill.x - 4}px)`, width: pill.w }} aria-hidden="true" />}
        {TABS.map((t, i) => (
          <Link
            key={t.href}
            href={t.href}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            aria-selected={i === active}
            className={s.tab}
          >
            {t.label}
          </Link>
        ))}
      </div>
      <div className={s.navRight}>
        <span className={s.clock}>NY {clock?.time ?? "--:--"}</span>
        <span className={s.navTools}>
          {(side === "owner" || path.startsWith("/trader")) && <Bolt />}
          <ThemeSwitch />
        </span>
        {side === "owner" ? (
          <form action="/auth/signout" method="post" className={s.meForm}>
            <button type="submit" className={`${s.me} ${s.meOwner}`} aria-label="Sign out" data-tip="Sign out">
              <Mark size={15} />
            </button>
          </form>
        ) : (
          <span className={s.me} aria-label="Yazan, online">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/yazan.webp" alt="" width={38} height={38} />
            <i />
          </span>
        )}
      </div>
    </nav>
  );
}

export function TraderShell({ children }: { children: ReactNode }) {
  const path = usePathname() ?? "/trader";
  const side = useSide(path);
  // each side sits at its own book; Yazan's keeps working behind the owner's
  useEffect(() => {
    startDesk();
    sit(side);
    if (side === "owner") {
      startOwner();
      startFollow();
    }
  }, [side]);
  return (
    <div className={s.root} data-trader-root="">
      <div className={s.page}>
        <Nav side={side} />
        {children}
      </div>
      <FloatLayer />
      <Toaster />
    </div>
  );
}
