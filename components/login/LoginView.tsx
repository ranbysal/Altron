"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Mark } from "@/components/Mark";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { browserClient } from "@/lib/supabase/client";
import { safeNext, supabaseReady } from "@/lib/supabase/env";
import { AsciiStar } from "./AsciiStar";
import s from "./login.module.css";

const WHY: Record<string, string> = {
  setup: "Sign-in isn't connected on this site yet.",
  owner: "This account can't open those pages.",
  link: "That link has expired or was already used. Ask for a new one.",
  out: "You're signed out.",
};

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
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [focusX, setFocusX] = useState(0.36);
  const next = useRef<string | null>(null);
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
    const q = new URLSearchParams(window.location.search);
    next.current = safeNext(q.get("next"));
    const why = q.get("why");
    if (why && WHY[why]) setNotice(WHY[why]);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const send = async (email: string) => {
    setNotice(null);
    if (!supabaseReady()) {
      setNotice(WHY.setup);
      return;
    }
    setBusy(true);
    const back = new URL("/auth/callback", window.location.origin);
    if (next.current) back.searchParams.set("next", next.current);
    // invite only: the email has to belong to an account already
    const { error } = await browserClient().auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: back.toString() } });
    setBusy(false);
    if (!error) setSent(email);
    else if (/signup|not allowed|not found/i.test(error.message)) setNotice("No Altron account uses this email. Altron is invite only.");
    else if (/rate|seconds/i.test(error.message)) setNotice("A link was just sent. Wait a minute before asking for another.");
    else setNotice("The link couldn't be sent. Try again in a moment.");
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
            SIGN IN
          </span>
          <Corners />

          {sent ? (
            <div className={s.form}>
              <p className={s.sentHead}>Check your inbox.</p>
              <p className={s.sentBody}>
                We sent a sign-in link to <b>{sent}</b>. Open it on this device and you&apos;re in. It works once and expires within the hour.
              </p>
              <button type="button" className={s.forgot} onClick={() => setSent(null)}>
                Use a different email
              </button>
            </div>
          ) : (
            <form
              className={s.form}
              onSubmit={(e) => {
                e.preventDefault();
                const email = new FormData(e.currentTarget).get("email");
                if (typeof email === "string" && email.trim()) void send(email.trim());
              }}
            >
              <div className={s.field}>
                <label htmlFor="si-email">Email</label>
                <div className={s.line}>
                  <input id="si-email" name="email" type="email" autoComplete="email" required autoFocus />
                </div>
              </div>

              <button type="submit" className={s.submit} disabled={busy} aria-busy={busy}>
                <span>{busy ? "Sending" : "Email me a sign-in link"}</span>
                <span className={s.submitIcon} aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </span>
                {busy && <span className={s.progress} aria-hidden="true" />}
              </button>

              <p className={s.hint}>No password. Altron is invite only, so the email has to be one we&apos;ve added.</p>
            </form>
          )}

          {notice && (
            <p role="status" className={s.notice}>
              {notice}
            </p>
          )}
        </main>

        <Link href="/" className={s.home} aria-label="Altron home">
          <Mark size={30} />
        </Link>
      </div>
    </div>
  );
}
