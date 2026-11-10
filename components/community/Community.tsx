"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Cell } from "@/components/trader/parts";
import t from "@/components/trader/trader.module.css";
import { EquityChart } from "@/components/trader/EquityChart";
import { Chart, type TradeMarks } from "@/components/desk/Chart";
import { INSTRUMENTS } from "@/lib/desk/instruments";
import {
  getMarket,
  selectSym,
  setSettings,
  sizeWords,
  useDesk,
  type Trade,
} from "@/lib/desk/store";
import { BAYER4 } from "@/lib/noise";
import { onThemeChange } from "@/lib/theme";
import { fmt, money } from "@/lib/format";
import { TRADES, computeStats } from "@/lib/journal";
import {
  placeholders,
  say,
  startRoom,
  useRoom,
  VIEWER,
} from "@/lib/community/room";
import {
  clock,
  clockS,
  currentTrade,
  dayWord,
  dirOf,
  entryOf,
  exitOf,
  held,
  notesOf,
  roomOf,
  stopOf,
  streamOf,
  targetOf,
  type Line,
} from "@/lib/community/trades";
import {
  useFeed,
  useNow,
  type Calendar,
  type Wire,
} from "@/lib/community/watch";
import {
  CalControls,
  CalendarCard,
  Moves,
  News,
  XWatcher,
  useCalView,
} from "./Watcher";
import c from "./community.module.css";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/* ------------------------------------------------------------------ */
/* one trade's numbers, read the same way everywhere                   */
/* ------------------------------------------------------------------ */

function useTradeView(trade: Trade) {
  const orders = useDesk((st) => st.orders);
  const quote = useDesk((st) => st.quotes[trade.sym]);
  const pos = useDesk((st) => st.positions[trade.sym]);
  const inst = INSTRUMENTS[trade.sym];
  const live = !trade.closedAt && !!pos;
  const dir = dirOf(trade);
  const entry = live ? pos!.avg : entryOf(trade);
  const qty = live ? Math.abs(pos!.qty) : trade.qty;
  const stop = stopOf(trade, orders);
  const target = targetOf(trade, orders);
  const exit = exitOf(trade);
  const mark = live ? (dir > 0 ? quote.bid : quote.ask) : (exit ?? entry);
  const pnl = trade.pnl + (live ? (mark - pos!.avg) * pos!.qty * inst.pv : 0);
  const r = trade.risk ? pnl / trade.risk : null;
  const leg = (p: number) => money((p - entry) * dir * qty * inst.pv);
  return {
    inst,
    live,
    dir,
    entry,
    qty,
    stop,
    target,
    exit,
    mark,
    pnl,
    r,
    leg,
    last: quote.last,
  };
}

/** Stop on the left, target on the right, the entry between them and the price moving along. */
function Ruler({
  left,
  right,
  entry,
  mark,
  tone,
  label,
  closed,
}: {
  left: number;
  right: number;
  entry: number;
  mark: number;
  tone: "pos" | "neg";
  label: string;
  closed: boolean;
}) {
  const at = (p: number) => (p - left) / (right - left);
  const e = Math.max(0, Math.min(1, at(entry)));
  const raw = at(mark);
  const m = Math.max(-0.035, Math.min(1.035, raw));
  const a = Math.min(e, Math.max(0, Math.min(1, raw)));
  const b = Math.max(e, Math.max(0, Math.min(1, raw)));
  return (
    <div
      className={c.ruler}
      data-tone={tone}
      style={{ "--e": e, "--m": m, "--a": a, "--b": b } as CSSProperties}
    >
      <span className={c.rTicks} aria-hidden="true" />
      <span className={c.rFill} aria-hidden="true" />
      <i className={`${c.rCap} ${c.rStop}`} aria-hidden="true" />
      <i className={`${c.rCap} ${c.rTarget}`} aria-hidden="true" />
      <i className={c.rEntry} aria-hidden="true" />
      <span
        className={c.rMark}
        data-closed={closed ? "" : undefined}
        data-out={raw < 0 ? "l" : raw > 1 ? "r" : undefined}
        data-align={m < 0.16 ? "l" : m > 0.84 ? "r" : undefined}
      >
        <b>{label}</b>
        <i />
      </span>
    </div>
  );
}

function TradeRuler({ v }: { v: ReturnType<typeof useTradeView> }) {
  const { stop, target, entry, mark, pnl, live, last } = v;
  const left =
    stop ?? (target !== undefined ? entry - (target - entry) / 2 : undefined);
  const right =
    target ?? (stop !== undefined ? entry + (entry - stop) * 2 : undefined);
  if (left === undefined || right === undefined || left === right)
    return <p className={c.tBare}>No stop or target on this trade.</p>;
  return (
    <Ruler
      left={left}
      right={right}
      entry={entry}
      mark={mark}
      tone={pnl >= 0 ? "pos" : "neg"}
      label={live ? fmt(last) : `Exit ${fmt(mark)}`}
      closed={!live}
    />
  );
}

function Levels({
  v,
  trade,
}: {
  v: ReturnType<typeof useTradeView>;
  trade: Trade;
}) {
  return (
    <dl className={c.tLevels}>
      <div>
        <dt>Stop</dt>
        <dd>{v.stop !== undefined ? fmt(v.stop) : "None"}</dd>
        {v.stop !== undefined && <dd className={c.neg}>{v.leg(v.stop)}</dd>}
      </div>
      <div>
        <dt>Entry</dt>
        <dd>{fmt(v.entry)}</dd>
        <dd>{clockS(trade.openedAt)}</dd>
      </div>
      <div>
        <dt>Target</dt>
        <dd>{v.target !== undefined ? fmt(v.target) : "Open"}</dd>
        {v.target !== undefined && <dd className={c.pos}>{v.leg(v.target)}</dd>}
      </div>
    </dl>
  );
}

const Status = ({ live }: { live: boolean }) =>
  live ? (
    <span className={c.liveTag}>
      <i />
      Live
    </span>
  ) : (
    <span className={c.closedTag}>Closed</span>
  );

/* ------------------------------------------------------------------ */
/* the trade, in the corner                                            */
/* ------------------------------------------------------------------ */

const TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  minute: "2-digit",
});

/**
 * The trade drawn small: the price around it, its stop and target, where it went in and
 * where it came out. Seconds while they're still on hand, minutes after that.
 */
function TradeTrace({
  trade,
  v,
}: {
  trade: Trade;
  v: ReturnType<typeof useTradeView>;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [theme, setTheme] = useState(0);
  const [beat, setBeat] = useState(0);
  const [span, setSpan] = useState<{ a: number; b: number } | null>(null);
  useEffect(() => onThemeChange(() => setTheme((n) => n + 1)), []);
  useEffect(() => {
    const id = window.setInterval(
      () => setBeat((n) => n + 1),
      v.live ? 1000 : 10_000,
    );
    return () => window.clearInterval(id);
  }, [v.live]);
  const { dir, entry, exit, stop, target, live } = v;

  useEffect(() => {
    const cv = ref.current;
    const m = getMarket();
    if (!cv || !m) return;
    const draw = () => {
      const W = cv.clientWidth;
      const H = cv.clientHeight;
      if (!W || !H) return;
      const now = Date.now();
      const end = trade.closedAt ?? now;
      const dur = Math.max(60_000, end - trade.openedAt);
      const a = trade.openedAt - Math.max(4 * 60_000, dur * 0.6);
      const b = trade.closedAt
        ? Math.min(now, end + Math.max(2 * 60_000, dur * 0.35))
        : now;
      const under = INSTRUMENTS[trade.sym].under;
      const secs = m.bars(under, 1);
      const useSecs = secs.length > 0 && secs[0].t <= a && b - a <= 50 * 60_000;
      const src = useSecs ? secs : m.bars(under, 60);
      let i0 = 0;
      let hiI = src.length;
      while (i0 < hiI) {
        const mid = (i0 + hiI) >> 1;
        if (src[mid].t < a) i0 = mid + 1;
        else hiI = mid;
      }
      const pts: { t: number; p: number }[] = [];
      for (let i = i0; i < src.length && src[i].t <= b; i++)
        pts.push({ t: src[i].t, p: src[i].c });
      if (pts.length < 2) return;
      setSpan((s) =>
        s && s.a === pts[0].t && s.b === pts[pts.length - 1].t
          ? s
          : { a: pts[0].t, b: pts[pts.length - 1].t },
      );
      // at most a point every two pixels
      const every = Math.max(1, Math.ceil(pts.length / (W / 2)));
      const line = pts.filter(
        (_, k) => k % every === 0 || k === pts.length - 1,
      );

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      const g = cv.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const cs = getComputedStyle(cv);
      const col = (n: string) => cs.getPropertyValue(n).trim();

      let lo = Infinity;
      let hi = -Infinity;
      for (const x of line) {
        lo = Math.min(lo, x.p);
        hi = Math.max(hi, x.p);
      }
      for (const p of [entry, stop, target, exit]) {
        if (p === undefined) continue;
        lo = Math.min(lo, p);
        hi = Math.max(hi, p);
      }
      const padY = (hi - lo || 1) * 0.08;
      lo -= padY;
      hi += padY;
      const right = live ? 16 : 2; // the live point never touches the edge
      const t0 = line[0].t;
      const t1 = live ? now : line[line.length - 1].t;
      const X = (t: number) =>
        1 + ((t - t0) / Math.max(1, t1 - t0)) * (W - right - 2);
      const Y = (p: number) => 4 + (1 - (p - lo) / (hi - lo)) * (H - 22);
      const base = H - 18;

      // the time in the trade, a quiet wash
      const xa = X(trade.openedAt);
      const xb = X(trade.closedAt ?? t1);
      g.fillStyle = col("--hover");
      g.fillRect(xa, 0, Math.max(1, xb - xa), base);

      // glow under the line, dithered like the record above
      const cell = 3;
      const ga = new Path2D();
      const gb = new Path2D();
      let k = 0;
      for (let x = 0; x < X(line[line.length - 1].t); x += cell) {
        const t = t0 + ((x - 1) / (W - right - 2)) * (t1 - t0);
        while (k < line.length - 1 && line[k + 1].t <= t) k++;
        const y0 = Y(line[k].p);
        const reach = Math.max(1, base - y0);
        for (let y = Math.ceil(y0 / cell) * cell; y < base; y += cell) {
          const f = 1 - (y - y0) / reach;
          const I = 0.02 + 0.42 * f * f * f;
          if (I > (BAYER4[((y / cell) & 3) * 4 + ((x / cell) & 3)] + 0.5) / 16)
            (I > 0.28 ? gb : ga).rect(x, y, 2, 2);
        }
      }
      const up = v.pnl >= 0;
      g.fillStyle = col(up ? "--cv-dither-1" : "--cv-ember-1");
      g.fill(ga);
      g.fillStyle = col(up ? "--cv-dither-2" : "--cv-ember-2");
      g.fill(gb);

      // the levels
      const level = (p: number | undefined, c: string, dash: number[]) => {
        if (p === undefined) return;
        const y = Math.round(Y(p)) + 0.5;
        g.setLineDash(dash);
        g.strokeStyle = c;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(W, y);
        g.stroke();
      };
      level(stop, col("--ember"), [4, 3]);
      level(target, col("--blue"), [4, 3]);
      level(entry, col("--dim"), [1, 3]);
      g.setLineDash([]);

      // the price
      g.beginPath();
      line.forEach((x, i) =>
        i ? g.lineTo(X(x.t), Y(x.p)) : g.moveTo(X(x.t), Y(x.p)),
      );
      g.strokeStyle = col("--text-strong");
      g.lineWidth = 1.25;
      g.lineJoin = "round";
      g.stroke();

      // in and out
      g.fillStyle = col(dir > 0 ? "--blue" : "--ember");
      g.fillRect(Math.round(xa) - 3, Math.round(Y(entry)) - 3, 6, 6);
      if (trade.closedAt && exit !== undefined) {
        g.beginPath();
        g.arc(xb, Y(exit), 3.5, 0, Math.PI * 2);
        g.fillStyle = col("--page");
        g.fill();
        g.strokeStyle = col("--text-strong");
        g.lineWidth = 1.5;
        g.stroke();
      }
      if (live) {
        const last = line[line.length - 1];
        g.fillStyle = col("--text-strong");
        g.fillRect(
          Math.round(X(last.t)) - 2.5,
          Math.round(Y(last.p)) - 2.5,
          5,
          5,
        );
      }
      // a floor under it all
      g.fillStyle = col("--tl");
      g.fillRect(0, base, W, 1);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(cv);
    return () => ro.disconnect();
  }, [trade, dir, entry, exit, stop, target, live, v.pnl, theme, beat]);

  return (
    <div className={c.trace}>
      <div className={c.traceCv}>
        <canvas
          ref={ref}
          role="img"
          aria-label="The trade on the price: entry, stop, target and exit"
        />
      </div>
      {span && (
        <span className={c.traceAxis} aria-hidden="true">
          <time>{TIME.format(span.a)}</time>
          <span className={c.traceKey}>
            <i data-k="stop" />
            Stop
            <i data-k="target" />
            Target
          </span>
          <time>{live ? "Now" : TIME.format(span.b)}</time>
        </span>
      )}
    </div>
  );
}

function Preview({
  trade,
  now,
  onOpen,
}: {
  trade: Trade;
  now: number;
  onOpen: () => void;
}) {
  const v = useTradeView(trade);
  const nMsgs =
    useRoom((s) =>
      s.msgs.reduce((a, m) => a + (m.tradeId === trade.id ? 1 : 0), 0),
    ) + placeholders(trade, now).length;
  const tone = v.pnl >= 0 ? c.pos : c.neg;
  return (
    <div
      className={c.preview}
      role="button"
      tabIndex={0}
      aria-label={`Open the ${v.live ? "live" : "last"} trade with its chart and room`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className={c.pvHead}>
        <span className={`${c.side} ${v.dir > 0 ? c.sideL : c.sideS}`}>
          {v.dir > 0 ? "Long" : "Short"}
        </span>
        <span className={c.tSize}>{sizeWords(trade.sym, v.qty)}</span>
        <span className={c.tCode}>{v.inst.code}</span>
      </div>
      <div className={c.tNum}>
        <span className={`${c.tPnl} ${tone}`}>{money(v.pnl)}</span>
        <span className={c.tMeta}>
          {v.r !== null && (
            <b
              className={tone}
            >{`${v.r >= 0 ? "+" : "−"}${Math.abs(v.r).toFixed(2)}R`}</b>
          )}
          <em>
            {v.live
              ? `Held ${held(now - trade.openedAt)}`
              : `Closed ${dayWord(trade.closedAt!, now).toLowerCase()} ${clock(trade.closedAt!)}`}
          </em>
        </span>
      </div>
      <TradeRuler v={v} />
      <Levels v={v} trade={trade} />
      <TradeTrace trade={trade} v={v} />
      {/* the way in, on hover or focus */}
      <span className={c.pvOpen} aria-hidden="true">
        <span>
          {v.live ? "Open live trade" : "Open trade"}
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3.5 2.5h6v6M9.5 2.5l-7 7" />
          </svg>
        </span>
        <em>
          Chart and room · {nMsgs} {nMsgs === 1 ? "message" : "messages"}
        </em>
      </span>
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

function RoomLine({
  l,
  onReply,
}: {
  l: Line;
  onReply?: (l: Line & { kind: "msg" }) => void;
}) {
  if (l.kind === "event")
    return (
      <li className={c.ev} data-tone={l.tone}>
        <i aria-hidden="true" />
        <time>{clockS(l.at)}</time>
        <span>{l.text}</span>
        {l.sub && (
          <em
            className={
              l.sub.startsWith("−")
                ? c.neg
                : l.sub.startsWith("+")
                  ? c.pos
                  : undefined
            }
          >
            {l.sub}
          </em>
        )}
      </li>
    );
  if (l.kind === "note")
    return (
      <li className={c.say} data-note="">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={c.face}
          src="/yazan.webp"
          alt=""
          width={22}
          height={22}
        />
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
        <img
          className={c.face}
          src="/yazan.webp"
          alt=""
          width={22}
          height={22}
        />
      ) : (
        <span className={c.face} aria-hidden="true">
          {initials(l.name)}
        </span>
      )}
      <header>
        <b>{l.name}</b>
        {l.trader && <span className={c.badge}>Desk</span>}
        <time>{clock(l.at)}</time>
        {onReply && !l.trader && (
          <button
            type="button"
            className={c.replyBtn}
            onClick={() => onReply(l)}
          >
            Reply
          </button>
        )}
      </header>
      {l.reply && (
        <blockquote className={c.quote}>
          <b>{l.reply.name}</b>
          {l.reply.text}
        </blockquote>
      )}
      <p>{l.text}</p>
    </li>
  );
}

function Room({ trade, now }: { trade: Trade; now: number }) {
  const trades = useDesk((st) => st.trades);
  const fills = useDesk((st) => st.fills);
  const notices = useDesk((st) => st.notices);
  const notes = useDesk((st) => st.notes);
  const msgs = useRoom((s) => s.msgs);
  const room = roomOf(trade, trades, now);
  const lines = useMemo(
    () => streamOf(trade, fills, notices, notes, msgs, now),
    [trade, fills, notices, notes, msgs, now],
  );
  const box = useRef<HTMLOListElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const [text, setText] = useState("");
  const [reply, setReply] = useState<(Line & { kind: "msg" }) | null>(null);
  const [fresh, setFresh] = useState(0);
  const seen = useRef(0);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (stick.current) {
      el.scrollTop = el.scrollHeight;
      seen.current = lines.length;
      setFresh(0);
    } else if (lines.length > seen.current)
      setFresh(lines.length - seen.current);
  }, [lines.length]);

  const send = () => {
    if (!room.open || !text.trim()) return;
    stick.current = true;
    say(trade.id, text, reply?.id);
    setText("");
    setReply(null);
  };

  return (
    <div className={c.room}>
      <div className={c.roomHead}>
        <span className={c.label}>Room</span>
        <span className={c.aside}>
          {room.live ? (
            "Open"
          ) : room.open && room.until ? (
            <>
              Closes in <Countdown until={room.until} />
            </>
          ) : (
            "Archived"
          )}
        </span>
      </div>
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
          <RoomLine
            key={l.id}
            l={l}
            onReply={
              room.open
                ? (m) => {
                    setReply(m);
                    area.current?.focus();
                  }
                : undefined
            }
          />
        ))}
        {!lines.length && <li className={c.quiet}>Nothing here yet.</li>}
      </ol>
      {fresh > 0 && (
        <button
          type="button"
          className={c.newPill}
          onClick={() => {
            stick.current = true;
            box.current?.scrollTo({
              top: box.current.scrollHeight,
              behavior: "smooth",
            });
          }}
        >
          {fresh} new
        </button>
      )}
      {room.open ? (
        <form
          className={c.composer}
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          {reply && (
            <div className={c.replying}>
              <span>
                Replying to <b>{reply.name}</b>
                <em>{reply.text}</em>
              </span>
              <button
                type="button"
                onClick={() => setReply(null)}
                aria-label="Cancel the reply"
              >
                ×
              </button>
            </div>
          )}
          <div className={c.composeRow}>
            <textarea
              ref={area}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                reply
                  ? `Reply to ${reply.name}`
                  : `Message the room as ${VIEWER.name}`
              }
              rows={1}
              maxLength={1200}
              aria-label="Message the room"
              onKeyDown={(e) => {
                if (e.key === "Escape" && reply) {
                  e.stopPropagation();
                  setReply(null);
                }
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button type="submit" disabled={!text.trim()} aria-label="Send">
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
              </svg>
            </button>
          </div>
        </form>
      ) : (
        <p className={c.shut}>
          This room closed{" "}
          {room.until
            ? `${dayWord(room.until, now).toLowerCase()} at ${clock(room.until)}`
            : ""}
          . The conversation stays here to read.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* the sheet: a trade opened over the page                             */
/* ------------------------------------------------------------------ */

/** Shows the trade's market on the chart while the sheet is open, then puts the desk's choice back. */
function useTradeMarket(sym: Trade["sym"]) {
  useLayoutEffect(() => {
    const st = useDesk.getState().settings;
    const before = { sym: st.sym, tf: st.tf };
    if (st.sym !== sym) selectSym(sym);
    return () => {
      const now = useDesk.getState().settings;
      if (now.sym !== before.sym) selectSym(before.sym);
      if (now.tf !== before.tf) setSettings({ tf: before.tf });
    };
  }, [sym]);
}

function Sheet({
  trade,
  kind,
  now,
  onClose,
}: {
  trade: Trade;
  kind: "live" | "history";
  now: number;
  onClose: () => void;
}) {
  useTradeMarket(trade.sym);
  const v = useTradeView(trade);
  const notices = useDesk((st) => st.notices);
  const notes = useDesk((st) => st.notes);
  const panel = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);
  const close = useCallback(() => {
    setLeaving(true);
    window.setTimeout(onClose, 180);
  }, [onClose]);

  // the page underneath stays still and out of reach
  useEffect(() => {
    const root = document.documentElement;
    const host = document.querySelector("[data-trader-root]") ?? document.body;
    const others = [...host.children].filter(
      (el) => !el.hasAttribute("data-sheet-root"),
    ) as HTMLElement[];
    others.forEach((el) => el.setAttribute("inert", ""));
    const prev = root.style.overflow;
    root.style.overflow = "hidden";
    panel.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", key);
    return () => {
      others.forEach((el) => el.removeAttribute("inert"));
      root.style.overflow = prev;
      window.removeEventListener("keydown", key);
    };
  }, [close]);

  const closedAt = trade.closedAt;
  const span = closedAt ? closedAt - trade.openedAt : now - trade.openedAt;
  const focus = useMemo(
    () =>
      kind === "history" && closedAt
        ? { from: trade.openedAt, to: closedAt }
        : undefined,
    [kind, closedAt, trade.openedAt],
  );
  const until =
    kind === "history" && closedAt
      ? closedAt + Math.max(12 * 60_000, span * 0.8)
      : undefined;
  const marks = useMemo<TradeMarks | undefined>(
    () =>
      v.live
        ? undefined
        : {
            side: v.dir as 1 | -1,
            qty: trade.qty,
            entry: v.entry,
            exit: v.exit,
            stop: v.stop,
            target: v.target,
          },
    [v.live, v.dir, trade.qty, v.entry, v.exit, v.stop, v.target],
  );
  const said = notesOf(trade, notices, notes);
  const tone = v.pnl >= 0 ? c.pos : c.neg;

  return createPortal(
    <div
      className={c.overlay}
      data-sheet-root=""
      data-leaving={leaving ? "" : undefined}
      onPointerDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        ref={panel}
        className={c.sheetPanel}
        role="dialog"
        aria-modal="true"
        aria-label={`${v.dir > 0 ? "Long" : "Short"} ${sizeWords(trade.sym, v.qty)}`}
        tabIndex={-1}
      >
        <header className={c.sheetHead}>
          <div className={c.shWho}>
            <Status live={v.live} />
            <span className={`${c.side} ${v.dir > 0 ? c.sideL : c.sideS}`}>
              {v.dir > 0 ? "Long" : "Short"}
            </span>
            <span className={c.tSize}>{sizeWords(trade.sym, v.qty)}</span>
            <span className={c.tCode}>
              {v.inst.code} · {dayWord(trade.openedAt, now)}{" "}
              {clock(trade.openedAt)}
            </span>
          </div>
          <div className={c.shNums}>
            <span className={`${c.shPnl} ${tone}`}>{money(v.pnl)}</span>
            {v.r !== null && (
              <b
                className={tone}
              >{`${v.r >= 0 ? "+" : "−"}${Math.abs(v.r).toFixed(2)}R`}</b>
            )}
            <em>
              {v.live
                ? `Held ${held(now - trade.openedAt)}`
                : `Held ${held(span)}`}
            </em>
          </div>
          <button
            type="button"
            className={c.shClose}
            onClick={close}
            aria-label="Close"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </header>
        <div className={c.sheetBody}>
          <div className={c.sheetChart}>
            <Chart viewer focus={focus} until={until} marks={marks} />
          </div>
          <aside className={c.sheetSide}>
            <div className={c.sideTrade}>
              <TradeRuler v={v} />
              <Levels v={v} trade={trade} />
            </div>
            {kind === "live" ? (
              <Room trade={trade} now={now} />
            ) : (
              <div className={c.recap}>
                <dl className={c.recapFacts}>
                  <div>
                    <dt>Opened</dt>
                    <dd>
                      {dayWord(trade.openedAt, now)} {clockS(trade.openedAt)}
                    </dd>
                  </div>
                  <div>
                    <dt>Closed</dt>
                    <dd>
                      {closedAt
                        ? `${dayWord(closedAt, now)} ${clockS(closedAt)}`
                        : "Open"}
                    </dd>
                  </div>
                  <div>
                    <dt>Exit</dt>
                    <dd>{v.exit !== undefined ? fmt(v.exit) : "Open"}</dd>
                  </div>
                  <div>
                    <dt>Held</dt>
                    <dd>{held(span)}</dd>
                  </div>
                </dl>
                <div className={c.recapNotes}>
                  <span className={c.label}>Yazan&apos;s notes</span>
                  {said.length ? (
                    <ol>
                      {said.map((n) => (
                        <li key={n.id}>
                          <p>{n.text}</p>
                          <time>{clock(n.at)}</time>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className={c.none}>No notes on this trade.</p>
                  )}
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>,
    // inside the trader root, so the sheet takes the page's colours and theme
    document.querySelector("[data-trader-root]") ?? document.body,
  );
}

/* ------------------------------------------------------------------ */
/* trade history                                                       */
/* ------------------------------------------------------------------ */

function History({
  trades,
  now,
  onOpen,
}: {
  trades: Trade[];
  now: number;
  onOpen: (t: Trade) => void;
}) {
  const [shown, setShown] = useState(12);
  const rows = useMemo(
    () => [...trades].sort((a, b) => b.openedAt - a.openedAt),
    [trades],
  );
  if (!rows.length)
    return (
      <p className={c.none}>
        Closed trades land here once the next trade opens. The most recent one
        stays in the corner until then.
      </p>
    );
  return (
    <div className={c.hist}>
      <div className={c.histWrap}>
        <table className={c.log}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Market</th>
              <th>Side</th>
              <th>Size</th>
              <th>Entry</th>
              <th>Exit</th>
              <th>Hold</th>
              <th>R</th>
              <th className={c.r}>P&amp;L</th>
              <th aria-label="Open" />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((x, i) => {
              const r = x.risk ? x.pnl / x.risk : null;
              const exit = exitOf(x);
              return (
                <tr
                  key={x.id}
                  style={{ "--k": Math.min(i, 10) } as CSSProperties}
                  tabIndex={0}
                  onClick={() => onOpen(x)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpen(x);
                    }
                  }}
                  aria-label={`Open the ${x.side.toLowerCase()} ${INSTRUMENTS[x.sym].code} trade from ${dayWord(x.openedAt, now)} on the chart`}
                >
                  <td className={c.dimCell}>
                    {dayWord(x.openedAt, now)} <span>{clock(x.openedAt)}</span>
                  </td>
                  <td className={c.sym}>{INSTRUMENTS[x.sym].code}</td>
                  <td>
                    <span
                      className={`${c.side} ${x.side === "LONG" ? c.sideL : c.sideS}`}
                    >
                      {x.side === "LONG" ? "Long" : "Short"}
                    </span>
                  </td>
                  <td>{x.qty}</td>
                  <td>{fmt(entryOf(x))}</td>
                  <td>{exit !== undefined ? fmt(exit) : "–"}</td>
                  <td className={c.dimCell}>
                    {held((x.closedAt ?? now) - x.openedAt)}
                  </td>
                  <td
                    className={r === null ? c.dimCell : r >= 0 ? c.pos : c.neg}
                  >
                    {r === null
                      ? "–"
                      : `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(1)}R`}
                  </td>
                  <td className={`${c.r} ${x.pnl >= 0 ? c.pos : c.neg}`}>
                    {money(x.pnl)}
                  </td>
                  <td className={c.go}>
                    <span>
                      Chart
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 12 12"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M3.5 2.5h6v6M9.5 2.5l-7 7" />
                      </svg>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > shown && (
        <button
          type="button"
          className={c.more}
          onClick={() => setShown((n) => n + 12)}
        >
          Show {Math.min(12, rows.length - shown)} more
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* the page                                                            */
/* ------------------------------------------------------------------ */

const TODAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "long",
  month: "long",
  day: "numeric",
});

export function Community() {
  const ready = useDesk((st) => st.ready);
  const trades = useDesk((st) => st.trades);
  const now = useNow(15_000);
  const [open, setOpen] = useState<null | {
    id: string;
    kind: "live" | "history";
  }>(null);
  const wire = useFeed<Wire>("/api/watch/wire", 60_000);
  const cal = useFeed<Calendar>("/api/watch/calendar", 15 * 60_000);
  const calView = useCalView(!!cal.data?.events.length);
  useEffect(() => startRoom(), []);

  const record = useMemo(() => {
    const st = computeStats(TRADES);
    return { st, curve: st.curve };
  }, []);
  const trade = currentTrade(trades);
  const past = useMemo(
    () => trades.filter((x) => x.closedAt && x.id !== trade?.id),
    [trades, trade?.id],
  );
  const sheetTrade = open ? trades.find((x) => x.id === open.id) : undefined;

  let status: ReactNode = null;
  if (trade) status = <Status live={!trade.closedAt} />;

  return (
    <div className={c.sheet}>
      <i className={t.sheetR} aria-hidden="true" />
      <i className={t.sheetB} aria-hidden="true" />
      <div className={c.grid}>
        <Cell i={0} noTop className={c.aWelcome} bodyClass={c.welcome}>
          <div className={c.wTop}>
            <h1>Welcome</h1>
            <div className={c.wSide}>
              <span className={c.label}>{TODAY.format(now)}</span>
            </div>
          </div>
          <div className={c.band}>
            <div className={c.bandFacts}>
              <span className={c.label}>Yazan&apos;s record</span>
              <span>
                <b className={record.st.net >= 0 ? c.pos : c.neg}>
                  {money(record.st.net)}
                </b>
                <em>{record.st.count} trades</em>
                <em>{(record.st.winRate * 100).toFixed(0)}% won</em>
                <em>PF {record.st.pf.toFixed(2)}</em>
              </span>
            </div>
            <EquityChart
              curve={record.curve}
              trades={TRADES}
              compact
              className={c.equity}
            />
          </div>
        </Cell>

        <Cell
          i={1}
          noTop
          className={c.aTrade}
          label={trade && !trade.closedAt ? "Live trade" : "Last trade"}
          aside={status}
          bodyClass={c.body}
        >
          {ready && trade ? (
            <Preview
              trade={trade}
              now={now}
              onOpen={() => setOpen({ id: trade.id, kind: "live" })}
            />
          ) : ready ? (
            <p className={c.none}>
              No trades yet. When Yazan opens one, it shows here.
            </p>
          ) : null}
        </Cell>

        <Cell
          i={2}
          className={c.aWatch}
          label="Watcher"
          aside="Posts on X"
          bodyClass={c.bodyTall}
        >
          <XWatcher />
        </Cell>

        <Cell
          i={3}
          className={c.aCal}
          label="Calendar"
          aside={<CalControls v={calView} />}
          bodyClass={c.bodyMid}
        >
          <CalendarCard feed={cal} now={now} v={calView} />
        </Cell>

        <Cell
          i={4}
          className={c.aNews}
          label="News"
          aside="Markets and macro"
          bodyClass={c.bodyMid}
        >
          <News feed={wire} now={now} />
        </Cell>

        <Cell
          i={5}
          className={c.aHist}
          label="Trade history"
          aside={
            past.length
              ? `${past.length} ${past.length === 1 ? "trade" : "trades"} · ${money(past.reduce((a, x) => a + x.pnl, 0))}`
              : undefined
          }
          bodyClass={c.body}
        >
          {ready && (
            <History
              trades={past}
              now={now}
              onOpen={(x) => setOpen({ id: x.id, kind: "history" })}
            />
          )}
        </Cell>

        <Cell
          i={6}
          className={c.aMoves}
          label="Moves"
          aside="NQ and ES · this session"
          bodyClass={c.body}
        >
          <Moves now={now} />
        </Cell>
      </div>
      {sheetTrade && open && (
        <Sheet
          key={open.id + open.kind}
          trade={sheetTrade}
          kind={open.kind}
          now={now}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
