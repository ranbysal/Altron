"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Mark } from "@/components/Mark";
import { isRthOpen, nyClock } from "@/lib/format";
import { MountainScene } from "./MountainScene";
import s from "./login.module.css";

type Role = "member" | "desk";

export function LoginView() {
  const [role, setRole] = useState<Role>("member");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(false);
  const [clock, setClock] = useState("--:--:--");
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setClock(nyClock(now));
      setOpen(isRthOpen(now));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => {
      window.clearInterval(id);
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
      <div className={s.visual}>
        <MountainScene className={s.scene} />
        <div aria-hidden="true" className={s.shade} />
        <div aria-hidden="true" className={s.frame}>
          <span className={s.node} style={{ left: -5, top: -5 }} />
          <span className={s.node} style={{ right: -5, top: -5 }} />
          <span className={s.node} style={{ left: -5, bottom: -5 }} />
          <span className={s.node} style={{ right: -5, bottom: -5 }} />
          <span className={s.rule} />
        </div>
        <div aria-hidden="true" className={`${s.reticle} ${s.hideSm}`}>
          <div className={`${s.ring} spin-slow`} />
          <div className={s.core} />
          <div className={s.h} />
          <div className={s.v} />
        </div>
        <div className={s.top}>
          <Link href="/" className={s.brand} aria-label="Altron home">
            <Mark size={24} />
            Altron
          </Link>
          <span className={`${s.label} ${s.hideSm}`}>[ CME GLOBEX · ES · NQ ]</span>
        </div>
        <div className={s.bottom}>
          <div className="rise" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <span className={s.label}>[ MEMBERS ONLY ]</span>
            <p className={s.headline}>
              See the ridge
              <br />
              <em>before the move.</em>
            </p>
          </div>
          <div className={s.status}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className={`${s.dot} ${open ? "pulse-blue" : ""}`} style={{ background: open ? "var(--blue)" : "var(--dim)" }} />
              {open ? "RTH OPEN" : "RTH CLOSED"}
            </span>
            <span>
              NEW YORK · <strong>{clock}</strong> ET
            </span>
          </div>
        </div>
      </div>

      <main className={s.panel}>
        <div className={`${s.inner} rise`}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h1 className={s.h1}>Welcome back.</h1>
            <p className={s.sub}>{desk ? "Desk sign-in for the trading team." : "Sign in to watch the desk live."}</p>
          </div>

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
              <input id="si-email" name="email" type="email" autoComplete="email" required placeholder="you@domain.com" className={s.bare} />
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
                  placeholder="••••••••••"
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
                  placeholder="000000"
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
                Design preview — sign-in connects once authentication is set up.
              </p>
            )}
          </form>

          <div className={s.or}>
            <span />
            OR
            <span />
          </div>

          <button type="button" className={s.ghost}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4z" />
            </svg>
            Continue with Discord
          </button>

          <p className={s.foot}>
            Altron is invite-only. <Link href="/#access">Request access →</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
