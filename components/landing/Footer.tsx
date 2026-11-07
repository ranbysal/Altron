import Link from "next/link";
import s from "./landing.module.css";

export function Footer() {
  return (
    <footer className={s.footer}>
      <div className={s.wide}>
        <div className={s.footTop}>
          <div className={s.footIntro}>
            <h2>A private futures desk that trades in the open.</h2>
            <a className={`${s.btnSolid} ${s.btnMd}`} href="#access" style={{ alignSelf: "flex-start" }}>
              Request access
            </a>
          </div>
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

      <div aria-hidden="true" className={s.wordmarkWrap}>
        <div className={s.wordmarkGlow} />
        <div className={s.wordmark}>Altron</div>
      </div>

      <div className={`${s.wide} ${s.footBar}`}>
        <span>© 2026 Altron</span>
        <Link href="/legal">Risk disclosure</Link>
      </div>
    </footer>
  );
}
