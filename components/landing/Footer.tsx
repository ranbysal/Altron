import Link from "next/link";
import s from "./landing.module.css";

export function Footer() {
  return (
    <footer className={s.footer}>
      <div className={s.wide}>
        <div className={s.footTop}>
          <p className={s.footIntro}>A private futures desk that trades in the open.</p>
          <div className={s.footCols}>
            <div className={s.footCol}>
              <span>DESK</span>
              <a href="#desk">Live desk</a>
              <a href="#ledger">Ledger</a>
            </div>
            <div className={s.footCol}>
              <span>ACCESS</span>
              <a href="#access">Request access</a>
              <Link href="/login">Sign in</Link>
            </div>
          </div>
        </div>
      </div>

      <div className={s.wordmarkWrap}>
        <div aria-hidden="true" className={s.wordmarkGlow} />
        <div aria-hidden="true" className={s.wordmark}>
          Altron
        </div>
        <span className={s.copyright}>© 2026 Altron</span>
      </div>
    </footer>
  );
}
