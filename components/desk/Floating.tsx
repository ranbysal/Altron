"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { create } from "zustand";
import { fmt, money } from "@/lib/format";
import { INSTRUMENTS, type Sym } from "@/lib/desk/instruments";
import { arm, closePercent, disarm, instant, keepArmed, openPnl, setSettings, togglePanel, useDesk, type Side } from "@/lib/desk/store";
import { onThemeChange } from "@/lib/theme";
import { Odometer } from "@/components/trader/parts";
import t from "@/components/trader/trader.module.css";
import s from "./desk.module.css";

type Which = "pnl" | "notes";

/* ------------------------------------------------------------------ */
/* the lock                                                            */
/* ------------------------------------------------------------------ */

const ARM_MS = 60_000;

function useArmed(): { armed: boolean; left: number } {
  const until = useDesk((st) => st.armedUntil);
  useDesk((st) => st.tick); // re-render with the clock
  const left = Math.max(0, until - Date.now());
  return { armed: left > 0, left };
}

/** Panels start locked. One tap arms them for a minute; any trade keeps them armed. */
function Lock({ nudge }: { nudge: number }) {
  const { armed, left } = useArmed();
  const r = 8;
  const c = 2 * Math.PI * r;
  return (
    <button
      type="button"
      key={nudge}
      className={`${s.lock} ${armed ? s.lockOn : ""} ${nudge ? s.lockNudge : ""}`}
      onClick={() => (armed ? disarm() : arm())}
      aria-pressed={armed}
      title={armed ? `Armed for ${Math.ceil(left / 1000)}s more. Tap to lock` : "Locked. Tap to arm"}
    >
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
        <circle cx="11" cy="11" r={r} className={s.lockTrack} />
        {armed && <circle cx="11" cy="11" r={r} className={s.lockRing} style={{ strokeDasharray: c, strokeDashoffset: c * (1 - left / ARM_MS) }} />}
        <rect x="7.6" y="10" width="6.8" height="5" rx="1" fill="currentColor" />
        <path d={armed ? "M9 10V8.3a2 2 0 0 1 3.8-.9" : "M9 10V8.3a2 2 0 0 1 4 0V10"} fill="none" stroke="currentColor" strokeWidth="1.2" />
      </svg>
      <span>{armed ? "Armed" : "Locked"}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* panel bodies (shared by the floating card and the pop-out window)   */
/* ------------------------------------------------------------------ */

function useFire(sym: Sym, onLocked: () => void) {
  const { armed } = useArmed();
  /** The bypass-confirmation path: direction and size straight to a market order. */
  return useCallback(
    (direction: Side, size: number) => {
      if (!armed) return onLocked();
      if (size <= 0) return;
      instant(sym, direction, size);
      keepArmed();
    },
    [armed, sym, onLocked],
  );
}

export function PnlBody({ onLocked, compact = false }: { onLocked: () => void; compact?: boolean }) {
  const sym = useDesk((st) => st.settings.sym);
  const pos = useDesk((st) => st.positions[sym]);
  const q = useDesk((st) => st.quotes[sym]);
  const qty = useDesk((st) => st.settings.qty[sym]);
  const trades = useDesk((st) => st.trades);
  const { armed } = useArmed();
  const fire = useFire(sym, onLocked);
  const inst = INSTRUMENTS[sym];
  const open = pos ? ((pos.qty > 0 ? q.bid : q.ask) - pos.avg) * pos.qty * inst.pv : 0;
  const trade = pos ? trades.find((x) => x.id === pos.tradeId) : undefined;
  const r = trade?.risk ? open / trade.risk : null;

  return (
    <div className={`${s.pnl} ${armed ? s.isArmed : s.isLocked} ${compact ? s.instCompact : ""}`}>
      {pos ? (
        <>
          {/* the P&L changes in place, digit for digit, like the blotter's */}
          <span className={`${s.pnlBig} ${s.pnlLive} ${open >= 0 ? s.pos : s.neg}`}>{money(open)}</span>
          <div className={s.pnlSub}>
            <span className={`${s.side} ${pos.qty > 0 ? s.sideL : s.sideS}`}>{pos.qty > 0 ? "Long" : "Short"}</span>
            <span>
              {Math.abs(pos.qty)} {inst.code} @ {fmt(pos.avg)}
            </span>
            {r !== null && <span className={open >= 0 ? s.pos : s.neg}>{`${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(2)}R`}</span>}
          </div>
          <div className={s.pnlPx}>
            <i className={q.dir > 0 ? s.tickUp : q.dir < 0 ? s.tickDn : ""} />
            <Odometer value={fmt(q.last)} delay={0} />
          </div>
        </>
      ) : (
        <>
          <Odometer value={fmt(q.last)} className={s.pnlBig} delay={0} />
          <div className={s.pnlSub}>
            <span className={s.dim}>{inst.code} · no open trade</span>
            <span className={q.last - q.prev >= 0 ? s.pos : s.neg}>
              {q.last - q.prev >= 0 ? "+" : "−"}
              {fmt(Math.abs(q.last - q.prev))}
            </span>
          </div>
        </>
      )}
      <div className={s.pnlBtns}>
        <button type="button" className={s.instBuy} onClick={() => fire(1, qty)}>
          <span>Buy {qty}</span>
        </button>
        <button type="button" className={s.instSell} onClick={() => fire(-1, qty)}>
          <span>Sell {qty}</span>
        </button>
        {pos && (
          <button type="button" className={s.instFlat} onClick={() => (armed ? closePercent(sym, 1) : onLocked())}>
            <span>Flat</span>
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* pop-out window (Document Picture-in-Picture, Chrome and Edge)       */
/* ------------------------------------------------------------------ */

type DocPip = { requestWindow: (o: { width: number; height: number }) => Promise<Window>; window: Window | null };
const docPip = (): DocPip | null => (typeof window !== "undefined" && "documentPictureInPicture" in window ? (window as unknown as { documentPictureInPicture: DocPip }).documentPictureInPicture : null);

const usePip = create<{ open: boolean }>(() => ({ open: false }));
let pipRoot: Root | null = null;

function PipApp() {
  const sym = useDesk((st) => st.settings.sym);
  const [nudge, setNudge] = useState(0);
  const locked = useCallback(() => setNudge((n) => n + 1), []);
  return (
    <div className={s.pipApp}>
      <header className={s.pipHead}>
        <span className={s.floatTitle}>Live P&amp;L</span>
        <span className={s.pipSym}>{INSTRUMENTS[sym].code}</span>
        <Lock nudge={nudge} />
      </header>
      <PnlBody onLocked={locked} compact />
    </div>
  );
}

async function popOut() {
  const api = docPip();
  if (!api) return false;
  if (api.window) {
    api.window.focus();
    return true;
  }
  const w = await api.requestWindow({ width: 300, height: 214 });
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const css = Array.from(sheet.cssRules)
        .map((r) => r.cssText)
        .join("\n");
      const el = w.document.createElement("style");
      el.textContent = css;
      w.document.head.appendChild(el);
    } catch {
      if (sheet.href) {
        const link = w.document.createElement("link");
        link.rel = "stylesheet";
        link.href = sheet.href;
        w.document.head.appendChild(link);
      }
    }
  }
  const html = w.document.documentElement;
  html.className = document.documentElement.className;
  html.dataset.theme = document.documentElement.dataset.theme ?? "light";
  w.document.title = "Altron";
  w.document.body.className = `${t.root} ${s.pipBody}`;
  const host = w.document.createElement("div");
  w.document.body.appendChild(host);
  const off = onThemeChange((th) => {
    html.dataset.theme = th;
  });
  pipRoot = createRoot(host);
  pipRoot.render(<PipApp />);
  usePip.setState({ open: true });
  w.addEventListener("pagehide", () => {
    off();
    pipRoot?.unmount();
    pipRoot = null;
    usePip.setState({ open: false });
  });
  return true;
}

/* ------------------------------------------------------------------ */
/* the in-page floating card                                          */
/* ------------------------------------------------------------------ */

/** Where a panel lives: an offset from the corner it was dropped nearest, so it
 * stays put when the window resizes and grows away from the edge it sits on. */
type Anchor = { ax: "l" | "r"; ay: "t" | "b"; x: number; y: number };
const W: Record<Which, number> = { pnl: 288, notes: 356 };
const KEY = (id: Which) => `altron-float-${id}-v3`;

/** First placement: notes at the top left of the chart, the trading panels at its
 * bottom left, clear of the live candle, the price axis and the ticket. */
function defaultAnchor(id: Which): Anchor {
  const plot = document.querySelector("[data-plot]")?.getBoundingClientRect();
  if (!plot) return id === "notes" ? { ax: "l", ay: "t", x: 24, y: 160 } : { ax: "r", ay: "b", x: 24, y: 24 };
  const x = Math.round(plot.left + 16);
  if (id === "notes") return { ax: "l", ay: "t", x, y: Math.round(plot.top + 38) };
  return { ax: "l", ay: "b", x, y: Math.round(window.innerHeight - plot.bottom + 38) };
}

function loadAnchor(id: Which): Anchor {
  try {
    const a = JSON.parse(localStorage.getItem(KEY(id)) ?? "null");
    if (a && (a.ax === "l" || a.ax === "r") && (a.ay === "t" || a.ay === "b") && Number.isFinite(a.x) && Number.isFinite(a.y)) return a;
  } catch {
    /* fall through */
  }
  return defaultAnchor(id);
}

/**
 * A card that floats over the desk. While it's dragged it moves by writing its
 * transform straight to the element, so React does nothing until it's dropped.
 */
function Floating({ id, title, children, nudge, onClose, extra }: { id: Which; title: string; children: ReactNode; nudge?: number; onClose: () => void; extra?: ReactNode }) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const box = useRef({ h: 0, vw: 0, vh: 0 });
  const at = useRef({ left: 0, top: 0 });
  const start = useRef<{ px: number; py: number; left: number; top: number } | null>(null);
  const anchorRef = useRef<Anchor | null>(null);
  anchorRef.current = anchor;
  const canPop = !!docPip() && id === "pnl";
  const w = W[id];
  const placed = anchor !== null;

  useEffect(() => setAnchor(loadAnchor(id)), [id]);

  const place = useCallback(
    (smooth: boolean) => {
      const el = ref.current;
      const a = anchorRef.current;
      if (!el || !a) return;
      const b = box.current;
      const left = Math.max(8, Math.min(b.vw - w - 8, a.ax === "l" ? a.x : b.vw - w - a.x));
      const top = Math.max(8, Math.min(b.vh - b.h - 8, a.ay === "t" ? a.y : b.vh - b.h - a.y));
      at.current = { left, top };
      el.style.transition = smooth ? "" : "none";
      el.style.transform = `translate3d(${left}px, ${top}px, 0)`;
      el.classList.add(s.floatPlaced);
    },
    [w],
  );

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      box.current = { h: el.offsetHeight, vw: window.innerWidth, vh: window.innerHeight };
      if (!start.current) place(true);
    };
    box.current = { h: el.offsetHeight, vw: window.innerWidth, vh: window.innerHeight };
    place(false);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [placed, place]);

  useEffect(() => {
    if (anchor) place(true);
  }, [anchor, place]);

  const down = (e: React.PointerEvent) => {
    if ((e.target as Element).closest("button, input, textarea")) return;
    const el = ref.current;
    if (!el) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    start.current = { px: e.clientX, py: e.clientY, ...at.current };
    el.style.transition = "none";
    el.classList.add(s.floatDrag);
  };
  const move = (e: React.PointerEvent) => {
    const st = start.current;
    const el = ref.current;
    if (!st || !el) return;
    const b = box.current;
    const left = Math.max(8, Math.min(b.vw - w - 8, st.left + e.clientX - st.px));
    const top = Math.max(8, Math.min(b.vh - b.h - 8, st.top + e.clientY - st.py));
    at.current = { left, top };
    el.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  };
  const up = () => {
    const el = ref.current;
    if (!start.current || !el) return;
    start.current = null;
    el.classList.remove(s.floatDrag);
    el.style.transition = "";
    const b = box.current;
    const d = at.current;
    const ax = d.left + w / 2 < b.vw / 2 ? "l" : "r";
    const ay = d.top + b.h / 2 < b.vh / 2 ? "t" : "b";
    let x = ax === "l" ? d.left : b.vw - w - d.left;
    let y = ay === "t" ? d.top : b.vh - b.h - d.top;
    // settle against an edge when dropped close to one
    if (x < 40) x = 16;
    if (y < 40) y = 16;
    const next: Anchor = { ax, ay, x: Math.round(x), y: Math.round(y) };
    setAnchor(next);
    try {
      localStorage.setItem(KEY(id), JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  if (!anchor) return null;
  return (
    <div ref={ref} className={s.float} style={{ width: w } as CSSProperties} role="dialog" aria-label={title}>
      <div className={s.floatHandle} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <span className={s.grip} aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <i key={i} />
          ))}
        </span>
        <span className={s.floatTitle}>{title}</span>
        {extra}
        <span className={s.floatActions}>
          {nudge !== undefined && <Lock nudge={nudge} />}
          {canPop && (
            <button type="button" className={s.fBtn} onClick={() => popOut()} title="Pop out over other windows" aria-label="Pop out">
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                <rect x="1.5" y="3.5" width="10" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
                <path d="M8.5 1.5h6v6M14.5 1.5 8 8" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          <button type="button" className={s.fBtn} onClick={onClose} title="Close" aria-label="Close">
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        </span>
      </div>
      {children}
    </div>
  );
}

/** Floating panels for the whole trader area, plus the pop-out window. */
export function FloatLayer() {
  const ready = useDesk((st) => st.ready);
  const pnl = useDesk((st) => st.settings.panels.pnl);
  const pipOpen = usePip((st) => st.open);
  const [nudge, setNudge] = useState(0);
  const locked = useCallback(() => setNudge((n) => n + 1), []);
  if (!ready) return null;
  return (
    <div className={s.floatLayer}>
      {pnl && !pipOpen && (
        <Floating id="pnl" title="Live P&L" nudge={nudge} onClose={() => togglePanel("pnl", false)}>
          <PnlBody onLocked={locked} />
        </Floating>
      )}
    </div>
  );
}
