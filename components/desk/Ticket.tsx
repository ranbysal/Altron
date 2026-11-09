"use client";

import { useState, type CSSProperties } from "react";
import { fmt, money } from "@/lib/format";
import { INSTRUMENTS, snap, tickValue } from "@/lib/desk/instruments";
import { closePercent, flatten, openPnl, placeOrder, setPick, setSettings, setTicket, useDesk, type OrderType, type Side } from "@/lib/desk/store";
import { Odometer } from "@/components/trader/parts";
import s from "./desk.module.css";

const TYPES: { id: OrderType; label: string }[] = [
  { id: "MKT", label: "Market" },
  { id: "LMT", label: "Limit" },
  { id: "STP", label: "Stop" },
  { id: "STPLMT", label: "Stop lmt" },
  { id: "TRAIL", label: "Trail" },
];

function Stepper({ value, onChange, step, min = 0, label, unit }: { value: number; onChange: (v: number) => void; step: number; min?: number; label: string; unit?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (step < 1 ? value.toFixed(2) : String(value));
  const commit = () => {
    if (draft === null) return;
    const v = parseFloat(draft.replace(/,/g, ""));
    if (Number.isFinite(v)) onChange(Math.max(min, v));
    setDraft(null);
  };
  return (
    <div className={s.stepper}>
      <button type="button" tabIndex={-1} aria-label={`Less ${label}`} onClick={() => onChange(Math.max(min, +(value - step).toFixed(2)))}>
        −
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
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            setDraft(null);
            onChange(Math.max(min, +(value + (e.key === "ArrowUp" ? step : -step)).toFixed(2)));
          }
        }}
      />
      {unit && <span className={s.stepUnit}>{unit}</span>}
      <button type="button" tabIndex={-1} aria-label={`More ${label}`} onClick={() => onChange(+(value + step).toFixed(2))}>
        +
      </button>
    </div>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={s.switch} onClick={() => onChange(!on)} />;
}

export function Ticket() {
  const sym = useDesk((st) => st.settings.sym);
  const settings = useDesk((st) => st.settings);
  const ticket = useDesk((st) => st.ticket);
  const quote = useDesk((st) => st.quotes[sym]);
  const pos = useDesk((st) => st.positions[sym]);
  const positions = useDesk((st) => st.positions);
  const quotes = useDesk((st) => st.quotes);
  const pick = useDesk((st) => st.pick);
  const inst = INSTRUMENTS[sym];
  const qty = settings.qty[sym];
  const sizes = inst.micro ? settings.sizes.micro : settings.sizes.mini;
  const tv = tickValue(sym);
  const t = ticket.type;
  const needsLimit = t === "LMT" || t === "STPLMT";
  const needsStop = t === "STP" || t === "STPLMT";

  const setType = (type: OrderType) => {
    const last = quote.last;
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
  const open = openPnl({ positions, quotes }, sym);

  return (
    <div className={s.ticket}>
      <div className={s.deal}>
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

      <div className={s.row}>
        <span className={s.rowLabel}>Size</span>
        <Stepper label="Size" value={qty} step={1} min={1} onChange={(v) => setSettings({ qty: { ...settings.qty, [sym]: Math.max(1, Math.round(v)) } })} />
        <div className={s.chips}>
          {sizes.map((n) => (
            <button key={n} type="button" className={s.chipBtn} aria-pressed={n === qty} onClick={() => setSettings({ qty: { ...settings.qty, [sym]: n } })}>
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className={s.types} role="tablist" aria-label="Order type" style={{ "--i": TYPES.findIndex((x) => x.id === t), "--n": TYPES.length } as CSSProperties}>
        <span className={s.typePill} aria-hidden="true" />
        {TYPES.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={x.id === t} onClick={() => setType(x.id)}>
            {x.label}
          </button>
        ))}
      </div>

      {(needsLimit || needsStop || t === "TRAIL") && (
        <div className={s.prices}>
          {needsStop && (
            <div className={s.row}>
              <span className={s.rowLabel}>Stop</span>
              <Stepper label="Stop price" value={ticket.stop ?? quote.last} step={inst.tick} onChange={(v) => setTicket({ stop: snap(sym, v) })} />
              <button type="button" className={s.pickBtn} aria-pressed={pick === "stop"} onClick={() => setPick(pick === "stop" ? null : "stop")} title="Pick on chart">
                <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
                  <circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M8 0.5v4M8 11.5v4M0.5 8h4M11.5 8h4" stroke="currentColor" strokeWidth="1.2" />
                </svg>
              </button>
            </div>
          )}
          {needsLimit && (
            <div className={s.row}>
              <span className={s.rowLabel}>Limit</span>
              <Stepper label="Limit price" value={ticket.limit ?? quote.last} step={inst.tick} onChange={(v) => setTicket({ limit: snap(sym, v) })} />
              <button type="button" className={s.pickBtn} aria-pressed={pick === "limit"} onClick={() => setPick(pick === "limit" ? null : "limit")} title="Pick on chart">
                <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
                  <circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M8 0.5v4M8 11.5v4M0.5 8h4M11.5 8h4" stroke="currentColor" strokeWidth="1.2" />
                </svg>
              </button>
            </div>
          )}
          {t === "TRAIL" && (
            <div className={s.row}>
              <span className={s.rowLabel}>Trail</span>
              <Stepper label="Trail distance" value={ticket.trail} step={inst.tick * 4} min={inst.tick} unit="pts" onChange={(v) => setTicket({ trail: Math.max(inst.tick, snap(sym, v)) })} />
            </div>
          )}
        </div>
      )}

      <div className={s.bracket}>
        <div className={s.bracketHead}>
          <span className={s.rowLabel}>Bracket</span>
          {settings.stopOn && settings.targetOn && <span className={s.rr}>R:R {(tgtT / stopT).toFixed(1)}</span>}
        </div>
        <div className={s.bRow}>
          <Switch on={settings.stopOn} onChange={(v) => setSettings({ stopOn: v })} label="Attach a stop" />
          <span className={`${s.bName} ${s.neg}`}>Stop</span>
          <Stepper label="Stop distance" value={stopT} step={4} min={1} unit="ticks" onChange={(v) => setSettings({ stopTicks: { ...settings.stopTicks, [sym]: Math.max(1, Math.round(v)) } })} />
          <span className={s.bVal}>
            {fmt(stopT * inst.tick)} pts<em className={s.neg}>−${fmt(risk, 0)}</em>
          </span>
        </div>
        <div className={s.bRow}>
          <Switch on={settings.targetOn} onChange={(v) => setSettings({ targetOn: v })} label="Attach a target" />
          <span className={`${s.bName} ${s.pos}`}>Target</span>
          <Stepper label="Target distance" value={tgtT} step={4} min={1} unit="ticks" onChange={(v) => setSettings({ targetTicks: { ...settings.targetTicks, [sym]: Math.max(1, Math.round(v)) } })} />
          <span className={s.bVal}>
            {fmt(tgtT * inst.tick)} pts<em className={s.pos}>+${fmt(reward, 0)}</em>
          </span>
        </div>
      </div>

      <div className={s.posBar}>
        {pos ? (
          <>
            <div className={s.posInfo}>
              <span className={`${s.side} ${pos.qty > 0 ? s.sideL : s.sideS}`}>{pos.qty > 0 ? "Long" : "Short"}</span>
              <span>
                {Math.abs(pos.qty)} @ {fmt(pos.avg)}
              </span>
              <b className={open >= 0 ? s.pos : s.neg}>
                <Odometer value={money(open)} delay={0} />
              </b>
            </div>
            <div className={s.posBtns}>
              <button type="button" onClick={() => closePercent(sym, 0.5)}>
                Close half
              </button>
              <button type="button" className={s.flat} onClick={() => flatten(sym)}>
                Flatten
              </button>
            </div>
          </>
        ) : (
          <div className={s.posInfo}>
            <span className={s.flatTag}>Flat</span>
            <span className={s.dim}>No position in {inst.code}</span>
          </div>
        )}
      </div>
    </div>
  );
}
