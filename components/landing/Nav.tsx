import Link from "next/link";
import { Mark } from "@/components/Mark";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import s from "./landing.module.css";

export function Nav() {
  return (
    <nav aria-label="Primary" className={`${s.wide} ${s.nav}`}>
      <Link href="/" className={s.brand} aria-label="Altron home">
        <Mark size={26} />
        <span className={s.brandName}>Altron</span>
      </Link>
      <div className={s.navRight}>
        <div className={`${s.navLinks} ${s.hideSm}`}>
          <a className={s.link} href="#desk">Desk</a>
          <Link className={s.link} href="/login">Sign in</Link>
        </div>
        <span className={`${s.navSep} ${s.hideSm}`} aria-hidden="true" />
        <ThemeSwitch />
        <a className={`${s.btnSolid} ${s.btnMd}`} href="#access">
          Request access
        </a>
      </div>
    </nav>
  );
}
