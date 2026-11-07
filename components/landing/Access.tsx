"use client";

import { useState } from "react";
import { DitherGlow } from "./DitherCanvas";
import s from "./landing.module.css";

const MARKETS = ["NQ", "ES", "MNQ", "MES", "Other"] as const;

export function Access() {
  const [sent, setSent] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>({ NQ: true, MNQ: true });

  return (
    <section id="access" className={s.access}>
      <DitherGlow variant="bowl" className={s.fill} />
      <div className={`${s.container} ${s.accessInner}`}>
        <div className={s.accessHead}>
          <h2 className={s.accessH2}>
            Altron is <em>invite only.</em>
          </h2>
          <p className={s.accessP}>
            Membership is free. We keep the room small so the desk stays readable. Tell us a little about how you trade
            and we’ll be in touch.
          </p>
        </div>

        <div className={s.formCard}>
          {sent ? (
            <div className={s.done} role="status">
              <span className={s.doneIcon}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12l5 5 9-10" />
                </svg>
              </span>
              <h3>Request received.</h3>
              <p>
                Every request is reviewed by hand. If there’s a seat, you’ll get an invite at the email you gave within
                [REVIEW TIME].
              </p>
              <button type="button" className={`${s.btnGhost} ${s.btnMd}`} onClick={() => setSent(false)}>
                Send another
              </button>
            </div>
          ) : (
            <form
              className={s.form}
              onSubmit={(e) => {
                e.preventDefault();
                // TODO: send to a request-access endpoint once the backend exists.
                setSent(true);
              }}
            >
              <div className={s.fields}>
                <div className={s.field}>
                  <label htmlFor="acc-name">Name</label>
                  <input id="acc-name" name="name" type="text" autoComplete="name" required placeholder="Full name" className={s.input} />
                </div>
                <div className={s.field}>
                  <label htmlFor="acc-email">Email</label>
                  <input id="acc-email" name="email" type="email" autoComplete="email" required placeholder="you@domain.com" className={s.input} />
                </div>
                <div className={s.field}>
                  <label htmlFor="acc-handle">Discord or X handle</label>
                  <input id="acc-handle" name="handle" type="text" placeholder="@handle" className={s.input} />
                </div>
                <div className={s.field}>
                  <label htmlFor="acc-exp">Futures experience</label>
                  <select id="acc-exp" name="experience" className={s.input} defaultValue="New to futures">
                    <option>New to futures</option>
                    <option>Under a year</option>
                    <option>1–3 years</option>
                    <option>3+ years</option>
                    <option>Funded / prop trader</option>
                  </select>
                </div>
              </div>
              <fieldset className={s.fieldset}>
                <legend className={s.legend}>What do you trade?</legend>
                <div className={s.toggles}>
                  {MARKETS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={s.toggle}
                      aria-pressed={!!picked[m]}
                      onClick={() => setPicked((p) => ({ ...p, [m]: !p[m] }))}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className={s.field}>
                <label htmlFor="acc-why">
                  Why do you want to watch the desk? <span style={{ color: "var(--dim)" }}>Optional</span>
                </label>
                <textarea id="acc-why" name="why" rows={3} placeholder="A sentence or two is plenty." className={s.input} />
              </div>
              <button type="submit" className={s.cta}>
                Request access
              </button>
              <p className={s.fine}>We only use your details to review your request.</p>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
