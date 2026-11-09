"use client";

import { usePathname } from "next/navigation";
import { dismissToast, useDesk } from "@/lib/desk/store";
import s from "./desk.module.css";

/**
 * Fills and closes, announced briefly. On the desk they rise inside the chart,
 * just above the time axis; everywhere else they sit at the bottom of the screen.
 */
export function Toaster({ inline = false }: { inline?: boolean }) {
  const toasts = useDesk((st) => st.toasts);
  const onDesk = usePathname()?.startsWith("/trader/desk") ?? false;
  if (onDesk !== inline) return null;
  return (
    <div className={inline ? s.toastsInline : s.toasts} aria-live="polite">
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
