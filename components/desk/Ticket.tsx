"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";
import { fmt, money } from "@/lib/format";
import { DAY_MARGIN, INSTRUMENTS, snap, tickValue } from "@/lib/desk/instruments";
import {
  EXIT_ON,
  EXIT_UNITS,
  openPnl,
  sendTicket,
  setExitUnits,
  setExitValue,
  setPick,
  setPreview,
  setSettings,
  setTicket,
  sizeWords,
  ticketEntry,
  ticketExits,
  ticketProblem,
  useDesk,
  type ExitUnit,
  type ExitWhich,
  type OrderType,
  type Side,
} from "@/lib/desk/store";
import { Odometer } from "@/components/trader/parts";
import { BAYER4 } from "@/lib/noise";
import s from "./desk.module.css";

let ditherUrl: string | null = null;

/** White pixels in Bayer order, densest in the bottom right corner. */
function dither(): string {
  if (ditherUrl) return ditherUrl;
  const W = 180;
  const H = 84;
  const cell = 3;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  if (!g) return "";
  g.fillStyle = "#fff";
  for (let y = 0; y < H; y += cell) {
    for (let x = 0; x < W; x += cell) {
      // a quarter ellipse tucked into the corner, clear of the price
      const I = Math.max(0, 1 - Math.hypot((W - x) / 58, (H - y) / 80));
      if (I * 0.92 > (BAYER4[((y / cell) & 3) * 4 + ((x / cell) & 3)] + 0.5) / 16) g.fillRect(x, y, 2, 2);
    }
  }
  ditherUrl = c.toDataURL();
  return ditherUrl;
}

/** Dollars for the facts box: whole dollars, with six figures and up shortened (K, M) so a big size never crowds its neighbour. The full amount is in the tooltip. */
function usd(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e5) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  return `${sign}$${fmt(a, 0)}`;
}

const TYPES: { id: OrderType; label: string }[] = [
  { id: "MKT", label: "Market" },
  { id: "LMT", label: "Limit" },
  { id: "STP", label: "Stop" },
];

/** A number with a minus and a plus either side. Typing works; arrow keys step. */
function Stepper({ value, onChange, step, min = 0, label, unit, digits }: { value: number; onChange: (v: number) => void; step: number; min?: number; label: string; unit?: string; digits?: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (digits !== undefined ? value.toFixed(digits) : String(value));
  const commit = () => {
    if (draft === null) return;
    const v = parseFloat(draft.replace(/,/g, ""));
    if (Number.isFinite(v)) onChange(Math.max(min, v));
    setDraft(null);
  };
  const bump = (d: number) => onChange(Math.max(min, +(value + d).toFixed(4)));
  return (
    <div className={s.stepper}>
      <button type="button" tabIndex={-1} aria-label={`Less ${label}`} onClick={() => bump(-step)}>
        <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1.5 5h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      <input
        aria-label={label}
        inputMode="decimal"
        value={shown}
        onFocus={(e) => {
          setDraft(shown);
          e.currentTarget.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(null);
            e.currentTarget.blur();
          }
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            setDraft(null);
            bump(e.key === "ArrowUp" ? step : -step);
          }
        }}
      />
      {unit && <span className={s.stepUnit}>{unit}</span>}
      <button type="button" tabIndex={-1} aria-label={`More ${label}`} onClick={() => bump(step)}>
        <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1.5 5h7M5 1.5v7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

function PickBtn({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button type="button" className={s.pickBtn} aria-pressed={on} onClick={onClick} title="Pick the price on the chart" aria-label="Pick the price on the chart">
      <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <path d="M8 0.8v3.6M8 11.6v3.6M0.8 8h3.6M11.6 8h3.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    </button>
  );
}

/** A number field that's typed into freely and committed on Enter or blur; arrows step it. */
function NumField({ value, text, onCommit, step, label, disabled, invalid }: { value: number; text: string; onCommit: (v: number) => void; step: number; label: string; disabled?: boolean; invalid?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const v = parseFloat(draft.replace(/[,$\s]/g, "").replace(/^[+−-]/, (m) => (m === "−" ? "-" : m)));
    if (Number.isFinite(v)) onCommit(v);
    setDraft(null);
  };
  return (
    <input
      className={s.numIn}
      aria-label={label}
      aria-invalid={invalid || undefined}
      inputMode="decimal"
      disabled={disabled}
      value={draft ?? text}
      onFocus={(e) => {
        setDraft(text);
        e.currentTarget.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(null);
          e.currentTarget.blur();
        }
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          setDraft(null);
          onCommit(+(value + (e.key === "ArrowUp" ? step : -step)).toFixed(6));
        }
      }}
    />
  );
}

const SwapIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 5.5h10M10.5 3 13 5.5 10.5 8M13 10.5H3M5.5 8 3 10.5 5.5 13" />
  </svg>
);
const Caret = () => (
  <svg width="8" height="8" viewBox="0 0 10 10" aria-hidden="true">
    <path d="M2 3.8l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** A stop loss or take profit: on or off, typed in one unit, read back in another. */
function ExitRow({ which, entry, price }: { which: ExitWhich; entry: number; price: number | null }) {
  const sym = useDesk((st) => st.settings.sym);
  const on = useDesk((st) => st.settings[EXIT_ON[which]]);
  const units = useDesk((st) => st.settings.exitUnits[which]);
  const qty = useDesk((st) => st.settings.qty[st.settings.sym]);
  const inst = INSTRUMENTS[sym];
  const tv = tickValue(sym);
  const [main, alt] = units;
  const dist = price === null ? 0 : Math.abs(price - entry);
  const ticks = Math.round(dist / inst.tick);
  const sign = which === "stop" ? -1 : 1;
  const valueIn = (u: ExitUnit) => (u === "price" ? (price ?? entry) : u === "ticks" ? ticks : u === "pts" ? dist : ticks * tv * qty);
  const textIn = (u: ExitUnit) => (u === "price" ? fmt(price ?? entry) : u === "ticks" ? String(ticks) : u === "pts" ? dist.toFixed(2) : (ticks * tv * qty).toFixed(2));
  const readback = (u: ExitUnit) =>
    u === "price" ? fmt(price ?? entry) : u === "ticks" ? `${ticks} ticks` : u === "pts" ? `${dist.toFixed(2)} pts` : money(sign * ticks * tv * qty);
  const step = main === "price" ? inst.tick : main === "ticks" ? 1 : main === "pts" ? inst.tick : tv * qty;
  const name = which === "stop" ? "Stop loss" : which === "target2" ? "Second target" : "Take profit";
  const unitLabel = (u: ExitUnit) => EXIT_UNITS.find((x) => x.id === u)!.label;
  return (
    <div className={s.exit} data-off={on ? undefined : ""} data-kind={which}>
      <div className={s.exitHead}>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          className={s.miniSwitch}
          aria-label={`Attach a ${name.toLowerCase()}`}
          onClick={() => setSettings({ [EXIT_ON[which]]: !on })}
        />
        <span className={s.exitName}>{name}</span>
        <label className={s.unitPick}>
          {unitLabel(main)}
          <Caret />
          <select aria-label={`${name}: type it in`} value={main} onChange={(e) => {
            const u = e.target.value as ExitUnit;
            setExitUnits(which, [u, u === alt ? main : alt]);
          }}>
            {EXIT_UNITS.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={s.exitField}>
        <NumField
          label={`${name} in ${unitLabel(main).toLowerCase()}`}
          value={valueIn(main)}
          text={textIn(main)}
          step={step}
          disabled={!on}
          onCommit={(v) => setExitValue(which, main, v)}
        />
        {main !== "price" && <span className={s.numUnit}>{main === "ticks" ? "ticks" : main === "pts" ? "pts" : "USD"}</span>}
        <button type="button" className={s.swapBtn} disabled={!on} onClick={() => setExitUnits(which, [alt, main])} aria-label={`Type the ${name.toLowerCase()} in ${unitLabel(alt).toLowerCase()} instead`} title="Swap">
          <SwapIcon />
        </button>
        <label className={`${s.altPick} ${main !== "price" ? "" : which === "stop" ? s.neg : s.pos}`}>
          <span>{readback(alt)}</span>
          <Caret />
          <select aria-label={`${name}: read back as`} value={alt} disabled={!on} onChange={(e) => setExitUnits(which, [main, e.target.value as ExitUnit])}>
            {EXIT_UNITS.filter((u) => u.id !== main).map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

const Bell = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 11V7.2a4 4 0 0 1 8 0V11l1.3 1.5H2.7z" />
    <path d="M6.6 14.2a1.6 1.6 0 0 0 2.8 0" />
  </svg>
);

/** Before the order goes, a note for members to read with it. */
function NotifyPop({ onClose }: { onClose: () => void }) {
  const sym = useDesk((st) => st.settings.sym);
  const t = useDesk((st) => st.ticket);
  const qty = useDesk((st) => st.settings.qty[st.settings.sym]);
  const entry = useDesk((st) => ticketEntry(st, st.settings.sym));
  const [stop, target, target2] = useDesk(useShallow((st) => { const e = ticketExits(st, st.settings.sym); return [e.stop, e.target, e.target2]; }));
  const problem = useDesk((st) => ticketProblem(st, st.settings.sym));
  const [note, setNote] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => area.current?.focus());
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("keydown", key, true);
    };
  }, [onClose]);
  const verb = t.side > 0 ? "Buy" : "Sell";
  const go = () => {
    if (problem) return;
    sendTicket({ note });
    onClose();
  };
  const exits = [stop !== null ? `Stop ${fmt(stop)}` : "", target !== null ? (target2 !== null && qty >= 2 ? `Targets ${fmt(target)} and ${fmt(target2)}` : `Target ${fmt(target)}`) : ""].filter(Boolean).join(" · ");
  return (
    <div className={s.notifyPop} role="dialog" aria-label="Notify members">
      <header>
        <span className={s.label}>Notify members</span>
        <button type="button" className={s.keysX} onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      <div className={s.notifyCard}>
        <b>
          {verb} {sizeWords(sym, qty)} {t.type === "MKT" ? "at market" : `${t.type === "LMT" ? "limit" : "stop"} @ ${fmt(entry)}`}
        </b>
        <span>{exits || "No stop or target"}</span>
        <em>Sent with the time, to the second</em>
      </div>
      <textarea
        ref={area}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Add a note for members (optional)"
        maxLength={600}
        rows={3}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) go();
        }}
      />
      <button type="button" className={`${s.send} ${t.side > 0 ? s.sendBuy : s.sendSell}`} disabled={!!problem} onClick={go}>
        <b>{verb} and notify</b>
        <span>{problem ?? (typeof navigator !== "undefined" && /Mac|iP/.test(navigator.platform) ? "⌘ Enter" : "Ctrl Enter")}</span>
      </button>
    </div>
  );
}

export function Ticket() {
  const sym = useDesk((st) => st.settings.sym);
  const settings = useDesk((st) => st.settings);
  const ticket = useDesk((st) => st.ticket);
  const quote = useDesk((st) => st.quotes[sym]);
  const pick = useDesk((st) => st.pick);
  const positions = useDesk((st) => st.positions);
  const trades = useDesk((st) => st.trades);
  const quotes = useDesk((st) => st.quotes);
  const entry = useDesk((st) => ticketEntry(st, st.settings.sym));
  const [stopPx, targetPx, target2Px] = useDesk(useShallow((st) => { const e = ticketExits(st, st.settings.sym); return [e.stop, e.target, e.target2]; }));
  const targetOn = useDesk((st) => st.settings.targetOn);
  const problem = useDesk((st) => ticketProblem(st, st.settings.sym));
  const inst = INSTRUMENTS[sym];
  const qty = settings.qty[sym];
  const sizes = inst.micro ? settings.sizes.micro : settings.sizes.mini;
  const tv = tickValue(sym);
  const t = ticket.type;
  const side = ticket.side;
  const [tex, setTex] = useState<string | null>(null);
  const [notify, setNotify] = useState(false);
  const start = useDesk((st) => st.start);
  const owner = useDesk((st) => st.seat === "owner");
  useEffect(() => setTex(dither()), []);
  useEffect(() => setNotify(false), [sym]);

  // a fresh price each time: resting on its own side of the market
  const setType = (type: OrderType) => {
    setPick(null);
    const tk = inst.tick;
    if (type === "LMT") setTicket({ type, limit: snap(sym, side > 0 ? quote.bid - 4 * tk : quote.ask + 4 * tk) });
    else if (type === "STP") setTicket({ type, stop: snap(sym, side > 0 ? quote.ask + 10 * tk : quote.bid - 10 * tk) });
    else setTicket({ type });
  };

  // turning the ticket round: a working price that would now fill at once is mirrored across the market
  const setSide = (next: Side) => {
    if (next === side) return;
    const mid = (quote.bid + quote.ask) / 2;
    const flip = (p: number | null) => (p === null ? p : snap(sym, 2 * mid - p));
    const patch: Partial<typeof ticket> = { side: next, stopPx: null, targetPx: null, target2Px: null, pxSym: null };
    if (t === "LMT" && ticket.limit !== null && (next > 0 ? ticket.limit >= quote.ask : ticket.limit <= quote.bid)) patch.limit = flip(ticket.limit);
    if (t === "STP" && ticket.stop !== null && (next > 0 ? ticket.stop <= quote.ask : ticket.stop >= quote.bid)) patch.stop = flip(ticket.stop);
    setTicket(patch);
  };

  const ti = TYPES.findIndex((x) => x.id === t);
  const notional = entry * inst.pv * qty;
  const used = Object.values(positions).reduce((a, p) => a + (p ? Math.abs(p.qty) * DAY_MARGIN[p.sym] : 0), 0);
  const equity = start + trades.reduce((a, x) => a + x.pnl, 0) + openPnl({ positions, quotes });
  const avail = equity - used;
  const rr = stopPx !== null && targetPx !== null && Math.abs(entry - stopPx) > 0 ? Math.abs(targetPx - entry) / Math.abs(entry - stopPx) : null;

  const touch = side > 0 ? quote.ask : quote.bid;
  const off = Math.round((entry - touch) / inst.tick);
  const priceBad = t === "STP" && problem !== null && /stop goes/.test(problem);
  const hover = (h: 0 | Side) => ({
    onMouseEnter: () => setPreview(h),
    onMouseLeave: () => setPreview(0),
    onFocus: () => setPreview(h),
    onBlur: () => setPreview(0),
  });
  const what = t === "MKT" ? `${qty} ${inst.code} market` : `${qty} ${inst.code} @ ${fmt(entry)} ${t === "LMT" ? "limit" : "stop"}`;

  return (
    <div className={s.ticket}>
      <div className={s.deal} style={tex ? ({ "--dither": `url(${tex})` } as CSSProperties) : undefined}>
        <button type="button" className={`${s.dealBtn} ${s.dealSell}`} aria-pressed={side < 0} onClick={() => setSide(-1)} disabled={!quote.last} {...hover(-1)} aria-label="Sell side">
          <span className={s.dealTop}>Sell</span>
          <Odometer value={fmt(quote.bid)} className={s.dealPx} delay={0} />
        </button>
        <button type="button" className={`${s.dealBtn} ${s.dealBuy}`} aria-pressed={side > 0} onClick={() => setSide(1)} disabled={!quote.last} {...hover(1)} aria-label="Buy side">
          <span className={s.dealTop}>Buy</span>
          <Odometer value={fmt(quote.ask)} className={s.dealPx} delay={0} />
        </button>
        <span className={s.spread}>{((quote.ask - quote.bid) / inst.tick).toFixed(0)} tick</span>
      </div>

      <div className={s.types} role="tablist" aria-label="Order type" style={{ "--i": ti, "--n": TYPES.length } as CSSProperties}>
        <span className={s.typePill} aria-hidden="true" />
        {TYPES.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={x.id === t} onClick={() => setType(x.id)}>
            {x.label}
          </button>
        ))}
      </div>

      {t !== "MKT" && (
        <div className={s.tRow}>
          <span className={s.tLabel}>Price</span>
          <div className={s.pxField} data-bad={priceBad ? "" : undefined}>
            <NumField
              label={t === "LMT" ? "Limit price" : "Stop price"}
              value={entry}
              text={fmt(entry)}
              step={inst.tick}
              invalid={priceBad}
              onCommit={(v) => setTicket(t === "LMT" ? { limit: snap(sym, v) } : { stop: snap(sym, v) })}
            />
            <span className={s.pxRef} title={`Distance from the ${side > 0 ? "ask" : "bid"}, in ticks`}>
              {side > 0 ? "Ask" : "Bid"} {off >= 0 ? "+" : "−"} {Math.abs(off)}
            </span>
          </div>
          <PickBtn on={pick === (t === "LMT" ? "limit" : "stop")} onClick={() => setPick(pick ? null : t === "LMT" ? "limit" : "stop")} />
        </div>
      )}

      <div className={s.tRow}>
        <span className={s.tLabel}>Qty</span>
        <Stepper label="Quantity" value={qty} step={1} min={1} onChange={(v) => setSettings({ qty: { ...settings.qty, [sym]: Math.max(1, Math.round(v)) } })} />
        <div className={s.chips}>
          {sizes.map((n) => (
            <button key={n} type="button" className={s.chipBtn} aria-pressed={n === qty} onClick={() => setSettings({ qty: { ...settings.qty, [sym]: n } })}>
              {n}
            </button>
          ))}
        </div>
      </div>

      <dl className={s.facts}>
        <div>
          <dt>Value ×{inst.pv}</dt>
          <dd title={`$${fmt(notional, 0)}`}>{usd(notional)}</dd>
        </div>
        <div>
          <dt>Margin</dt>
          <dd title={`$${fmt(DAY_MARGIN[sym] * qty, 0)}`}>{usd(DAY_MARGIN[sym] * qty)}</dd>
        </div>
        <div>
          <dt>Available</dt>
          <dd title={`$${fmt(avail, 0)}`} className={avail < DAY_MARGIN[sym] * qty ? s.neg : undefined}>{usd(avail)}</dd>
        </div>
        <div>
          <dt>Tick</dt>
          <dd>${fmt(tv)}</dd>
        </div>
      </dl>

      <div className={s.exits}>
        <div className={s.bracketHead}>
          <span className={s.tLabel}>Exits</span>
          {rr !== null && <span className={s.rr}>{rr.toFixed(2)}R</span>}
        </div>
        <ExitRow which="target" entry={entry} price={targetPx} />
        {targetOn && <ExitRow which="target2" entry={entry} price={target2Px} />}
        <ExitRow which="stop" entry={entry} price={stopPx} />
      </div>

      <div className={s.sendRow}>
        <button type="button" className={`${s.send} ${side > 0 ? s.sendBuy : s.sendSell}`} disabled={!!problem} onClick={() => sendTicket()} {...hover(t === "MKT" ? side : 0)}>
          <b>{side > 0 ? "Buy" : "Sell"}</b>
          <span>{problem ?? what}</span>
        </button>
        {!owner && (
          <button type="button" className={s.notifyBtn} aria-pressed={notify} aria-label="Send with a notification to members" title="Notify members" onClick={() => setNotify((n) => !n)}>
            <Bell />
          </button>
        )}
        {notify && !owner && <NotifyPop onClose={() => setNotify(false)} />}
      </div>
    </div>
  );
}
