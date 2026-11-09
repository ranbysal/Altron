"use client";

import { dismissToast, useDesk } from "@/lib/desk/store";
import s from "./desk.module.css";

/** Fills and closes, announced briefly at the bottom of the screen. */
export function Toaster() {
  const toasts = useDesk((st) => st.toasts);
  return (
    <div className={s.toasts} aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} type="button" className={`${s.toast} ${t.tone === "pos" ? s.toastPos : t.tone === "neg" ? s.toastNeg : ""}`} onClick={() => dismissToast(t.id)}>
          <i aria-hidden="true" />
          <b>{t.title}</b>
          {t.body && <span>{t.body}</span>}
        </button>
      ))}
    </div>
  );
}
