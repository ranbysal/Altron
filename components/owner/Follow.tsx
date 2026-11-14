"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as RKE, type PointerEvent as RPE, type ReactNode } from "react";
import { fmt } from "@/lib/format";
import { clock, clockS } from "@/lib/community/trades";
import { INSTRUMENTS } from "@/lib/desk/instruments";
import { getMarket, useDesk, type Fill, type Trade } from "@/lib/desk/store";
import { BAYER4 } from "@/lib/noise";
import { onThemeChange } from "@/lib/theme";
import { MICRO, PHASE_LABEL, PRESETS, type Rules, type Follow as FollowT, type His, type Limits, type LogItem, type Phase } from "@/lib/follow/engine";
import { restartFollow, setLimits, setRules, startOver, testAlert, useFollow } from "@/lib/follow/runner";
import { setOwner, useOwner } from "@/lib/owner/store";
import { Preview } from "@/components/community/Community";
import { Cell } from "@/components/trader/parts";
import s from "@/components/trader/trader.module.css";
import { headline, latestThought, mmss, money, Pending, Reasoning, signed, TradeSheets, useFollowView, type Open, type View } from "./Trades";
import f from "./follow.module.css";

const pct = (x: number) => `${Math.round(x * 100)}%`;

/* ------------------------------------------------------------------ */
/* the drawing: his trade and ours                                      */
/* ------------------------------------------------------------------ */

type Tag = { id: string; y: number; label: string; px: string; kind: "stop" | "target" | "his" | "you" | "order" | "ours" };
type Tick = { x: number; label: string; show: boolean; title: string };
type Geo = { tags: Tag[]; ticks: Tick[]; base: number };
type Tip = { x: number; y: number; t: number; p: number; his: number | null; mine: number | null; flip: boolean };

/** Short names for the steps along the time axis. */
function notch(l: LogItem): string | null {
  if (l.kind === "see") return "His entry";
  if (l.kind === "think") return l.text.startsWith("Passed") ? "Passed" : l.text.startsWith("Pulled") ? "Pulled" : l.text.startsWith("Holding") || l.text.startsWith("Waiting") ? null : "Decided";
  if (l.kind === "fill") return l.text.startsWith("First target") ? "Target 1" : "In";
  if (l.kind === "act") return l.text.startsWith("He closed") ? "His exit" : l.text.startsWith("Halfway") ? "Stop up" : null;
  if (l.kind === "out") return "Out";
  if (l.kind === "guard") return "Guard";
  return null;
}

/** Our P&L at a moment, from our fills up to then. */
function oursAt(fills: Fill[], t: number, p: number, pv: number): number | null {
  let qty = 0;
  let avg = 0;
  let real = 0;
  let any = false;
  for (const x of fills) {
    if (x.at > t) break;
    any = true;
    if (!qty || Math.sign(qty) === x.side) {
      avg = (avg * Math.abs(qty) + x.price * x.qty) / (Math.abs(qty) + x.qty);
      qty += x.side * x.qty;
    } else {
      const c = Math.min(Math.abs(qty), x.qty);
      real += (x.price - avg) * Math.sign(qty) * c * pv;
      qty += x.side * c;
    }
  }
  if (!any) return null;
  return real + (qty ? (p - avg) * qty * pv : 0);
}

function Duet({ trade, his, fl, own, fills, log }: { trade: Trade; his: His; fl?: FollowT; own?: Trade; fills: Fill[]; log: LogItem[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [theme, setTheme] = useState(0);
  const [beat, setBeat] = useState(0);
  const [geo, setGeo] = useState<Geo | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const geoKey = useRef("");
  const model = useRef<null | { line: { t: number; p: number }[]; X: (t: number) => number; Y: (p: number) => number; plotR: number }>(null);
  useEffect(() => onThemeChange(() => setTheme((n) => n + 1)), []);
  const live = !trade.closedAt || (!!own && !own.closedAt);
  useEffect(() => {
    const id = window.setInterval(() => setBeat((n) => n + 1), live ? 1000 : 15_000);
    return () => window.clearInterval(id);
  }, [live]);
  const inst = INSTRUMENTS[trade.sym];
  const pvMicro = MICRO[his.under].pv;

  useEffect(() => {
    const cv = ref.current;
    const m = getMarket();
    if (!cv || !m) return;
    const draw = () => {
      const W = cv.clientWidth;
      const H = cv.clientHeight;
      if (!W || !H) return;
      const now = Date.now();
      const end = Math.max(trade.closedAt ?? now, own ? (own.closedAt ?? now) : 0);
      const dur = Math.max(60_000, end - trade.openedAt);
      const a = trade.openedAt - Math.max(3 * 60_000, dur * 0.4);
      const done = !!trade.closedAt && (!own || !!own.closedAt);
      const b = done ? Math.min(now, end + Math.max(2 * 60_000, dur * 0.25)) : now;
      const secs = m.bars(his.under, 1);
      const useSecs = secs.length > 0 && secs[0].t <= a && b - a <= 50 * 60_000;
      const src = useSecs ? secs : m.bars(his.under, 60);
      let i0 = 0;
      let hiI = src.length;
      while (i0 < hiI) {
        const mid = (i0 + hiI) >> 1;
        if (src[mid].t < a) i0 = mid + 1;
        else hiI = mid;
      }
      const raw: { t: number; p: number }[] = [];
      for (let i = i0; i < src.length && src[i].t <= b; i++) raw.push({ t: src[i].t, p: src[i].c });
      if (raw.length < 2) return;
      const every = Math.max(1, Math.ceil(raw.length / (W / 2)));
      const line = raw.filter((_, k) => k % every === 0 || k === raw.length - 1);

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      const g = cv.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const cs = getComputedStyle(cv);
      const col = (n: string) => cs.getPropertyValue(n).trim();

      const working = fl?.status === "working" && fl.limit !== undefined ? fl.limit : undefined;
      const ourStop = fl?.status === "in" && own && !own.closedAt ? fl.stop : undefined;
      const ourAvg = own ? own.entryValue / Math.max(1, own.entryQty) : undefined;
      let lo = Infinity;
      let hi = -Infinity;
      for (const x of line) {
        lo = Math.min(lo, x.p);
        hi = Math.max(hi, x.p);
      }
      for (const p of [his.entry, his.stop, his.exit, ourAvg, working, ourStop, his.targets[0]]) {
        if (p === undefined) continue;
        lo = Math.min(lo, p);
        hi = Math.max(hi, p);
      }
      const padY = (hi - lo || 1) * 0.1;
      lo -= padY;
      hi += padY;
      // the tags live in a gutter on the right, so the live point never reaches the edge
      const plotR = W - (W > 560 ? 176 : 150);
      const TOP = 8;
      const BASE = H - 30;
      const t0 = line[0].t;
      const t1 = done ? line[line.length - 1].t : now;
      const X = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * plotR;
      const Y = (p: number) => TOP + (1 - (p - lo) / (hi - lo)) * (BASE - TOP);
      const onPlot = (p: number) => p >= lo && p <= hi;
      model.current = { line, X, Y, plotR };

      // the time he was in, a quiet wash
      const xa = X(trade.openedAt);
      const xb = X(trade.closedAt ?? t1);
      g.fillStyle = col("--hover");
      g.fillRect(xa, 0, Math.max(1, xb - xa), BASE);

      // glow under the price, in the colour of where we stand
      const lastP = line[line.length - 1].p;
      const up = (ourAvg !== undefined ? lastP - ourAvg : lastP - his.entry) * his.dir >= 0;
      const cell = 3;
      const ga = new Path2D();
      const gb = new Path2D();
      let k = 0;
      for (let x = 0; x < X(line[line.length - 1].t); x += cell) {
        const t = t0 + (x / plotR) * (t1 - t0);
        while (k < line.length - 1 && line[k + 1].t <= t) k++;
        const y0 = Y(line[k].p);
        const reach = Math.max(1, BASE - y0);
        for (let y = Math.ceil(y0 / cell) * cell; y < BASE; y += cell) {
          const ff = 1 - (y - y0) / reach;
          const I = 0.02 + 0.4 * ff * ff * ff;
          if (I > (BAYER4[((y / cell) & 3) * 4 + ((x / cell) & 3)] + 0.5) / 16) (I > 0.26 ? gb : ga).rect(x, y, 2, 2);
        }
      }
      g.fillStyle = col(up ? "--cv-dither-1" : "--cv-ember-1");
      g.fill(ga);
      g.fillStyle = col(up ? "--cv-dither-2" : "--cv-ember-2");
      g.fill(gb);

      const rule = (p: number, from: number, to: number, c: string, dash: number[], w = 1) => {
        if (!onPlot(p)) return;
        const y = Math.round(Y(p)) + 0.5;
        g.setLineDash(dash);
        g.strokeStyle = c;
        g.lineWidth = w;
        g.beginPath();
        g.moveTo(Math.max(0, from), y);
        g.lineTo(to, y);
        g.stroke();
        g.setLineDash([]);
      };
      for (const tp of his.targets) rule(tp, 0, W, col("--blue"), [4, 3]);
      if (his.stop !== undefined) rule(his.stop, 0, W, col("--ember"), [4, 3]);
      if (working !== undefined) rule(working, X(fl?.decidedAt ?? trade.openedAt), W, col("--dim"), [1, 4]);
      const firstIn = fills.find((x) => x.side === his.dir);
      if (ourAvg !== undefined && firstIn) rule(ourAvg, X(firstIn.at), own?.closedAt ? X(own.closedAt) : W, col("--text-strong"), []);
      if (ourStop !== undefined) rule(ourStop, X(fl?.enteredAt ?? trade.openedAt), W, col("--ember"), [], 1.25);
      // ours first and his dashes over it, so both read when we went in at his price
      rule(his.entry, xa, trade.closedAt ? xb : W, col("--his"), [5, 4], 1.5);

      g.beginPath();
      line.forEach((x, i) => (i ? g.lineTo(X(x.t), Y(x.p)) : g.moveTo(X(x.t), Y(x.p))));
      g.strokeStyle = col("--text-strong");
      g.lineWidth = 1.4;
      g.lineJoin = "round";
      g.stroke();

      const ring = (x: number, y: number, c: string) => {
        g.beginPath();
        g.arc(x, y, 4, 0, Math.PI * 2);
        g.fillStyle = col("--page");
        g.fill();
        g.strokeStyle = c;
        g.lineWidth = 1.6;
        g.stroke();
      };
      // his way in (a diamond, his colour) and out
      g.save();
      g.translate(xa, Y(his.entry));
      g.rotate(Math.PI / 4);
      g.fillStyle = col("--page");
      g.fillRect(-7.5, -7.5, 15, 15);
      g.fillStyle = col("--his");
      g.fillRect(-5.5, -5.5, 11, 11);
      g.restore();
      if (trade.closedAt && his.exit !== undefined) ring(xb, Y(his.exit), col("--his"));
      // ours: squares in, rings out
      for (const x of fills) {
        const fx = Math.round(X(x.at));
        const fy = Math.round(Y(x.price));
        if (x.side === his.dir) {
          g.fillStyle = col("--page");
          g.fillRect(fx - 4.5, fy - 4.5, 9, 9);
          g.fillStyle = col("--text-strong");
          g.fillRect(fx - 3, fy - 3, 6, 6);
        } else ring(fx, fy, col("--text-strong"));
      }
      if (!done) {
        const last = line[line.length - 1];
        g.fillStyle = col("--text-strong");
        g.fillRect(Math.round(X(last.t)) - 2.5, Math.round(Y(last.p)) - 2.5, 5, 5);
      }

      // the floor, and a notch for every step the agent took
      g.fillStyle = col("--tl");
      g.fillRect(0, BASE, W, 1);
      const ticks: Tick[] = [];
      let free = -Infinity;
      let lastLabel = "";
      for (const l of log) {
        const label = notch(l);
        if (!label) continue;
        const x = X(l.at);
        if (x < 0 || x > plotR + 1) continue;
        g.fillStyle = col(l.kind === "guard" ? "--ember" : "--text-strong");
        g.fillRect(Math.round(x), BASE - 3, 1, 8);
        if (label === lastLabel) continue;
        lastLabel = label;
        const half = (label.length * 6.4 + 12) / 2;
        const show = x - half > free;
        if (show) free = x + half;
        ticks.push({ x: Math.round(x), label, show, title: l.sub ? `${l.text}. ${l.sub}` : l.text });
      }

      // tags down the right edge, nudged apart where levels sit close
      const tags: Tag[] = [];
      his.targets.forEach((tp, i) => tags.push({ id: `t${i}`, y: Y(tp), label: his.targets.length > 1 ? `His target ${i + 1}` : "His target", px: fmt(tp), kind: "target" }));
      if (his.stop !== undefined) tags.push({ id: "hs", y: Y(his.stop), label: "His stop", px: fmt(his.stop), kind: "stop" });
      tags.push({ id: "his", y: Y(his.entry), label: "Yazan", px: fmt(his.entry), kind: "his" });
      if (ourAvg !== undefined) tags.push({ id: "you", y: Y(ourAvg) + 0.01, label: "You", px: fmt(ourAvg), kind: "you" });
      if (ourStop !== undefined) tags.push({ id: "os", y: Y(ourStop), label: "Our stop", px: fmt(ourStop), kind: "ours" });
      if (working !== undefined) tags.push({ id: "w", y: Y(working), label: "Asking", px: fmt(working), kind: "order" });
      const shown = tags.filter((x) => x.y >= TOP - 4 && x.y <= BASE + 4).sort((p, q) => p.y - q.y);
      const GAP = 21;
      for (let i = 1; i < shown.length; i++) if (shown[i].y - shown[i - 1].y < GAP) shown[i].y = shown[i - 1].y + GAP;
      const over = shown.length ? shown[shown.length - 1].y - (BASE - 10) : 0;
      if (over > 0) {
        shown[shown.length - 1].y -= over;
        for (let i = shown.length - 2; i >= 0; i--) if (shown[i + 1].y - shown[i].y < GAP) shown[i].y = shown[i + 1].y - GAP;
      }
      for (const x of shown) x.y = Math.round(x.y);
      const key = JSON.stringify([shown, ticks, BASE]);
      if (key !== geoKey.current) {
        geoKey.current = key;
        setGeo({ tags: shown, ticks, base: BASE });
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(cv);
    return () => ro.disconnect();
  }, [trade, his, fl, own, fills, log, theme, beat]);

  const move = (e: RPE<HTMLDivElement>) => {
    const md = model.current;
    if (!md) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const { line } = md;
    let lo = 0;
    let hi = line.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (md.X(line[mid].t) < x) lo = mid + 1;
      else hi = mid;
    }
    const pt = line[Math.max(0, Math.min(line.length - 1, lo))];
    const hisP = pt.t >= trade.openedAt && pt.t <= (trade.closedAt ?? Infinity) ? (pt.p - his.entry) * his.dir * trade.qty * inst.pv : null;
    const px = md.X(pt.t);
    setTip({ x: px, y: md.Y(pt.p), t: pt.t, p: pt.p, his: hisP, mine: oursAt(fills, pt.t, pt.p, pvMicro), flip: px > md.plotR - 190 });
  };

  return (
    <div className={f.duet} key={trade.id} onPointerMove={move} onPointerLeave={() => setTip(null)}>
      <div className={f.duetCv}>
        <canvas ref={ref} role="img" aria-label="Yazan's trade and ours on the price: his entry and targets, our fills and stop, and each step the agent took" />
      </div>
      {geo?.tags.map((x) => (
        <span key={x.id} className={f.tag} data-k={x.kind} style={{ top: x.y }}>
          <b>{x.label}</b>
          {x.px}
        </span>
      ))}
      {geo?.ticks.map(
        (x, i) =>
          x.show && (
            <span key={i} className={f.tick} data-done="" style={{ left: x.x, top: geo.base + 9 }} title={x.title}>
              {x.label}
            </span>
          ),
      )}
      {tip && geo && (
        <>
          <i className={f.hair} style={{ left: tip.x, height: geo.base }} aria-hidden="true" />
          <i className={f.hairDot} style={{ left: tip.x, top: tip.y }} aria-hidden="true" />
          <div className={f.tip} data-flip={tip.flip ? "" : undefined} style={{ left: tip.x }}>
            <span>
              {clockS(tip.t)} · {fmt(tip.p)}
            </span>
            <span data-k="his">
              Yazan <b className={tip.his === null ? undefined : tip.his >= 0 ? f.pos : f.neg}>{tip.his === null ? "Out" : signed(tip.his)}</b>
            </span>
            <span data-k="you">
              You <b className={tip.mine === null ? undefined : tip.mine >= 0 ? f.pos : f.neg}>{tip.mine === null ? "Out" : signed(tip.mine)}</b>
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function OpenBtn({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button type="button" className={f.openBtn} onClick={onClick}>
      <span>{children}</span>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3.5 2.5h6v6M9.5 2.5l-7 7" />
      </svg>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* the stage                                                            */
/* ------------------------------------------------------------------ */

function status(v: View): string {
  const { st, f: fl, trade, now, limits } = v;
  if (st?.halted) return "Stopped. Restart it when you're ready";
  if (!trade) return "Waiting for his first trade";
  if (fl?.status === "watching") return `Deciding · ${mmss(limits.window - (now - trade.openedAt) / 1000)} left`;
  if (fl?.status === "working") return fl.limit !== undefined ? `Order working at ${fmt(fl.limit)}` : "Going in";
  if (fl?.status === "in") return trade.closedAt ? "Closing with him" : "In with him";
  return "Waiting for his next trade";
}

function Stage({ v }: { v: View }) {
  const following = useOwner((x) => x.following);
  const [open, setOpen] = useState<Open>(null);
  const fills = useDesk((d) => d.fills);
  const own = v.own;
  const ownFills = useMemo(() => (own ? fills.filter((x) => x.tradeId === own.id) : []), [fills, own]);
  const last = latestThought(v);
  const { acct, rules, limits, trade, his } = v;
  const budget = acct ? Math.max(0, acct.usable) * limits.risk[acct.phase] : 0;
  const risk = v.f?.micros && v.f.stopDist && his && (v.f.status === "working" || v.f.status === "in") ? v.f.micros * v.f.stopDist * MICRO[his.under].pv : null;
  const head = headline(v);

  return (
    <>
      <header className={f.stageHead}>
        <button type="button" className={f.follow} data-on={following ? "" : undefined} aria-pressed={following} onClick={() => setOwner({ following: !following })}>
          <i />
          {following ? "Following Yazan" : "Paused"}
        </button>
        <span className={f.headMeta}>{status(v)}</span>
        <span className={f.headAcct}>
          {rules.name} · {rules.size / 1000}K · Paper
        </span>
      </header>
      {v.st?.halted && (
        <div className={f.halt} role="alert">
          <span>
            <b>Trading stopped at the stop line.</b> {v.st.halted.why}. Everything was closed at {clock(v.st.halted.at)} and nothing trades until you restart it.
          </span>
          <button type="button" onClick={restartFollow}>
            Restart
          </button>
        </div>
      )}

      <div className={f.hero}>
        <Cell i={0} label={trade && !trade.closedAt ? "Right now" : "His last trade"} aside={last ? clock(last.at) : undefined}>
          <div className={f.callSide}>
            <h2 className={f.call} key={head}>
              {head.split(" ").map((w, k) => (
                <span key={k} style={{ "--w": k } as CSSProperties}>
                  {w}{" "}
                </span>
              ))}
            </h2>
            {last ? (
              <p className={f.why} key={last.at + last.text}>
                {last.sub ? `${last.sub}.` : `${last.text}.`}
                {last.by && (
                  <span className={f.by} data-ai={last.by === "ai" ? "" : undefined}>
                    {last.by === "ai" ? "AI" : "Rules"}
                  </span>
                )}
              </p>
            ) : v.f?.why ? (
              <p className={f.why}>{v.f.why}.</p>
            ) : null}
            <dl className={f.trio}>
              <div>
                <dt>Phase</dt>
                <dd>{acct ? (acct.phase === "eval" ? "Eval" : acct.phase === "buffer" ? "Buffer" : "Built") : "–"}</dd>
                <dd>{acct ? PHASE_LABEL[acct.phase] : ""}</dd>
              </div>
              <div>
                <dt>Before the stop line</dt>
                <dd>{acct ? money(Math.max(0, acct.usable)) : "–"}</dd>
                <dd>{acct ? `${pct(acct.used)} of the drawdown used` : ""}</dd>
              </div>
              <div>
                <dt>{risk !== null ? "This trade risks" : "A trade can risk"}</dt>
                <dd>{money(risk ?? budget)}</dd>
                <dd>{risk !== null ? `of ${money(budget)} allowed` : `${pct(limits.risk[acct?.phase ?? "eval"])} of the room above the line`}</dd>
              </div>
            </dl>
          </div>
        </Cell>
        <Cell
          i={1}
          label="His trade and ours"
          aside={
            <span className={f.key}>
              <i data-k="his" />
              Yazan
              <i data-k="you" />
              You
            </span>
          }
          bodyClass={f.duetCell}
        >
          {v.ready && trade && his ? <Duet trade={trade} his={his} fl={v.f} own={own} fills={ownFills} log={v.log} /> : <p className={f.quiet}>When Yazan takes a trade, it draws here.</p>}
        </Cell>
      </div>

      <div className={f.twins}>
        <Cell
          i={2}
          label={
            <span className={f.who} data-k="his">
              Yazan
            </span>
          }
          aside={
            <em className={f.state} data-live={trade && !trade.closedAt ? "" : undefined}>
              {trade ? (trade.closedAt ? "Last trade" : "Live") : "No trades yet"}
            </em>
          }
        >
          {v.ready && trade ? (
            <div className={f.twin}>
              <Preview compact trade={trade} now={v.now} onOpen={() => setOpen("his")} />
              <footer className={f.twinFoot}>
                <p className={f.fine}>{his?.targets.length ? `${his.targets.length > 1 ? "Targets" : "Target"} ${his.targets.map((x) => fmt(x)).join(" and ")}${his.stop === undefined ? ", no stop posted." : "."}` : "No target posted."}</p>
                <OpenBtn onClick={() => setOpen("his")}>Chart and room</OpenBtn>
              </footer>
            </div>
          ) : (
            <p className={f.quiet}>When Yazan takes a trade, it shows here.</p>
          )}
        </Cell>
        <Cell
          i={3}
          label={
            <span className={f.who} data-k="you">
              You
            </span>
          }
          aside={
            <em className={f.state} data-live={own && !own.closedAt ? "" : undefined}>
              {own ? (own.closedAt ? "Closed" : "In") : v.f?.status === "passed" ? "Passed" : v.f?.status === "watching" ? "Deciding" : v.f?.status === "working" ? "Working" : ""}
            </em>
          }
        >
          {v.ready && own ? (
            <div className={f.twin}>
              <Preview compact who="mine" trade={own} now={v.now} onOpen={() => setOpen("mine")} />
              <footer className={f.twinFoot}>
                <p className={f.fine}>{v.f?.stop !== undefined && !own.closedAt ? `Our stop ${fmt(v.f.stop)}.${v.f.tp1Done ? " First target banked." : ""}` : v.f?.exitWhy ? `${v.f.exitWhy}.` : ""}</p>
                <OpenBtn onClick={() => setOpen("mine")}>Chart and agent</OpenBtn>
              </footer>
            </div>
          ) : v.ready && trade ? (
            <Pending v={v} />
          ) : (
            <p className={f.quiet}>Our side shows here once he trades.</p>
          )}
        </Cell>
      </div>
      <TradeSheets open={open} v={v} onClose={() => setOpen(null)} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* the reasoning across his last few trades                            */
/* ------------------------------------------------------------------ */

function Journal({ v }: { v: View }) {
  const hisTrades = useDesk((d) => (d.seat === "owner" && d.other ? d.other.trades : d.trades));
  const st = v.st;
  const groups = useMemo(() => {
    if (!st) return [];
    const list = Object.values(st.follows)
      .filter((x) => x.why !== "Before following started" && !x.why?.startsWith("Missed"))
      .sort((a, b) => b.seenAt - a.seenAt)
      .slice(0, 4);
    return list.map((fl) => ({ fl, t: hisTrades.find((x) => x.id === fl.his), log: st.log.filter((l) => l.his === fl.his) }));
  }, [st, hisTrades]);
  const general = st ? st.log.filter((l) => !l.his).slice(-4).reverse() : [];
  if (!groups.length && !general.length) return <p className={f.quiet}>The agent writes down every step here, starting with Yazan&apos;s next trade.</p>;
  return (
    <div className={f.journal}>
      {general.length > 0 && (
        <ul className={f.general}>
          {general.map((l) => (
            <li key={l.at + l.text} data-k={l.kind}>
              <time>{clock(l.at)}</time>
              <span>{l.text}</span>
            </li>
          ))}
        </ul>
      )}
      {groups.map(({ fl, t, log }, k) => (
        <section key={fl.his} className={f.jTrade} style={{ "--k": k } as CSSProperties}>
          <header>
            <span className={`${f.side} ${fl.dir > 0 ? f.sideL : f.sideS}`}>{fl.dir > 0 ? "Long" : "Short"}</span>
            <b>
              Yazan {t ? `${t.qty} ${INSTRUMENTS[t.sym].code}` : fl.under}
              {t ? ` · ${clock(t.openedAt)}` : ""}
            </b>
            <em data-s={fl.status} className={fl.status === "done" ? ((fl.pnl ?? 0) >= 0 ? f.pos : f.neg) : undefined}>
              {fl.status === "done" ? `${fl.exitWhy} · ${signed(fl.pnl ?? 0)}` : fl.status === "passed" ? "Passed" : fl.status === "in" ? "In" : fl.status === "working" ? "Working" : "Deciding"}
            </em>
          </header>
          {log.length ? <Reasoning log={log} compact /> : <p className={f.fine}>{fl.why}.</p>}
        </section>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* the account: phase, room, the stop line                             */
/* ------------------------------------------------------------------ */

const PHASES: Phase[] = ["eval", "buffer", "built"];

function AccountPanel({ v }: { v: View }) {
  const { acct, rules, limits, st } = v;
  const today = st ? (acct?.equity ?? 0) - st.dayStart : 0;
  if (!acct || !st) return <p className={f.quiet}>Loading the account.</p>;
  const line = st.floor + (1 - limits.stopLine) * rules.drawdown;
  const goal = acct.phase === "eval" ? acct.target : acct.phase === "buffer" ? rules.size + rules.drawdown : Math.max(acct.equity, rules.size + rules.drawdown) + rules.drawdown * 0.5;
  const lo = st.floor;
  const hi = Math.max(goal, acct.equity);
  const at = (x: number) => Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  const goalName = acct.phase === "eval" ? "Profit target" : acct.phase === "buffer" ? "Buffer built" : "Room to spare";
  const budget = Math.max(0, acct.usable) * limits.risk[acct.phase];
  return (
    <div className={f.acct}>
      <ol className={f.ladder}>
        {PHASES.map((p, i) => (
          <li key={p} data-on={p === acct.phase ? "" : undefined} data-past={PHASES.indexOf(acct.phase) > i ? "" : undefined}>
            <i aria-hidden="true" />
            <b>{PHASE_LABEL[p]}</b>
            <em>{p === "eval" ? `Make ${money(rules.profitTarget)}` : p === "buffer" ? `Smaller trades until ${money(rules.drawdown)} up` : "Bigger trades, then payouts"}</em>
          </li>
        ))}
      </ol>
      <div className={f.meter} style={{ "--eq": at(acct.equity), "--line": at(line), "--start": at(rules.size) } as CSSProperties}>
        <span className={f.meterTrack} aria-hidden="true">
          <i className={f.meterDanger} />
          <i className={f.meterFill} />
        </span>
        <i className={f.mLine} aria-hidden="true" />
        <i className={f.mStart} aria-hidden="true" />
        <i className={f.mEq} aria-hidden="true" />
        <span className={f.mLabels}>
          <span>
            Floor {fmt(st.floor, 0)}
            <em>{rules.trailing === "eod" ? "Trails the close" : "Trails live"}</em>
          </span>
          <span data-end="">
            {goalName} {fmt(goal, 0)}
            <em>{money(Math.max(0, goal - acct.equity))} to go</em>
          </span>
        </span>
        <span className={f.mLineTag}>Stop line</span>
      </div>
      <dl className={f.acctFacts}>
        <div>
          <dt>Equity</dt>
          <dd>{money(acct.equity)}</dd>
        </div>
        <div>
          <dt>Above the floor</dt>
          <dd>{money(acct.room)}</dd>
        </div>
        <div>
          <dt>Before the stop line</dt>
          <dd className={acct.usable < rules.drawdown * 0.15 ? f.neg : undefined}>{money(Math.max(0, acct.usable))}</dd>
        </div>
        <div>
          <dt>Today</dt>
          <dd className={today > 0.5 ? f.pos : today < -0.5 ? f.neg : undefined}>{signed(today)}</dd>
        </div>
        <div>
          <dt>A trade can risk</dt>
          <dd>{money(budget)}</dd>
        </div>
        <div>
          <dt>Stop line</dt>
          <dd>{fmt(line, 0)}</dd>
        </div>
      </dl>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* guardrails: numbers you drag                                         */
/* ------------------------------------------------------------------ */

function Scrub({ label, value, min, max, step, show, hint, onChange }: { label: string; value: number; min: number; max: number; step: number; show: (v: number) => string; hint: string; onChange: (v: number) => void }) {
  const drag = useRef<{ x: number; v: number } | null>(null);
  const [live, setLive] = useState(false);
  const clampTo = (v: number) => Math.round(Math.max(min, Math.min(max, v)) / step) * step;
  const down = (e: RPE<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, v: value };
    setLive(true);
  };
  const move = (e: RPE<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const w = e.currentTarget.clientWidth || 240;
    onChange(clampTo(d.v + ((e.clientX - d.x) / w) * (max - min)));
  };
  const up = () => {
    drag.current = null;
    setLive(false);
  };
  const key = (e: RKE<HTMLDivElement>) => {
    const by = e.shiftKey ? step * 5 : step;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") onChange(clampTo(value + by));
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") onChange(clampTo(value - by));
    else return;
    e.preventDefault();
  };
  return (
    <div
      className={f.scrubber}
      data-live={live ? "" : undefined}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Number(value.toFixed(3))}
      aria-valuetext={show(value)}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
      style={{ "--at": (value - min) / (max - min) } as CSSProperties}
    >
      <span className={f.k}>{label}</span>
      <b className={f.scrubVal}>{show(value)}</b>
      <span className={f.ruler} aria-hidden="true">
        <i />
      </span>
      <small>{hint}</small>
    </div>
  );
}

function Switch({ on, label, onClick, disabled = false }: { on: boolean; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className={f.switch} role="switch" aria-checked={on} aria-label={label} onClick={onClick} disabled={disabled}>
      <i />
    </button>
  );
}

function Guardrails({ limits }: { limits: Limits }) {
  const ai = useFollow((x) => x.ai);
  const r = (k: Phase, v: number) => setLimits({ risk: { ...limits.risk, [k]: v } });
  return (
    <div className={f.limits}>
      <div className={f.scrubs} data-n="3">
        <Scrub label="Risk · evaluation" value={limits.risk.eval} min={0.05} max={0.4} step={0.01} show={pct} hint="Of the room above the stop line, per trade" onChange={(v) => r("eval", v)} />
        <Scrub label="Risk · building buffer" value={limits.risk.buffer} min={0.02} max={0.3} step={0.01} show={pct} hint="Smaller while the funded account is thin" onChange={(v) => r("buffer", v)} />
        <Scrub label="Risk · buffer built" value={limits.risk.built} min={0.05} max={0.4} step={0.01} show={pct} hint="Of a bigger room, so trades grow with the buffer" onChange={(v) => r("built", v)} />
        <Scrub label="Stop line" value={limits.stopLine} min={0.5} max={0.9} step={0.05} show={(v) => `${pct(v)} used`} hint="Everything closes and waits for your restart" onChange={(v) => setLimits({ stopLine: v })} />
        <Scrub label="Daily stop" value={limits.dailyStop} min={0.1} max={0.6} step={0.05} show={pct} hint="No new trades once a day costs this much of its room" onChange={(v) => setLimits({ dailyStop: v })} />
        <Scrub label="Decision window" value={limits.window} min={30} max={300} step={10} show={(v) => mmss(v)} hint="From his entry. It can go in sooner, never later" onChange={(v) => setLimits({ window: v })} />
        <Scrub label="Least reward" value={limits.minRR} min={0.8} max={3} step={0.1} show={(v) => `${v.toFixed(1)}×`} hint="To his first target, against our stop" onChange={(v) => setLimits({ minRR: v })} />
        <Scrub label="Stop width" value={limits.stopAtr} min={2} max={8} step={0.5} show={(v) => `${v.toFixed(1)}×`} hint={`The average one-minute range, never under ${limits.minStop.NQ} NQ or ${limits.minStop.YM} US30 points`} onChange={(v) => setLimits({ stopAtr: v })} />
        <Scrub label="News" value={limits.newsMin} min={0} max={10} step={1} show={(v) => (v ? `${v} min` : "Off")} hint="No new trade this close to a high-impact release" onChange={(v) => setLimits({ newsMin: v })} />
      </div>
      <div className={f.toggleRow}>
        <span>
          <b>Let the AI decide</b>
          <em>{ai ? "It picks from the same menu and the guardrails check every answer. The rules take over if it's slow or down." : "No AI key on the server yet, so the rules decide everything."}</em>
        </span>
        <Switch on={limits.useAI && !!ai} label="Let the AI decide" onClick={() => setLimits({ useAI: !limits.useAI })} disabled={!ai} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* the firm's rules                                                    */
/* ------------------------------------------------------------------ */

function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <span className={f.seg} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.id)} type="button" role="radio" aria-checked={o.id === value} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </span>
  );
}

function Dollars({ value, onChange, label, empty }: { value: number | null; onChange: (v: number | null) => void; label: string; empty?: string }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => setText(value === null ? "" : String(value)), [value]);
  return (
    <span className={f.dollars}>
      <span aria-hidden="true">$</span>
      <input
        inputMode="numeric"
        aria-label={label}
        value={text ? Number(text).toLocaleString("en-US") : ""}
        placeholder={empty}
        onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ""))}
        onBlur={() => {
          const n = text ? Number(text) : null;
          if (n === null && empty) onChange(null);
          else if (n && n > 0) onChange(n);
          else setText(value === null ? "" : String(value));
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </span>
  );
}

function RulesForm() {
  const rules = useFollow((x) => x.rules);
  // a change by hand leaves the preset: the rules are now the owner's own
  const edit = (patch: Partial<Rules>) => setRules({ ...patch, preset: null });
  const [sure, setSure] = useState(false);
  useEffect(() => {
    if (!sure) return;
    const id = window.setTimeout(() => setSure(false), 4000);
    return () => window.clearTimeout(id);
  }, [sure]);
  return (
    <div className={f.rules}>
      <dl>
        <div>
          <dt>Firm</dt>
          <dd>
            <Seg
              label="Firm account"
              value={rules.preset ?? "custom"}
              options={[...PRESETS.map((p) => ({ id: p.id, label: p.label.replace("Lucid ", "") })), { id: "custom", label: "Custom" }]}
              onChange={(v) => {
                const p = PRESETS.find((x) => x.id === v);
                if (p) setRules(p.rules);
                else setRules({ preset: null });
              }}
            />
          </dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>
            <Seg label="Account size" value={rules.size} options={[50_000, 100_000, 150_000].map((x) => ({ id: x, label: `${x / 1000}K` }))} onChange={(v) => edit({ size: v })} />
          </dd>
        </div>
        <div>
          <dt>Drawdown</dt>
          <dd>
            <Dollars label="Drawdown" value={rules.drawdown} onChange={(v) => v && edit({ drawdown: v })} />
          </dd>
        </div>
        <div>
          <dt>Trails</dt>
          <dd>
            <Seg
              label="How the drawdown trails"
              value={rules.trailing}
              options={[
                { id: "eod", label: "End of day" },
                { id: "intraday", label: "Intraday" },
              ]}
              onChange={(v) => edit({ trailing: v })}
            />
          </dd>
        </div>
        <div>
          <dt>Profit target</dt>
          <dd>
            <Dollars label="Profit target" value={rules.profitTarget} onChange={(v) => v && edit({ profitTarget: v })} />
          </dd>
        </div>
        <div>
          <dt>Daily loss limit</dt>
          <dd>
            <Dollars label="Daily loss limit" value={rules.dailyLoss} empty="None" onChange={(v) => edit({ dailyLoss: v })} />
          </dd>
        </div>
        <div>
          <dt>Consistency</dt>
          <dd>
            <Seg
              label="Consistency rule"
              value={rules.consistency ?? 0}
              options={[
                { id: 0, label: "None" },
                { id: 0.4, label: "40%" },
                { id: 0.5, label: "50%" },
              ]}
              onChange={(v) => edit({ consistency: v || null })}
            />
          </dd>
        </div>
        <div>
          <dt>Most micros</dt>
          <dd>
            <Seg
              label="The most micros the firm allows"
              value={rules.firmMicros ?? 0}
              options={[
                { id: 60, label: "60" },
                { id: 100, label: "100" },
                { id: 0, label: "No cap" },
              ]}
              onChange={(v) => edit({ firmMicros: v || null })}
            />
          </dd>
        </div>
        <div>
          <dt>Funded</dt>
          <dd className={f.fundedRow}>
            <Switch on={rules.funded} label="Funded" onClick={() => setRules({ funded: !rules.funded })} />
            <em>{rules.funded ? "Building the buffer, then bigger" : "Still in the evaluation"}</em>
          </dd>
        </div>
      </dl>
      <footer className={f.rulesFoot}>
        <p className={f.fine}>{rules.preset ? `${PRESETS.find((p) => p.id === rules.preset)?.label}, as Lucid lists it. In the evaluation no day may make more than ${Math.round((rules.consistency ?? 0) * 100)}% of the target, so the engine stops adding a little short of ${money((rules.consistency ?? 0) * rules.profitTarget)} a day.` : "Your own rules. The engine reads them every second."}</p>
        <button type="button" className={f.ghostBtn} data-sure={sure ? "" : undefined} onClick={() => (sure ? (startOver(), setSure(false)) : setSure(true))}>
          {sure ? "Click again to start over" : "Start the paper account over"}
        </button>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* alerts and the AI                                                    */
/* ------------------------------------------------------------------ */

function Wiring() {
  const where = useFollow((x) => x.where);
  const ai = useFollow((x) => x.ai);
  const model = useFollow((x) => x.model);
  const discord = useFollow((x) => x.discord);
  const alerts = useFollow((x) => x.alerts);
  const wiring = useFollow((x) => x.wiring);
  const spend = useFollow((x) => x.spend);
  const calls = useFollow((x) => x.calls);
  const recent = alerts.slice(-5).reverse();
  const server = where === "server";
  const item = (on: boolean | null, name: string, yes: ReactNode, no: ReactNode) => (
    <div className={f.wire} data-on={on ? "" : undefined}>
      <i aria-hidden="true" />
      <b>{name}</b>
      <span>{on === null ? "Checking" : on ? yes : no}</span>
    </div>
  );
  const keyHome = server ? "Railway" : "Vercel";
  const used = spend?.usd ?? 0;
  const cap = wiring?.cap ?? 25;
  return (
    <div className={f.wiring}>
      <div className={f.wires}>
        {item(
          server,
          "Engine",
          "On the server, always on. It follows Yazan whether or not a page is open.",
          "In this page. It only runs while an owner page is open; the server takes over once it's deployed.",
        )}
        {item(
          discord,
          "Discord",
          "Connected. The stop line, a summary at each 5 PM close and the day's review go to your phone.",
          <>
            Not connected. Add the webhook URL in {keyHome} as <code>DISCORD_WEBHOOK_URL</code>.
          </>,
        )}
        {server && wiring ? (
          <>
            {item(
              wiring.anthropic,
              "Claude",
              <>
                {wiring.tiers.entry} (high) decides entries, {wiring.tiers.manage} manages open trades, {wiring.tiers.coach} (max) writes the day&apos;s review.
              </>,
              <>
                No key, so the rules decide everything. Add <code>ANTHROPIC_API_KEY</code> in Railway.
              </>,
            )}
            {item(
              wiring.google,
              "Gemini",
              <>{wiring.tiers.shadow} (high) answers every entry alongside, for comparing. It never places anything.</>,
              <>
                Off. Add <code>GEMINI_API_KEY</code> in Railway for a second opinion on entries.
              </>,
            )}
          </>
        ) : (
          item(
            ai,
            "AI",
            <>Connected ({model}). It reads each trade as it unfolds; the guardrails check every answer.</>,
            <>
              Not connected, so the rules decide everything. Add <code>ANTHROPIC_API_KEY</code> in {keyHome}.
            </>,
          )
        )}
        {server && (
          <div className={f.budget}>
            <span className={f.k}>AI this week</span>
            <b>
              ${used.toFixed(2)} <em>of ${cap}</em>
            </b>
            <span className={f.budgetBar} style={{ "--p": Math.min(1, used / cap) } as CSSProperties} aria-hidden="true">
              <i style={{ left: "70%" }} />
              <i style={{ left: "90%" }} />
            </span>
            <p className={f.fine}>Past 70% the second opinion stops; past 90% entries go to {wiring?.tiers.manage ?? "the quick model"}; at the cap the rules decide alone until Monday.</p>
          </div>
        )}
        <button type="button" className={f.ghostBtn} onClick={testAlert}>
          Send a test alert
        </button>
      </div>
      <div className={f.sent}>
        <span className={f.k}>Recent alerts</span>
        {recent.length ? (
          <ul>
            {recent.map((a) => (
              <li key={a.at + a.title} data-k={a.kind}>
                <time>{clock(a.at)}</time>
                <b>{a.title}</b>
                <em>{a.sent === null ? "Sending" : a.sent ? "Sent" : "Kept here"}</em>
              </li>
            ))}
          </ul>
        ) : (
          <p className={f.fine}>None yet. The first comes at the 5 PM close.</p>
        )}
        {server && (
          <>
            <span className={f.k}>The models, lately</span>
            {calls.length ? (
              <ul className={f.calls}>
                {calls
                  .slice(-8)
                  .reverse()
                  .map((c) => (
                    <li key={c.at + c.model} data-acted={c.acted ? "" : undefined} data-ok={c.ok ? "" : undefined}>
                      <time>{clock(c.at)}</time>
                      <b>
                        {c.label}
                        {c.kind !== "coach" && !c.acted && c.ok ? " · alongside" : ""}
                      </b>
                      <span>{c.ok ? (c.kind === "coach" ? "Wrote the day's review" : `${c.action?.replace("_", " ")}: ${c.reason}`) : c.error}</span>
                      <em>
                        ${c.usd.toFixed(3)} · {Math.round(c.ms / 1000)}s
                      </em>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className={f.fine}>No calls yet. The first comes with Yazan&apos;s next trade.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* the page                                                             */
/* ------------------------------------------------------------------ */

export function Follow() {
  const v = useFollowView();
  return (
    <div className={f.page}>
      <div className={s.sheet}>
        <i className={s.sheetR} aria-hidden="true" />
        <i className={s.sheetB} aria-hidden="true" />
        <Stage v={v} />
        <div className={f.acctRow}>
          <Cell i={4} label="The agent's reasoning" aside="Every step, as it happened">
            <Journal v={v} />
          </Cell>
          <Cell i={5} label="The account" aside={v.acct ? PHASE_LABEL[v.acct.phase] : undefined}>
            <AccountPanel v={v} />
          </Cell>
        </div>
        <div className={f.acctRow}>
          <Cell i={6} label="Guardrails" aside="Enforced in code, whatever the AI says">
            <Guardrails limits={v.limits} />
          </Cell>
          <Cell i={7} label="Account rules" aside="From the firm">
            <RulesForm />
          </Cell>
        </div>
        <div className={s.row1}>
          <Cell i={8} label="Alerts and the AI">
            <Wiring />
          </Cell>
        </div>
      </div>
      <p className={f.sample}>Paper trading on simulated prices. Yazan&apos;s trades come from his desk; ours go on a paper book until an account is connected.</p>
    </div>
  );
}
