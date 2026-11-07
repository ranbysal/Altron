import Link from "next/link";
import s from "./landing.module.css";

export function Footer() {
  return (
    <footer className={s.footer}>
      <div className={s.container}>
        <div className={s.footTop}>
          <div className={s.footIntro}>
            <h2>A private futures desk that trades in the open.</h2>
            <a className={`${s.btnLight} ${s.navCta}`} href="#access" style={{ alignSelf: "flex-start" }}>
              Request access
            </a>
          </div>
          <div className={s.footCols}>
            <div className={s.footCol}>
              <span>DESK</span>
              <a href="#desk">Live desk</a>
              <a href="#method">Method</a>
              <a href="#ledger">Ledger</a>
            </div>
            <div className={s.footCol}>
              <span>ACCESS</span>
              <a href="#access">Request access</a>
              <Link href="/login">Sign in</Link>
            </div>
            <div className={s.footCol}>
              <span>LEGAL</span>
              <a href="#risk">Risk disclosure</a>
              <a href="#top">Privacy</a>
              <a href="#top">Terms</a>
            </div>
          </div>
        </div>
        <div id="risk" className={s.footLegal}>
          <p>
            Futures trading involves substantial risk of loss and is not suitable for every investor. Altron shares one
            trader’s positions for education and transparency; nothing here is investment advice. Past results do not
            guarantee future results. Figures on this page are demonstration data.
          </p>
          <span>© 2026 Altron</span>
        </div>
      </div>
      <div aria-hidden="true" className={s.wordmarkWrap}>
        <div className={s.wordmarkGlow} />
        <div className={s.wordmark}>Altron</div>
      </div>
    </footer>
  );
}
