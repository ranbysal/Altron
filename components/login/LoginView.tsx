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
  link: "That link has expired or was already used. Try again.",
  out: "You're signed out.",
  invite: "This email hasn't been invited, or its access was removed. Altron is invite only.",
  google: "Google sign-in didn't finish. Try again.",
};

type Mode = "signin" | "create" | "forgot" | "reset";

/** Supabase's messages, said plainly. */
function plain(msg: string): string {
  if (/not_invited|database error saving new user/i.test(msg)) return WHY.invite;
  if (/invalid login credentials/i.test(msg)) return "That email and password don't match.";
  if (/email not confirmed/i.test(msg)) return "Confirm your email first. The link is in your inbox.";
  if (/already registered|already been registered/i.test(msg)) return "This email already has a password. Sign in, or reset it.";
  if (/password should be|at least/i.test(msg)) return "Use at least 8 characters.";
  if (/rate|seconds/i.test(msg)) return "Too many tries. Wait a minute and try again.";
  if (/provider is not enabled|unsupported provider/i.test(msg)) return "Google sign-in isn't switched on yet.";
  return "That didn't work. Try again in a moment.";
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
      <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.8-5.8l-7.4-5.7c-2.1 1.4-4.8 2.2-8.4 2.2-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}

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
  const [mode, setMode] = useState<Mode>("signin");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ head: string; body: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [show, setShow] = useState(false);
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
    if (q.get("mode") === "reset") setMode("reset");
    return () => window.removeEventListener("resize", fit);
  }, []);

  const go = (m: Mode) => {
    setMode(m);
    setNotice(null);
    setSent(null);
  };
  /** Where to go once signed in: the server sends each role to its own pages. */
  const home = () => {
    const u = new URL("/auth/home", window.location.origin);
    if (next.current) u.searchParams.set("next", next.current);
    window.location.assign(u.toString());
  };
  const back = (to?: string) => {
    const u = new URL("/auth/callback", window.location.origin);
    const n = to ?? next.current;
    if (n) u.searchParams.set("next", n);
    return u.toString();
  };

  const run = async (fn: () => Promise<{ error: { message: string } | null }>, after?: () => void) => {
    setNotice(null);
    if (!supabaseReady()) {
      setNotice(WHY.setup);
      return;
    }
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) setNotice(plain(error.message));
    else after?.();
  };

  const google = () => run(() => browserClient().auth.signInWithOAuth({ provider: "google", options: { redirectTo: back() } }));

  const submit = (f: FormData) => {
    const email = String(f.get("email") ?? "").trim().toLowerCase();
    const password = String(f.get("password") ?? "");
    const sb = () => browserClient().auth;
    if (mode === "signin") return run(() => sb().signInWithPassword({ email, password }), home);
    if (mode === "create") {
      if (password.length < 8) return setNotice("Use at least 8 characters.");
      return run(
        async () => {
          const { data, error } = await sb().signUp({ email, password, options: { emailRedirectTo: back() } });
          if (!error && data.session) home();
          else if (!error) setSent({ head: "Confirm your email.", body: `We sent a link to ${email}. Open it once to finish; after that you sign in with your password.` });
          return { error };
        },
      );
    }
    if (mode === "forgot")
      return run(
        () => sb().resetPasswordForEmail(email, { redirectTo: back("/login?mode=reset") }),
        () => setSent({ head: "Check your inbox.", body: `If ${email} has an account, a link to set a new password is on its way.` }),
      );
    if (mode === "reset") {
      if (password.length < 8) return setNotice("Use at least 8 characters.");
      return run(() => sb().updateUser({ password }), home);
    }
  };

  const title = { signin: "SIGN IN", create: "CREATE PASSWORD", forgot: "RESET PASSWORD", reset: "NEW PASSWORD" }[mode];
  const cta = { signin: "Sign in", create: "Create my password", forgot: "Email me a reset link", reset: "Save and sign in" }[mode];
  const needEmail = mode !== "reset";
  const needPass = mode !== "forgot";

  return (
    <div className={s.wrap}>
      <AsciiStar className={s.art} focusX={focusX} />
      <div className={s.layer}>
        <div className={s.tools}>
          <ThemeSwitch />
        </div>

        <main ref={panelRef} className={`${s.panel} rise`} aria-labelledby="signin-label">
          <span className={s.chip} id="signin-label">
            {title}
          </span>
          <Corners />

          {sent ? (
            <div className={s.form}>
              <p className={s.sentHead}>{sent.head}</p>
              <p className={s.sentBody}>{sent.body}</p>
              <button type="button" className={s.forgot} onClick={() => go("signin")}>
                Back to sign in
              </button>
            </div>
          ) : (
            <div className={s.form}>
              {mode === "signin" && (
                <>
                  <button type="button" className={s.google} onClick={google} disabled={busy}>
                    <GoogleMark />
                    Continue with Google
                  </button>
                  <div className={s.or} aria-hidden="true" />
                </>
              )}
              <form
                className={s.form}
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit(new FormData(e.currentTarget));
                }}
              >
                {needEmail && (
                  <div className={s.field}>
                    <label htmlFor="si-email">Email</label>
                    <div className={s.line}>
                      <input id="si-email" name="email" type="email" autoComplete="email" required />
                    </div>
                  </div>
                )}
                {needPass && (
                  <div className={s.field}>
                    <div className={s.fieldTop}>
                      <label htmlFor="si-pass">{mode === "signin" ? "Password" : "New password"}</label>
                      {mode === "signin" && (
                        <button type="button" className={s.forgot} onClick={() => go("forgot")}>
                          Forgot
                        </button>
                      )}
                    </div>
                    <div className={s.line}>
                      <input id="si-pass" name="password" type={show ? "text" : "password"} autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={mode === "signin" ? undefined : 8} required />
                      <button type="button" className={s.reveal} aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow((v) => !v)}>
                        {show ? "Hide" : "Show"}
                      </button>
                    </div>
                  </div>
                )}

                <button type="submit" className={s.submit} disabled={busy} aria-busy={busy}>
                  <span>{busy ? "One moment" : cta}</span>
                  <span className={s.submitIcon} aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  </span>
                  {busy && <span className={s.progress} aria-hidden="true" />}
                </button>
              </form>

              {mode === "signin" ? (
                <p className={s.hint}>
                  Invited, but no password yet?{" "}
                  <button type="button" className={s.textBtn} onClick={() => go("create")}>
                    Create one
                  </button>
                </p>
              ) : mode !== "reset" ? (
                <p className={s.hint}>
                  {mode === "create" ? "Use the email your invite went to. " : ""}
                  <button type="button" className={s.textBtn} onClick={() => go("signin")}>
                    Back to sign in
                  </button>
                </p>
              ) : null}
            </div>
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
