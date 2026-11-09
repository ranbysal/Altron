"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { create } from "zustand";
import { fmt, money } from "@/lib/format";
import { INSTRUMENTS, type Sym } from "@/lib/desk/instruments";
import { arm, closePercent, disarm, instant, keepArmed, openPnl, setSettings, toggleNotes, togglePanel, useDesk, type Side } from "@/lib/desk/store";
import { onThemeChange } from "@/lib/theme";
import { Odometer } from "@/components/trader/parts";
import t from "@/components/trader/trader.module.css";
import { Thread } from "./Thread";
import s from "./desk.module.css";

type Which = "instant" | "pnl" | "notes";

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

function Sizes({ onDone }: { onDone: () => void }) {
  const sizes = useDesk((st) => st.settings.sizes);
  const edit = (kind: "mini" | "micro", i: number, v: string) => {
    const n = Math.max(1, Math.min(99, parseInt(v, 10) || 1));
    const next = { ...sizes, [kind]: sizes[kind].map((x, k) => (k === i ? n : x)) };
    setSettings({ sizes: next });
  };
  return (
    <div className={s.sizes}>
      {(["mini", "micro"] as const).map((kind) => (
        <div key={kind} className={s.sizesRow}>
          <span>{kind === "mini" ? "Minis" : "Micros"}</span>
          {sizes[kind].map((n, i) => (
            <input key={i} inputMode="numeric" aria-label={`${kind} size ${i + 1}`} defaultValue={n} onBlur={(e) => edit(kind, i, e.target.value)} />
          ))}
        </div>
      ))}
      <button type="button" className={s.sizesDone} onClick={onDone}>
        Done
      </button>
    </div>
  );
}

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

export function InstantBody({ onLocked, compact = false }: { onLocked: () => void; compact?: boolean }) {
  const sym = useDesk((st) => st.settings.sym);
  const pos = useDesk((st) => st.positions[sym]);
  const sizes = useDesk((st) => st.settings.sizes);
  const positions = useDesk((st) => st.positions);
  const quotes = useDesk((st) => st.quotes);
  const { armed } = useArmed();
  const fire = useFire(sym, onLocked);
  const inst = INSTRUMENTS[sym];
  const list = inst.micro ? sizes.micro : sizes.mini;
  const size = pos ? Math.abs(pos.qty) : 0;
  const dir = pos ? (-Math.sign(pos.qty) as Side) : -1;
  const open = openPnl({ positions, quotes }, sym);

  return (
    <div className={`${s.inst} ${armed ? s.isArmed : s.isLocked} ${compact ? s.instCompact : ""}`}>
      <div className={s.instCols}>
        <div className={s.instCol}>
          <span className={s.instHead}>
            Buy <em>{inst.code}</em>
          </span>
          {list.map((n, i) => (
            <button key={i} type="button" className={s.instBuy} onClick={() => fire(1, n)}>
              <span>+{n}</span>
            </button>
          ))}
        </div>
        <div className={s.instCol}>
          <span className={s.instHead}>
            {pos && pos.qty < 0 ? "Cover" : "Sell"} <em>of {size || 0}</em>
          </span>
          {[0.25, 0.5, 1].map((p) => {
            const q = p >= 1 ? size : Math.max(1, Math.min(size, Math.round(size * p)));
            return (
              <button key={p} type="button" className={s.instSell} disabled={!pos} onClick={() => fire(dir, q)}>
                <span>{p * 100}%</span>
                {pos && <em>{q}</em>}
              </button>
            );
          })}
        </div>
      </div>
      <div className={s.instFoot}>
        {pos ? (
          <>
            <span className={`${s.side} ${pos.qty > 0 ? s.sideL : s.sideS}`}>{pos.qty > 0 ? "Long" : "Short"}</span>
            <span>
              {size} @ {fmt(pos.avg)}
            </span>
            <b className={open >= 0 ? s.pos : s.neg}>{money(open)}</b>
          </>
        ) : (
          <span className={s.dim}>Flat in {inst.code}</span>
        )}
      </div>
    </div>
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
          <Odometer value={money(open)} className={`${s.pnlBig} ${open >= 0 ? s.pos : s.neg}`} delay={0} />
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

const usePip = create<{ open: boolean; tab: Which }>(() => ({ open: false, tab: "instant" }));
let pipRoot: Root | null = null;

function PipApp() {
  const tab = usePip((st) => st.tab);
  const sym = useDesk((st) => st.settings.sym);
  const [nudge, setNudge] = useState(0);
  const locked = useCallback(() => setNudge((n) => n + 1), []);
  return (
    <div className={s.pipApp}>
      <header className={s.pipHead}>
        <div className={s.pipTabs} role="tablist">
          {(["instant", "pnl"] as const).map((w) => (
            <button key={w} type="button" role="tab" aria-selected={tab === w} onClick={() => usePip.setState({ tab: w })}>
              {w === "instant" ? "Instant" : "Live P&L"}
            </button>
          ))}
        </div>
        <span className={s.pipSym}>{INSTRUMENTS[sym].code}</span>
        <Lock nudge={nudge} />
      </header>
      {tab === "instant" ? <InstantBody onLocked={locked} compact /> : <PnlBody onLocked={locked} compact />}
    </div>
  );
}

async function popOut(tab: Which) {
  const api = docPip();
  if (!api) return false;
  usePip.setState({ tab });
  if (api.window) {
    api.window.focus();
    return true;
  }
  const w = await api.requestWindow({ width: 300, height: tab === "instant" ? 268 : 214 });
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
const W: Record<Which, number> = { instant: 300, pnl: 288, notes: 356 };
const KEY = (id: Which) => `altron-float-${id}-v3`;

/** First placement: notes at the top left of the chart, the trading panels at its
 * bottom left, clear of the live candle, the price axis and the ticket. */
function defaultAnchor(id: Which): Anchor {
  const plot = document.querySelector("[data-plot]")?.getBoundingClientRect();
  if (!plot) return id === "notes" ? { ax: "l", ay: "t", x: 24, y: 160 } : { ax: "r", ay: "b", x: id === "instant" ? 24 : 24 + W.instant + 12, y: 24 };
  const x = Math.round(plot.left + 16);
  const y = Math.round(window.innerHeight - plot.bottom + 38);
  if (id === "notes") return { ax: "l", ay: "t", x, y: Math.round(plot.top + 38) };
  if (id === "pnl") return { ax: "l", ay: "b", x, y };
  return { ax: "l", ay: "b", x: x + W.pnl + 12, y };
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

function Floating({ id, title, children, nudge, onClose, extra }: { id: Which; title: string; children: ReactNode; nudge?: number; onClose: () => void; extra?: ReactNode }) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [box, setBox] = useState({ h: 0, vw: 0, vh: 0 });
  const [drag, setDrag] = useState<{ left: number; top: number } | null>(null);
  const [gear, setGear] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<{ px: number; py: number; left: number; top: number } | null>(null);
  const live = useRef<{ left: number; top: number } | null>(null);
  const canPop = !!docPip();
  const w = W[id];
  const placed = anchor !== null;

  useEffect(() => setAnchor(loadAnchor(id)), [id]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox({ h: el.offsetHeight, vw: window.innerWidth, vh: window.innerHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [placed]);

  const clampX = (l: number) => Math.max(8, Math.min(box.vw - w - 8, l));
  const clampY = (t: number) => Math.max(8, Math.min(box.vh - box.h - 8, t));
  let left = 0;
  let top = 0;
  if (drag) {
    left = drag.left;
    top = drag.top;
  } else if (anchor) {
    left = clampX(anchor.ax === "l" ? anchor.x : box.vw - w - anchor.x);
    top = clampY(anchor.ay === "t" ? anchor.y : box.vh - box.h - anchor.y);
  }

  const down = (e: React.PointerEvent) => {
    if ((e.target as Element).closest("button, input")) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    start.current = { px: e.clientX, py: e.clientY, left, top };
    live.current = { left, top };
    setDrag({ left, top });
  };
  const move = (e: React.PointerEvent) => {
    const st = start.current;
    if (!st) return;
    const next = { left: clampX(st.left + e.clientX - st.px), top: clampY(st.top + e.clientY - st.py) };
    live.current = next;
    setDrag(next);
  };
  const up = () => {
    const d = live.current;
    if (!start.current || !d) return;
    start.current = null;
    live.current = null;
    const ax = d.left + w / 2 < box.vw / 2 ? "l" : "r";
    const ay = d.top + box.h / 2 < box.vh / 2 ? "t" : "b";
    let x = ax === "l" ? d.left : box.vw - w - d.left;
    let y = ay === "t" ? d.top : box.vh - box.h - d.top;
    // settle against an edge when dropped close to one
    if (x < 40) x = 16;
    if (y < 40) y = 16;
    const next: Anchor = { ax, ay, x: Math.round(x), y: Math.round(y) };
    setAnchor(next);
    setDrag(null);
    try {
      localStorage.setItem(KEY(id), JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  if (!anchor) return null;
  return (
    <div
      ref={ref}
      className={`${s.float} ${box.h ? s.floatPlaced : ""} ${drag ? s.floatDrag : ""}`}
      style={{ transform: `translate3d(${left}px, ${top}px, 0)`, width: w } as CSSProperties}
      role="dialog"
      aria-label={title}
    >
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
          {id === "instant" && (
            <button type="button" className={s.fBtn} aria-pressed={gear} onClick={() => setGear((v) => !v)} title="Button sizes" aria-label="Button sizes">
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
                <path
                  d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
          {canPop && id !== "notes" && (
            <button type="button" className={s.fBtn} onClick={() => popOut(id)} title="Pop out over other windows" aria-label="Pop out">
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
      {gear && id === "instant" ? <Sizes onDone={() => setGear(false)} /> : children}
    </div>
  );
}

/** Floating panels for the whole trader area, plus the pop-out window. */
export function FloatLayer() {
  const ready = useDesk((st) => st.ready);
  const panels = useDesk((st) => st.settings.panels);
  const notesOpen = useDesk((st) => st.notesOpen);
  const pip = usePip();
  const [nudge, setNudge] = useState(0);
  const locked = useCallback(() => setNudge((n) => n + 1), []);
  if (!ready) return null;
  return (
    <div className={s.floatLayer}>
      {notesOpen && (
        <Floating id="notes" title="Notes" onClose={() => toggleNotes(false)} extra={<span className={s.members}>Members see these</span>}>
          <div className={s.notesBody}>
            <Thread autoFocus />
          </div>
        </Floating>
      )}
      {panels.instant && !(pip.open && pip.tab === "instant") && (
        <Floating id="instant" title="Instant" nudge={nudge} onClose={() => togglePanel("instant", false)}>
          <InstantBody onLocked={locked} />
        </Floating>
      )}
      {panels.pnl && !(pip.open && pip.tab === "pnl") && (
        <Floating id="pnl" title="Live P&L" nudge={nudge} onClose={() => togglePanel("pnl", false)}>
          <PnlBody onLocked={locked} />
        </Floating>
      )}
    </div>
  );
}
