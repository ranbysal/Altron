"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Mark } from "@/components/Mark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AsciiStar } from "./AsciiStar";
import s from "./login.module.css";

type Role = "member" | "desk";

export function LoginView() {
  const [role, setRole] = useState<Role>("member");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(false);
  const [focusX, setFocusX] = useState(0.36);
  const timer = useRef<number | undefined>(undefined);

  // Center the star in the open space left of the card.
  useEffect(() => {
    const fit = () => {
      const w = window.innerWidth;
      const cardSpace = 420 + 48 + Math.max(0, w * 0.06 - 48) + 24;
      setFocusX(Math.max(0.3, (w - cardSpace) / 2 / w));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("resize", fit);
      window.clearTimeout(timer.current);
    };
  }, []);

  const desk = role === "desk";
  const pick = (r: Role) => {
    setRole(r);
    setNotice(false);
  };

  return (
    <div className={s.wrap}>
      <AsciiStar className={s.art} focusX={focusX} />
      <div className={s.layer}>
        <Link href="/" className={s.brand} aria-label="Altron home">
          <Mark size={22} />
          Altron
        </Link>
        <div className={s.tools}>
          <ThemeToggle className={s.toggle} />
        </div>

        <main className={`${s.card} rise`}>
          <p className={s.sub}>{desk ? "Desk sign-in for the trading team." : "Sign in to watch the desk live."}</p>

          <div role="group" aria-label="Account type" className={s.segment}>
            <button type="button" className={s.seg} aria-pressed={!desk} onClick={() => pick("member")}>
              Member
            </button>
            <button type="button" className={s.seg} aria-pressed={desk} onClick={() => pick("desk")}>
              Desk
            </button>
          </div>

          <form
            className={s.form}
            onSubmit={(e) => {
              e.preventDefault();
              // TODO: wire to auth once it's set up.
              setBusy(true);
              setNotice(false);
              window.clearTimeout(timer.current);
              timer.current = window.setTimeout(() => {
                setBusy(false);
                setNotice(true);
              }, 1100);
            }}
          >
            <div className={s.box}>
              <label htmlFor="si-email">Email</label>
              <input id="si-email" name="email" type="email" autoComplete="email" required className={s.bare} />
            </div>
            <div className={s.box}>
              <div className={s.row}>
                <label htmlFor="si-pass">Password</label>
                <a href="#forgot" className={s.forgot}>
                  Forgot?
                </a>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  id="si-pass"
                  name="password"
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  className={s.bare}
                  style={{ flex: 1 }}
                />
                <button type="button" className={s.eye} aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow((v) => !v)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </button>
              </div>
            </div>
            {desk && (
              <div className={`${s.box} ${s.boxDesk}`}>
                <label htmlFor="si-code">Authenticator code</label>
                <input
                  id="si-code"
                  name="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  className={`${s.bare} ${s.code}`}
                />
              </div>
            )}
            <label htmlFor="si-remember" className={s.remember}>
              <input id="si-remember" type="checkbox" />
              Remember this device
            </label>
            <button type="submit" className={s.cta} disabled={busy}>
              {busy && <span className={`${s.spinner} spin-fast`} />}
              {busy ? "Signing in" : desk ? "Open the desk" : "Continue"}
            </button>
            {notice && (
              <p role="status" className={s.notice}>
                Design preview. Sign-in connects once authentication is set up.
              </p>
            )}
          </form>
        </main>

        <p className={s.title}>Altron Capital</p>
      </div>
    </div>
  );
}
