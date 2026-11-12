"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Mark } from "@/components/Mark";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { FloatLayer } from "@/components/desk/Floating";
import { Toaster } from "@/components/desk/Toaster";
import { startDesk } from "@/lib/desk/store";
import { useMarketClock } from "./clock";
import s from "./trader.module.css";

const TRADER_TABS = [
  { href: "/trader", label: "Dashboard" },
  { href: "/trader/desk", label: "Desk" },
  { href: "/community", label: "Community" },
];
const OWNER_TABS = [
  { href: "/owner", label: "Dashboard" },
  { href: "/owner/follow", label: "Follow" },
  { href: "/community", label: "Community" },
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

/** Same shape as the public nav. Lives in the layout so the tab pill can slide between views. */
function Nav() {
  const path = usePathname() ?? "/trader";
  const clock = useMarketClock();
  const side = useSide(path);
  const TABS = side === "owner" ? OWNER_TABS : TRADER_TABS;
  const active = path.startsWith("/community") ? 2 : path.startsWith("/trader/desk") || path.startsWith("/owner/follow") ? 1 : 0;
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
        <ThemeSwitch />
        {side === "owner" ? (
          <span className={`${s.me} ${s.meOwner}`} aria-label="Owner">
            <Mark size={15} />
          </span>
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
  useEffect(() => {
    startDesk();
  }, []);
  return (
    <div className={s.root} data-trader-root="">
      <div className={s.page}>
        <Nav />
        {children}
      </div>
      <FloatLayer />
      <Toaster />
    </div>
  );
}
