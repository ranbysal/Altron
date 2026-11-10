"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Cell } from "@/components/trader/parts";
import t from "@/components/trader/trader.module.css";
import { Chart } from "@/components/desk/Chart";
import { INSTRUMENTS } from "@/lib/desk/instruments";
import { selectSym, sizeWords, toggleFull, useDesk, type Trade } from "@/lib/desk/store";
import { fmt, money } from "@/lib/format";
import { placeholders, say, startRoom, useRoom, VIEWER } from "@/lib/community/room";
import { clock, clockS, currentTrade, dayWord, dirOf, entryOf, exitOf, held, notesOf, roomOf, stopOf, streamOf, targetOf, type Line } from "@/lib/community/trades";
import { useView, viewTrade } from "@/lib/community/view";
import { useNow } from "@/lib/community/watch";
import { Watcher } from "./Watcher";
import c from "./community.module.css";

/* ------------------------------------------------------------------ */
/* the trade                                                           */
/* ------------------------------------------------------------------ */

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/** Stop on the left, target on the right, the entry between them and the price moving along. */
function Ruler({ left, right, entry, mark, tone, label, flat }: { left: number; right: number; entry: number; mark: number; tone: "pos" | "neg"; label: string; flat: boolean }) {
  const at = (p: number) => (p - left) / (right - left);
  const e = Math.max(0, Math.min(1, at(entry)));
  const raw = at(mark);
  const m = Math.max(-0.035, Math.min(1.035, raw));
  const a = Math.min(e, Math.max(0, Math.min(1, raw)));
  const b = Math.max(e, Math.max(0, Math.min(1, raw)));
  return (
    <div className={c.ruler} data-tone={tone} style={{ "--e": e, "--m": m, "--a": a, "--b": b } as CSSProperties}>
      <span className={c.rTicks} aria-hidden="true" />
      <span className={c.rFill} aria-hidden="true" />
      <i className={`${c.rCap} ${c.rStop}`} aria-hidden="true" />
      <i className={`${c.rCap} ${c.rTarget}`} aria-hidden="true" />
      <i className={c.rEntry} aria-hidden="true" />
      <span className={c.rMark} data-flat={flat ? "" : undefined} data-out={raw < 0 ? "l" : raw > 1 ? "r" : undefined}>
        <b>{label}</b>
        <i />
      </span>
    </div>
  );
}

function TradeCard({ trade, now }: { trade: Trade; now: number }) {
  const orders = useDesk((st) => st.orders);
  const quote = useDesk((st) => st.quotes[trade.sym]);
  const pos = useDesk((st) => st.positions[trade.sym]);
  const notices = useDesk((st) => st.notices);
  const notes = useDesk((st) => st.notes);
  const inst = INSTRUMENTS[trade.sym];
  const live = !trade.closedAt && !!pos;
  const dir = dirOf(trade);
  const entry = live ? pos!.avg : entryOf(trade);
  const qty = live ? Math.abs(pos!.qty) : trade.qty;
  const stop = stopOf(trade, orders);
  const target = targetOf(trade, orders);
  const mark = live ? (dir > 0 ? quote.bid : quote.ask) : (exitOf(trade) ?? entry);
  const pnl = trade.pnl + (live ? (mark - pos!.avg) * pos!.qty * inst.pv : 0);
  const r = trade.risk ? pnl / trade.risk : null;
  const tone = pnl >= 0 ? "pos" : "neg";

  // the ruler runs stop to target; a missing end is implied from the other at 1 to 2
  const left = stop ?? (target !== undefined ? entry - (target - entry) / 2 : undefined);
  const right = target ?? (stop !== undefined ? entry + (entry - stop) * 2 : undefined);
  const leg = (p: number) => money((p - entry) * dir * qty * inst.pv);
  const said = notesOf(trade, notices, notes);
  const note = said[said.length - 1];

  return (
    <div className={c.trade}>
      <div className={c.tLine}>
        <span className={`${c.side} ${dir > 0 ? c.sideL : c.sideS}`}>{dir > 0 ? "Long" : "Short"}</span>
        <span className={c.tSize}>{sizeWords(trade.sym, qty)}</span>
        <span className={c.tCode}>{inst.code}</span>
      </div>
      <div className={c.tNum}>
        <span className={`${c.tPnl} ${tone === "pos" ? c.pos : c.neg}`}>{money(pnl)}</span>
        <span className={c.tMeta}>
          {r !== null && <b className={tone === "pos" ? c.pos : c.neg}>{`${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(2)}R`}</b>}
          <em>{live ? `Held ${held(now - trade.openedAt)}` : `Held ${held((trade.closedAt ?? now) - trade.openedAt)}`}</em>
        </span>
      </div>
      {left !== undefined && right !== undefined && left !== right ? (
        <Ruler left={left} right={right} entry={entry} mark={mark} tone={tone} label={live ? fmt(quote.last) : `Exit ${fmt(mark)}`} flat={!live} />
      ) : (
        <p className={c.tBare}>No stop or target on this trade.</p>
      )}
      <dl className={c.tLevels}>
        <div>
          <dt>Stop</dt>
          <dd>{stop !== undefined ? fmt(stop) : "None"}</dd>
          {stop !== undefined && <dd className={c.neg}>{leg(stop)}</dd>}
        </div>
        <div>
          <dt>Entry</dt>
          <dd>{fmt(entry)}</dd>
          <dd>{clockS(trade.openedAt)}</dd>
        </div>
        <div>
          <dt>Target</dt>
          <dd>{target !== undefined ? fmt(target) : "Open"}</dd>
          {target !== undefined && <dd className={c.pos}>{leg(target)}</dd>}
        </div>
      </dl>
      {note && (
        <figure className={c.tNote} key={note.id}>
          <blockquote>{note.text}</blockquote>
          <figcaption>
            Yazan · {clock(note.at)}
            {said.length > 1 && ` · ${said.length} notes`}
          </figcaption>
        </figure>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* the room                                                            */
/* ------------------------------------------------------------------ */

function Countdown({ until }: { until: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const s = Math.max(0, Math.round((until - now) / 1000));
  return (
    <>
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
    </>
  );
}

function RoomLine({ l }: { l: Line }) {
  if (l.kind === "event")
    return (
      <li className={c.ev} data-tone={l.tone}>
        <i aria-hidden="true" />
        <time>{clockS(l.at)}</time>
        <span>{l.text}</span>
        {l.sub && <em className={l.sub.startsWith("−") ? c.neg : l.sub.startsWith("+") ? c.pos : undefined}>{l.sub}</em>}
      </li>
    );
  if (l.kind === "note")
    return (
      <li className={c.say} data-note="">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={c.face} src="/yazan.webp" alt="" width={22} height={22} />
        <header>
          <b>Yazan</b>
          <span className={c.badge}>Note</span>
          <time>{clock(l.at)}</time>
        </header>
        <p>{l.text}</p>
      </li>
    );
  return (
    <li className={c.say} data-trader={l.trader ? "" : undefined}>
      {l.trader ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={c.face} src="/yazan.webp" alt="" width={22} height={22} />
      ) : (
        <span className={c.face} aria-hidden="true">
          {initials(l.name)}
        </span>
      )}
      <header>
        <b>{l.name}</b>
        {l.trader && <span className={c.badge}>Desk</span>}
        <time>{clock(l.at)}</time>
      </header>
      <p>{l.text}</p>
    </li>
  );
}

function Room({ trade, now, open, until }: { trade: Trade; now: number; open: boolean; until: number | null }) {
  const fills = useDesk((st) => st.fills);
  const notices = useDesk((st) => st.notices);
  const notes = useDesk((st) => st.notes);
  const msgs = useRoom((s) => s.msgs);
  const lines = useMemo(() => streamOf(trade, fills, notices, notes, msgs, now), [trade, fills, notices, notes, msgs, now]);
  const box = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  const [text, setText] = useState("");
  const [fresh, setFresh] = useState(0);
  const seen = useRef(0);

  useLayoutEffect(() => {
    stick.current = true;
    seen.current = 0;
    setFresh(0);
  }, [trade.id]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (stick.current) {
      el.scrollTop = el.scrollHeight;
      seen.current = lines.length;
      setFresh(0);
    } else if (lines.length > seen.current) setFresh(lines.length - seen.current);
  }, [lines.length, trade.id]);

  const send = () => {
    if (!open || !text.trim()) return;
    stick.current = true;
    say(trade.id, text);
    setText("");
  };

  return (
    <div className={c.room}>
      <ol
        ref={box}
        className={c.stream}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          if (stick.current && fresh) {
            seen.current = lines.length;
            setFresh(0);
          }
        }}
      >
        {lines.map((l) => (
          <RoomLine key={l.id} l={l} />
        ))}
        {!lines.length && <li className={c.quiet}>Nothing here yet.</li>}
      </ol>
      {fresh > 0 && (
        <button
          type="button"
          className={c.newPill}
          onClick={() => {
            stick.current = true;
            box.current?.scrollTo({ top: box.current.scrollHeight, behavior: "smooth" });
          }}
        >
          {fresh} new
        </button>
      )}
      {open ? (
        <form
          className={c.composer}
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Message the room as ${VIEWER.name}`}
            rows={1}
            maxLength={1200}
            aria-label="Message the room"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button type="submit" disabled={!text.trim()} aria-label="Send">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
            </svg>
          </button>
        </form>
      ) : (
        <p className={c.shut}>This room closed {until ? `${dayWord(until, now).toLowerCase()} at ${clock(until)}` : ""}. The conversation stays here to read.</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* the record                                                          */
/* ------------------------------------------------------------------ */

/** Where a result landed between a full loss and three times the risk. */
function MiniR({ r, targetR }: { r: number; targetR?: number }) {
  const x = (v: number) => ((Math.max(-1.5, Math.min(3, v)) + 1.5) / 4.5) * 100;
  return (
    <span className={c.miniR} data-tone={r >= 0 ? "pos" : "neg"} aria-hidden="true">
      <i style={{ left: `${x(-1)}%` }} />
      <i style={{ left: `${x(0)}%` }} data-zero="" />
      {targetR !== undefined && targetR > 0 && <i style={{ left: `${x(targetR)}%` }} />}
      <b style={{ left: `${Math.min(x(0), x(r))}%`, width: `${Math.abs(x(r) - x(0))}%` }} />
      <u style={{ left: `${x(r)}%` }} />
    </span>
  );
}

function Plate({ trade, on, now, k }: { trade: Trade; on: boolean; now: number; k: number }) {
  const live = !trade.closedAt;
  const pos = useDesk((st) => (live ? st.positions[trade.sym] : undefined));
  // only an open trade listens to the tape
  const mark = useDesk((st) => (live ? (dirOf(trade) > 0 ? st.quotes[trade.sym].bid : st.quotes[trade.sym].ask) : 0));
  const notices = useDesk((st) => st.notices);
  const notes = useDesk((st) => st.notes);
  const nMsgs = useRoom((s) => s.msgs.reduce((a, m) => a + (m.tradeId === trade.id ? 1 : 0), 0));
  const inst = INSTRUMENTS[trade.sym];
  const dir = dirOf(trade);
  const pnl = trade.pnl + (live && pos ? (mark - pos.avg) * pos.qty * inst.pv : 0);
  const r = trade.risk ? pnl / trade.risk : null;
  const said = notesOf(trade, notices, notes);
  const talk = nMsgs + placeholders(trade, now).length;
  const entry = entryOf(trade);
  const exit = exitOf(trade);
  const stop = trade.stop;
  const targetR = trade.target !== undefined && stop !== undefined && entry !== stop ? Math.abs(trade.target - entry) / Math.abs(entry - stop) : undefined;

  return (
    <button
      type="button"
      className={c.plate}
      aria-pressed={on}
      style={{ "--k": Math.min(k, 10) } as CSSProperties}
      onClick={() => {
        selectSym(trade.sym);
        if (live) viewTrade(null);
        else viewTrade(trade.id, { from: trade.openedAt, to: trade.closedAt ?? Date.now() });
        window.scrollTo({ top: 0, behavior: "smooth" });
      }}
    >
      <span className={c.pTop}>
        <span>
          {dayWord(trade.openedAt, now)} · {clock(trade.openedAt)}
        </span>
        {live ? (
          <span className={c.liveTag}>
            <i />
            Live
          </span>
        ) : (
          <span>{held((trade.closedAt ?? now) - trade.openedAt)}</span>
        )}
      </span>
      <span className={c.pHead}>
        <span className={`${c.side} ${dir > 0 ? c.sideL : c.sideS}`}>{dir > 0 ? "Long" : "Short"}</span>
        <span className={c.pWhat}>{sizeWords(trade.sym, trade.qty)}</span>
      </span>
      <span className={c.pNum}>
        <b className={pnl >= 0 ? c.pos : c.neg}>{money(pnl)}</b>
        {r !== null && <em className={pnl >= 0 ? c.pos : c.neg}>{`${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(1)}R`}</em>}
      </span>
      {r !== null ? <MiniR r={r} targetR={targetR} /> : <span className={c.miniR} data-bare="" aria-hidden="true" />}
      <span className={c.pPx}>
        {fmt(entry)} <i aria-hidden="true">→</i> {exit !== undefined && !live ? fmt(exit) : "open"}
      </span>
      <span className={c.pNote}>{said.length ? said[said.length - 1].text : "No note on this trade."}</span>
      <span className={c.pFoot}>
        <span>
          {said.length} {said.length === 1 ? "note" : "notes"}
        </span>
        <span>
          {talk} {talk === 1 ? "message" : "messages"}
        </span>
      </span>
    </button>
  );
}

function Record({ trades, focusId, now }: { trades: Trade[]; focusId?: string; now: number }) {
  const [all, setAll] = useState(false);
  const list = useMemo(() => [...trades].reverse(), [trades]);
  const shown = all ? list : list.slice(0, 10);
  return (
    <div className={c.record}>
      <div className={c.plates}>
        {shown.map((x, k) => (
          <Plate key={x.id} trade={x} on={x.id === focusId} now={now} k={k} />
        ))}
      </div>
      {!list.length && <p className={c.none}>No trades yet. The first one appears here the moment it opens.</p>}
      {list.length > 10 && (
        <button type="button" className={c.more} onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${list.length} trades`}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* the page                                                            */
/* ------------------------------------------------------------------ */

export function Community() {
  const ready = useDesk((st) => st.ready);
  const full = useDesk((st) => st.full);
  const trades = useDesk((st) => st.trades);
  const sym = useDesk((st) => st.settings.sym);
  const viewing = useView((s) => s.viewing);
  const now = useNow(15_000);
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    startRoom();
    return () => {
      toggleFull(false);
      viewTrade(null);
      delete document.documentElement.dataset.deskFull;
    };
  }, []);

  // full screen: the nav folds away and the chart takes the window, as on the desk
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (full) {
      root.dataset.deskFull = "on";
      window.scrollTo({ top: 0 });
    } else delete root.dataset.deskFull;
    const el = sheet.current;
    el?.setAttribute("data-fx", "");
    const id = window.setTimeout(() => el?.removeAttribute("data-fx"), 520);
    return () => window.clearTimeout(id);
  }, [full]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      if (e.key === "Escape" && useDesk.getState().full) toggleFull(false);
      if (e.key === "F" && e.shiftKey && !e.metaKey && !e.ctrlKey) toggleFull();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const picked = viewing ? trades.find((x) => x.id === viewing) : undefined;
  const trade = picked ?? currentTrade(trades, sym);
  const room = trade ? roomOf(trade, trades, now) : null;
  const live = !!trade && !trade.closedAt;
  const closed = trades.filter((x) => x.closedAt);
  const net = closed.reduce((a, x) => a + x.pnl, 0);
  const won = closed.filter((x) => x.pnl > 0).length;

  let status: ReactNode;
  if (!trade) status = "Flat";
  else if (live)
    status = (
      <span className={c.liveTag}>
        <i />
        Live
      </span>
    );
  else status = `Flat · closed ${dayWord(trade.closedAt!, now).toLowerCase()} ${clock(trade.closedAt!)}`;
  if (picked)
    status = (
      <span className={c.viewing}>
        {dayWord(picked.openedAt, now)} · {clock(picked.openedAt)}
        <button type="button" onClick={() => viewTrade(null)}>
          Back to live
        </button>
      </span>
    );

  return (
    <div ref={sheet} className={c.sheet} data-full={full ? "on" : "off"}>
      <i className={t.sheetR} aria-hidden="true" />
      <i className={t.sheetB} aria-hidden="true" />

      <section className={c.hero} aria-label="Yazan's trading">
        <Cell i={0} noTop className={c.aChart} bodyClass={c.flush}>
          {ready && <Chart viewer />}
        </Cell>
        <Cell i={1} noTop className={c.aTrade} label={picked ? "Trade" : live ? "Trade" : "Last trade"} aside={status} bodyClass={c.body}>
          <div className={c.sideIn} inert={full}>
            {ready && trade ? <TradeCard trade={trade} now={now} /> : ready ? <p className={c.none}>No trades yet. When Yazan opens one, it shows here with his entry, stop and target.</p> : null}
          </div>
        </Cell>
        <Cell
          i={2}
          className={c.aRoom}
          label="Room"
          aside={
            !room ? (
              "Opens with the next trade"
            ) : room.live ? (
              "Open"
            ) : room.open && room.until ? (
              <>
                Closes in <Countdown until={room.until} />
              </>
            ) : (
              "Archived"
            )
          }
          bodyClass={c.bodyRoom}
        >
          <div className={c.sideIn} inert={full}>
            {ready && trade && room ? <Room trade={trade} now={now} open={room.open} until={room.until} /> : ready ? <p className={c.none}>Each trade opens its own room. It stays open for an hour after the trade closes, or until the next one starts.</p> : null}
          </div>
        </Cell>
      </section>

      <Cell i={3} className={c.aRecord} label="Record" aside={closed.length ? `${closed.length} closed · ${won} won · ${money(net)}` : undefined} bodyClass={c.body}>
        {ready && <Record trades={trades} focusId={trade?.id} now={now} />}
      </Cell>

      <Watcher />
    </div>
  );
}
