"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { fmt } from "@/lib/format";
import { INSTRUMENTS, snap, tickValue } from "@/lib/desk/instruments";
import { placeOrder, setPick, setSettings, setTicket, useDesk, type OrderType, type Side } from "@/lib/desk/store";
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

const TYPES: { id: OrderType; label: string; name: string }[] = [
  { id: "MKT", label: "Mkt", name: "Market" },
  { id: "LMT", label: "Lmt", name: "Limit" },
  { id: "STP", label: "Stp", name: "Stop" },
  { id: "STPLMT", label: "Stp lmt", name: "Stop limit" },
  { id: "TRAIL", label: "Trail", name: "Trailing stop" },
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

export function Ticket() {
  const sym = useDesk((st) => st.settings.sym);
  const settings = useDesk((st) => st.settings);
  const ticket = useDesk((st) => st.ticket);
  const quote = useDesk((st) => st.quotes[sym]);
  const pick = useDesk((st) => st.pick);
  const inst = INSTRUMENTS[sym];
  const qty = settings.qty[sym];
  const sizes = inst.micro ? settings.sizes.micro : settings.sizes.mini;
  const tv = tickValue(sym);
  const t = ticket.type;
  const [tex, setTex] = useState<string | null>(null);
  useEffect(() => setTex(dither()), []);

  const setType = (type: OrderType) => {
    const last = quote.last;
    setPick(null);
    setTicket({
      type,
      limit: type === "LMT" || type === "STPLMT" ? ticket.limit ?? snap(sym, last) : ticket.limit,
      stop: type === "STP" || type === "STPLMT" ? ticket.stop ?? snap(sym, last + 10 * inst.tick) : ticket.stop,
    });
  };

  const send = (side: Side) => {
    const base = { sym, side, qty, bracket: true };
    if (t === "MKT") placeOrder({ ...base, type: "MKT" });
    else if (t === "LMT" && ticket.limit !== null) placeOrder({ ...base, type: "LMT", limit: ticket.limit });
    else if (t === "STP" && ticket.stop !== null) placeOrder({ ...base, type: "STP", stop: ticket.stop });
    else if (t === "STPLMT" && ticket.stop !== null && ticket.limit !== null) placeOrder({ ...base, type: "STPLMT", stop: ticket.stop, limit: ticket.limit });
    else if (t === "TRAIL") placeOrder({ ...base, type: "TRAIL", trail: ticket.trail });
  };

  const priceFor = (side: Side) => {
    if (t === "MKT") return side > 0 ? quote.ask : quote.bid;
    if (t === "LMT") return ticket.limit ?? quote.last;
    if (t === "STP" || t === "STPLMT") return ticket.stop ?? quote.last;
    return side > 0 ? quote.ask + ticket.trail : quote.bid - ticket.trail;
  };
  const verb = t === "MKT" ? "" : t === "LMT" ? "limit" : t === "STP" ? "stop" : t === "STPLMT" ? "stop lmt" : "trail";

  const stopT = settings.stopTicks[sym];
  const tgtT = settings.targetTicks[sym];
  const risk = stopT * tv * qty;
  const reward = tgtT * tv * qty;
  const ti = TYPES.findIndex((x) => x.id === t);

  return (
    <div className={s.ticket}>
      <div className={s.deal} style={tex ? ({ "--dither": `url(${tex})` } as CSSProperties) : undefined}>
        <button type="button" className={`${s.dealBtn} ${s.dealSell}`} onClick={() => send(-1)} disabled={!quote.last}>
          <span className={s.dealTop}>
            Sell<em>{verb}</em>
          </span>
          <Odometer value={fmt(priceFor(-1))} className={s.dealPx} delay={0} />
        </button>
        <button type="button" className={`${s.dealBtn} ${s.dealBuy}`} onClick={() => send(1)} disabled={!quote.last}>
          <span className={s.dealTop}>
            Buy<em>{verb}</em>
          </span>
          <Odometer value={fmt(priceFor(1))} className={s.dealPx} delay={0} />
        </button>
        <span className={s.spread}>{((quote.ask - quote.bid) / inst.tick).toFixed(0)} tick</span>
      </div>

      <div className={s.types} role="tablist" aria-label="Order type" style={{ "--i": ti, "--n": TYPES.length } as CSSProperties}>
        <span className={s.typePill} aria-hidden="true" />
        {TYPES.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={x.id === t} title={x.name} onClick={() => setType(x.id)}>
            {x.label}
          </button>
        ))}
      </div>

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

      {t !== "MKT" && (
        <div className={s.tRow} key={t}>
          <span className={s.tLabel}>{t === "LMT" ? "Limit" : t === "STP" ? "Stop" : t === "STPLMT" ? "Stop" : "Trail"}</span>
          {t === "LMT" && <Stepper label="Limit price" value={ticket.limit ?? quote.last} step={inst.tick} digits={2} onChange={(v) => setTicket({ limit: snap(sym, v) })} />}
          {(t === "STP" || t === "STPLMT") && <Stepper label="Stop price" value={ticket.stop ?? quote.last} step={inst.tick} digits={2} onChange={(v) => setTicket({ stop: snap(sym, v) })} />}
          {t === "TRAIL" && <Stepper label="Trail distance" value={ticket.trail} step={inst.tick * 4} min={inst.tick} digits={2} unit="pts" onChange={(v) => setTicket({ trail: Math.max(inst.tick, snap(sym, v)) })} />}
          {t !== "TRAIL" && <PickBtn on={pick === (t === "LMT" ? "limit" : "stop")} onClick={() => setPick(pick ? null : t === "LMT" ? "limit" : "stop")} />}
        </div>
      )}
      {t === "STPLMT" && (
        <div className={s.tRow}>
          <span className={s.tLabel}>Limit</span>
          <Stepper label="Limit price" value={ticket.limit ?? quote.last} step={inst.tick} digits={2} onChange={(v) => setTicket({ limit: snap(sym, v) })} />
          <span className={s.pickGap} aria-hidden="true" />
        </div>
      )}

      <div className={s.bracket}>
        <div className={s.bracketHead}>
          <span className={s.tLabel}>Bracket</span>
          {settings.stopOn && settings.targetOn && <span className={s.rr}>{(tgtT / stopT).toFixed(1)}R</span>}
        </div>
        <div className={`${s.bRow} ${settings.stopOn ? "" : s.bOff}`}>
          <button type="button" role="switch" aria-checked={settings.stopOn} className={`${s.bDot} ${s.bDotStop}`} onClick={() => setSettings({ stopOn: !settings.stopOn })} aria-label="Attach a stop" />
          <span className={`${s.bName} ${s.neg}`}>Stop</span>
          <Stepper label="Stop distance in ticks" value={stopT} step={4} min={1} unit="t" onChange={(v) => setSettings({ stopTicks: { ...settings.stopTicks, [sym]: Math.max(1, Math.round(v)) } })} />
          <span className={s.bVal}>
            <em className={s.neg}>−${fmt(risk, 0)}</em>
            {fmt(stopT * inst.tick)} pts
          </span>
        </div>
        <div className={`${s.bRow} ${settings.targetOn ? "" : s.bOff}`}>
          <button type="button" role="switch" aria-checked={settings.targetOn} className={`${s.bDot} ${s.bDotTarget}`} onClick={() => setSettings({ targetOn: !settings.targetOn })} aria-label="Attach a target" />
          <span className={`${s.bName} ${s.pos}`}>Target</span>
          <Stepper label="Target distance in ticks" value={tgtT} step={4} min={1} unit="t" onChange={(v) => setSettings({ targetTicks: { ...settings.targetTicks, [sym]: Math.max(1, Math.round(v)) } })} />
          <span className={s.bVal}>
            <em className={s.pos}>+${fmt(reward, 0)}</em>
            {fmt(tgtT * inst.tick)} pts
          </span>
        </div>
      </div>
    </div>
  );
}
