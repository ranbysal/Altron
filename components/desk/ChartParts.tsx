"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { fmt } from "@/lib/format";
import { INSTRUMENTS, type Sym } from "@/lib/desk/instruments";
import { setSettings, useDesk } from "@/lib/desk/store";
import { TOOL_NAMES, setTool, toggleDraw, useDraw, type Tool } from "@/lib/desk/drawings";
import s from "./desk.module.css";

/* ------------------------------------------------------------------ */
/* icons, drawn to sit with the rest of the desk's line work           */
/* ------------------------------------------------------------------ */

const I = ({ children }: { children: ReactNode }) => (
  <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

const ICONS: Record<Tool | "magnet" | "keep" | "locked" | "hidden" | "trash", ReactNode> = {
  cursor: (
    <I>
      <path d="M9 2.5v13M2.5 9h13" />
      <circle cx="9" cy="9" r="1.2" fill="currentColor" stroke="none" />
    </I>
  ),
  trend: (
    <I>
      <path d="M3.5 14.5 14.5 3.5" />
      <circle cx="3.5" cy="14.5" r="1.6" fill="var(--rail-bg)" />
      <circle cx="14.5" cy="3.5" r="1.6" fill="var(--rail-bg)" />
    </I>
  ),
  ray: (
    <I>
      <path d="M3.5 13 16 4" />
      <circle cx="3.5" cy="13" r="1.6" fill="var(--rail-bg)" />
      <circle cx="9.5" cy="8.7" r="1.6" fill="var(--rail-bg)" />
    </I>
  ),
  hline: (
    <I>
      <path d="M2 9h14" />
      <circle cx="9" cy="9" r="1.6" fill="var(--rail-bg)" />
      <path d="M2 4.5h4M12 13.5h4" opacity=".45" />
    </I>
  ),
  vline: (
    <I>
      <path d="M9 2v14" strokeDasharray="2 2" />
      <circle cx="9" cy="9" r="1.6" fill="var(--rail-bg)" />
    </I>
  ),
  rect: (
    <I>
      <rect x="3" y="5" width="12" height="8" rx="1" />
      <circle cx="3" cy="5" r="1.4" fill="var(--rail-bg)" />
      <circle cx="15" cy="13" r="1.4" fill="var(--rail-bg)" />
    </I>
  ),
  fib: (
    <I>
      <path d="M3 3.5h12M3 7h12M3 10h12M3 14.5h12" />
      <path d="M3 3.5v11" opacity=".5" />
    </I>
  ),
  brush: (
    <I>
      <path d="M3 14c2.5 0 2.5-3 5-3s2.5 2 4.5 1.5S15 9 15 7" />
      <path d="M12.8 3.2 15 5.4" />
    </I>
  ),
  text: (
    <I>
      <path d="M4 4.5h10M9 4.5v10M7 14.5h4" />
    </I>
  ),
  arrow: (
    <I>
      <path d="M9 15V4.5M5 8.5l4-4 4 4" />
    </I>
  ),
  measure: (
    <I>
      <path d="m3.5 11.5 8-8 3 3-8 8z" />
      <path d="m6 9 1.5 1.5M8 7l1 1M10 5l1.5 1.5" />
    </I>
  ),
  zoom: (
    <I>
      <circle cx="7.8" cy="7.8" r="4.6" />
      <path d="m11.3 11.3 3.6 3.6M7.8 5.8v4M5.8 7.8h4" />
    </I>
  ),
  magnet: (
    <I>
      <path d="M4.5 4v5a4.5 4.5 0 0 0 9 0V4" />
      <path d="M4.5 6.5h3M10.5 6.5h3" />
      <path d="M7.5 4v5a1.5 1.5 0 0 0 3 0V4" />
    </I>
  ),
  keep: (
    <I>
      <path d="m10.5 4.5 3 3-7 7H3.5v-3z" />
      <path d="M12 9.5v-2.5M12 4V2.8" opacity=".4" />
      <rect x="11" y="11.5" width="5" height="4" rx=".8" />
      <path d="M12.2 11.5v-1a1.3 1.3 0 0 1 2.6 0v1" />
    </I>
  ),
  locked: (
    <I>
      <rect x="4" y="8" width="10" height="7" rx="1.5" />
      <path d="M6.5 8V6a2.5 2.5 0 0 1 5 0v2" />
    </I>
  ),
  hidden: (
    <I>
      <path d="M2 9s2.6-4.5 7-4.5S16 9 16 9s-2.6 4.5-7 4.5S2 9 2 9Z" />
      <circle cx="9" cy="9" r="2" />
    </I>
  ),
  trash: (
    <I>
      <path d="M3.5 5h11M7 5V3.5h4V5M5 5l.8 9.5h6.4L13 5" />
    </I>
  ),
};

const GROUPS: Tool[][] = [["cursor"], ["trend", "ray"], ["hline", "vline"], ["rect", "fib"], ["brush", "text", "arrow"], ["measure", "zoom"]];

/** The drawing tools, down the left side of the chart. */
export function ToolRail({ onClear, count }: { onClear: () => void; count: number }) {
  const tool = useDraw((st) => st.tool);
  const magnet = useDraw((st) => st.magnet);
  const keep = useDraw((st) => st.keep);
  const locked = useDraw((st) => st.locked);
  const hidden = useDraw((st) => st.hidden);
  const toggles: { key: "magnet" | "keep" | "locked" | "hidden"; on: boolean; name: string }[] = [
    { key: "magnet", on: magnet, name: "Magnet: snap to open, high, low and close" },
    { key: "keep", on: keep, name: "Stay in drawing mode" },
    { key: "locked", on: locked, name: "Lock all drawings" },
    { key: "hidden", on: hidden, name: hidden ? "Show drawings" : "Hide all drawings" },
  ];
  return (
    <div className={s.rail} role="toolbar" aria-label="Drawing tools" aria-orientation="vertical">
      {GROUPS.map((g, k) => (
        <div key={k} className={s.railGroup}>
          {g.map((t) => (
            <button key={t} type="button" className={s.railBtn} aria-pressed={tool === t} onClick={() => setTool(tool === t && t !== "cursor" ? "cursor" : t)} data-tip={TOOL_NAMES[t]} aria-label={TOOL_NAMES[t]}>
              {ICONS[t]}
            </button>
          ))}
        </div>
      ))}
      <div className={s.railGroup}>
        {toggles.map((x) => (
          <button key={x.key} type="button" className={s.railBtn} aria-pressed={x.on} onClick={() => toggleDraw(x.key)} data-tip={x.name} aria-label={x.name}>
            {ICONS[x.key]}
          </button>
        ))}
      </div>
      <div className={s.railGroup}>
        <button type="button" className={`${s.railBtn} ${s.railDanger}`} onClick={onClear} disabled={!count} data-tip={count ? `Remove ${count} drawing${count > 1 ? "s" : ""}` : "No drawings"} aria-label="Remove all drawings">
          {ICONS.trash}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* right-click menu                                                    */
/* ------------------------------------------------------------------ */

export type MenuAt = { x: number; y: number; price: number; t: number; label: string };

export function ChartMenu({
  at,
  sym,
  onClose,
  onCopy,
  onOrder,
  onAlert,
  onHLine,
  onVLine,
  onClear,
  onReset,
  onSettings,
  drawings,
}: {
  at: MenuAt;
  sym: Sym;
  onClose: () => void;
  onCopy: () => void;
  onOrder: (side: 1 | -1, kind: "LMT" | "STP") => void;
  onAlert: () => void;
  onHLine: () => void;
  onVLine: () => void;
  onClear: () => void;
  onReset: () => void;
  onSettings: () => void;
  drawings: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useDesk((st) => st.quotes[sym].last);
  const qty = useDesk((st) => st.settings.qty[sym]);
  const code = INSTRUMENTS[sym].code;
  const px = fmt(at.price);
  const above = at.price >= last;

  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  // keep the menu inside the chart
  useEffect(() => {
    const el = ref.current;
    const host = el?.offsetParent as HTMLElement | null;
    if (!el || !host) return;
    const x = Math.min(at.x, host.clientWidth - el.offsetWidth - 8);
    const y = at.y + el.offsetHeight > host.clientHeight - 8 ? Math.max(8, at.y - el.offsetHeight) : at.y;
    el.style.transform = `translate(${Math.max(8, x)}px, ${y}px)`;
  }, [at]);

  const item = (label: ReactNode, run: () => void, hint?: string, tone?: "pos" | "neg") => (
    <button
      type="button"
      role="menuitem"
      className={tone === "pos" ? s.mPos : tone === "neg" ? s.mNeg : undefined}
      onClick={() => {
        run();
        onClose();
      }}
    >
      <span>{label}</span>
      {hint && <kbd>{hint}</kbd>}
    </button>
  );

  return (
    <div
      ref={ref}
      className={s.cmenu}
      role="menu"
      style={{ transform: `translate(${at.x}px, ${at.y}px)` }}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {item(<>Copy price {px}</>, onCopy)}
      <hr />
      {above
        ? item(<>Sell {qty} {code} @ {px} limit</>, () => onOrder(-1, "LMT"), undefined, "neg")
        : item(<>Buy {qty} {code} @ {px} limit</>, () => onOrder(1, "LMT"), undefined, "pos")}
      {above ? item(<>Buy {qty} {code} @ {px} stop</>, () => onOrder(1, "STP"), undefined, "pos") : item(<>Sell {qty} {code} @ {px} stop</>, () => onOrder(-1, "STP"), undefined, "neg")}
      {item(<>Add alert at {px}</>, onAlert)}
      <hr />
      {item(<>Horizontal line at {px}</>, onHLine)}
      {item(<>Lock vertical line at {at.label}</>, onVLine)}
      {drawings > 0 && item(<>Remove {drawings} drawing{drawings > 1 ? "s" : ""}</>, onClear)}
      {item("Reset chart view", onReset, "Dbl-click")}
      <hr />
      {item("Settings…", onSettings)}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* chart settings                                                      */
/* ------------------------------------------------------------------ */

export function ChartSettings({ onClose }: { onClose: () => void }) {
  const chart = useDesk((st) => st.settings.chart);
  const sizes = useDesk((st) => st.settings.sizes);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [onClose]);
  const rows: { key: keyof typeof chart; label: string; sub: string }[] = [
    { key: "volume", label: "Volume", sub: "Slats along the bottom" },
    { key: "fills", label: "Fills", sub: "Arrows where orders filled" },
    { key: "zone", label: "Position zone", sub: "Shading from entry to price" },
    { key: "grid", label: "Grid", sub: "Price lines across the chart" },
    { key: "log", label: "Log scale", sub: "Even spacing for percent moves" },
  ];
  const edit = (kind: "mini" | "micro", i: number, v: string) => {
    const n = Math.max(1, Math.min(99, parseInt(v, 10) || 1));
    setSettings({ sizes: { ...sizes, [kind]: sizes[kind].map((x, k) => (k === i ? n : x)) } });
  };
  return (
    <div ref={ref} className={s.csettings} role="dialog" aria-label="Chart settings" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
      <header>
        <span className={s.label}>Chart</span>
        <button type="button" className={s.keysX} onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      {rows.map((r) => (
        <label key={r.key} className={s.csRow}>
          <span>
            {r.label}
            <em>{r.sub}</em>
          </span>
          <button type="button" role="switch" aria-checked={chart[r.key]} className={s.switch} onClick={() => setSettings({ chart: { ...chart, [r.key]: !chart[r.key] } })} />
        </label>
      ))}
      <div className={s.csSizes}>
        <span className={s.label}>Size presets</span>
        {(["mini", "micro"] as const).map((kind) => (
          <div key={kind} className={s.sizesRow}>
            <span>{kind === "mini" ? "Minis" : "Micros"}</span>
            {sizes[kind].map((n, i) => (
              <input key={`${kind}${i}${n}`} inputMode="numeric" aria-label={`${kind} size ${i + 1}`} defaultValue={n} onBlur={(e) => edit(kind, i, e.target.value)} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
