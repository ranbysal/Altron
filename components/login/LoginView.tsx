"use client";

import { useEffect, useRef, useState } from "react";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { AsciiStar } from "./AsciiStar";
import s from "./login.module.css";

type Role = "member" | "desk";

function Corners() {
  return (
    <>
      <i className={`${s.corner} ${s.cTL}`} aria-hidden="true" />
      <i className={`${s.corner} ${s.cTR}`} aria-hidden="true" />
      <i className={`${s.corner} ${s.cBL}`} aria-hidden="true" />
      <i className={`${s.corner} ${s.cBR}`} aria-hidden="true" />
    </>
  );
}

export function LoginView() {
  const [role, setRole] = useState<Role>("member");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(false);
  const [focusX, setFocusX] = useState(0.36);
  const timer = useRef<number | undefined>(undefined);
  const panelRef = useRef<HTMLElement>(null);

  // Center the star in the open space to the left of the panel.
  useEffect(() => {
    const fit = () => {
      const w = window.innerWidth;
      const left = panelRef.current?.getBoundingClientRect().left ?? w * 0.62;
      setFocusX(Math.max(0.28, left / 2 / w));
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
        <div className={s.tools}>
          <ThemeSwitch />
        </div>

        <main ref={panelRef} className={`${s.panel} rise`} aria-labelledby="signin-label">
          <span className={s.chip} id="signin-label">
            SIGN IN <span className={s.chipSep}>·</span> {desk ? "DESK" : "MEMBER"}
          </span>
          <Corners />

          <div role="group" aria-label="Account type" className={s.roles}>
            <button type="button" className={s.role} aria-pressed={!desk} onClick={() => pick("member")}>
              Member
            </button>
            <button type="button" className={s.role} aria-pressed={desk} onClick={() => pick("desk")}>
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
              }, 1400);
            }}
          >
            <div className={s.field}>
              <label htmlFor="si-email">Email</label>
              <div className={s.line}>
                <input id="si-email" name="email" type="email" autoComplete="email" required />
              </div>
            </div>

            <div className={s.field}>
              <div className={s.fieldTop}>
                <label htmlFor="si-pass">Password</label>
                <a href="#forgot" className={s.forgot}>
                  Forgot
                </a>
              </div>
              <div className={s.line}>
                <input id="si-pass" name="password" type={show ? "text" : "password"} autoComplete="current-password" required />
                <button type="button" className={s.reveal} aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow((v) => !v)}>
                  {show ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            {desk && (
              <div className={`${s.field} ${s.fieldIn}`}>
                <label htmlFor="si-code">Authenticator code</label>
                <div className={s.line}>
                  <input id="si-code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className={s.code} />
                </div>
              </div>
            )}

            <label className={s.check}>
              <input type="checkbox" name="remember" />
              <span className={s.box} aria-hidden="true" />
              Keep me signed in on this device
            </label>

            <button type="submit" className={s.submit} disabled={busy} aria-busy={busy}>
              <span>{busy ? "Signing in" : desk ? "Open the desk" : "Continue"}</span>
              <span className={s.submitIcon} aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </span>
              {busy && <span className={s.progress} aria-hidden="true" />}
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
