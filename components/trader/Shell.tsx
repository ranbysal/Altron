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

const TABS = [
  { href: "/trader", label: "Dashboard" },
  { href: "/trader/desk", label: "Desk" },
  { href: "/community", label: "Community" },
];

/** Same shape as the public nav. Lives in the layout so the tab pill can slide between views. */
function Nav() {
  const path = usePathname() ?? "/trader";
  const clock = useMarketClock();
  const active = path.startsWith("/community") ? 2 : path.startsWith("/trader/desk") ? 1 : 0;
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
  }, [active]);

  return (
    <nav className={s.nav} aria-label="Trader">
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
        <span className={s.me} aria-label="Yazan, online">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/yazan.webp" alt="" width={38} height={38} />
          <i />
        </span>
      </div>
    </nav>
  );
}

export function TraderShell({ children }: { children: ReactNode }) {
  useEffect(() => {
    startDesk();
  }, []);
  return (
    <div className={s.root}>
      <div className={s.page}>
        <Nav />
        {children}
      </div>
      <FloatLayer />
      <Toaster />
    </div>
  );
}
