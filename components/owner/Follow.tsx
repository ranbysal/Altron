"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as RKE, type PointerEvent as RPE } from "react";
import { fmt, money } from "@/lib/format";
import { dayLabel } from "@/lib/journal";
import { hhmm } from "@/lib/format";
import { clock, clockS } from "@/lib/community/trades";
import { INSTRUMENTS } from "@/lib/desk/instruments";
import { getMarket, type Trade } from "@/lib/desk/store";
import { BAYER4 } from "@/lib/noise";
import { onThemeChange } from "@/lib/theme";
import { ACCOUNTS, METHODS, MICRO_VALUE, MODE_LABEL, replay, summarize, type Method, type Result, type Row } from "@/lib/owner/replay";
import type { Plan } from "@/lib/owner/live";
import { setOwner, setSetting, useOwner } from "@/lib/owner/store";
import { Preview } from "@/components/community/Community";
import { CALL, TradeSheets, useLive, Waiting, type Open } from "./Trades";
import { Cell, Money } from "@/components/trader/parts";
import s from "@/components/trader/trader.module.css";
import { useOwnerReplay } from "./OwnerDashboard";
import f from "./follow.module.css";

const plain = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const signed = (n: number) => (n >= 0 ? "+" : "−") + plain(n);

/* ------------------------------------------------------------------ */
/* the stage: the call, one drawing of both trades, then him and us     */
/* ------------------------------------------------------------------ */

function Countdown({ to, now }: { to: number; now: number }) {
  const sec = Math.max(0, Math.round((to - now) / 1000));
  return (
    <>
      {Math.floor(sec / 60)}:{String(sec % 60).padStart(2, "0")}
    </>
  );
}

type Tag = { id: string; y: number; label: string; px: string; kind: "stop" | "target" | "his" | "you" | "order" };
type Tick = { x: number; label: string; done: boolean; show: boolean; title: string };
type Geo = { tags: Tag[]; ticks: Tick[]; base: number; from: number; to: number; live: boolean };
type Tip = { x: number; y: number; t: number; p: number; his: number | null; mine: number | null; flip: boolean };

/**
 * His trade and ours on one drawing: the price since he went in, his entry, stop and target in
 * his colour, our fills and working orders in ours, and the agent's steps along the time axis
 * where they happened. Move over it to read both results at any moment.
 */
function Duet({ trade, plan }: { trade: Trade; plan: Plan }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [theme, setTheme] = useState(0);
  const [geo, setGeo] = useState<Geo | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const geoKey = useRef("");
  const model = useRef<null | { line: { t: number; p: number }[]; X: (t: number) => number; Y: (p: number) => number; plotR: number; W: number }>(null);
  useEffect(() => onThemeChange(() => setTheme((n) => n + 1)), []);

  const inst = INSTRUMENTS[trade.sym];
  const myEnd = plan.own?.closedAt ?? trade.closedAt ?? Infinity;
  const myExit = plan.own?.closedAt && plan.own.exitQty ? plan.own.exitValue / plan.own.exitQty : undefined;

  useEffect(() => {
    const cv = ref.current;
    const m = getMarket();
    if (!cv || !m) return;
    const draw = () => {
      const W = cv.clientWidth;
      const H = cv.clientHeight;
      if (!W || !H) return;
      const now = Date.now();
      const live = plan.live;
      const end = trade.closedAt ?? now;
      const dur = Math.max(60_000, end - trade.openedAt);
      const a = trade.openedAt - Math.max(3 * 60_000, dur * 0.45);
      const b = trade.closedAt ? Math.min(now, end + Math.max(2 * 60_000, dur * 0.3)) : now;
      const secs = m.bars(inst.under, 1);
      const useSecs = secs.length > 0 && secs[0].t <= a && b - a <= 50 * 60_000;
      const src = useSecs ? secs : m.bars(inst.under, 60);
      let i0 = 0;
      let hiI = src.length;
      while (i0 < hiI) {
        const mid = (i0 + hiI) >> 1;
        if (src[mid].t < a) i0 = mid + 1;
        else hiI = mid;
      }
      const pts: { t: number; p: number }[] = [];
      for (let i = i0; i < src.length && src[i].t <= b; i++) pts.push({ t: src[i].t, p: src[i].c });
      if (pts.length < 2) return;
      const every = Math.max(1, Math.ceil(pts.length / (W / 2)));
      const line = pts.filter((_, k) => k % every === 0 || k === pts.length - 1);

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      const g = cv.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const cs = getComputedStyle(cv);
      const col = (n: string) => cs.getPropertyValue(n).trim();

      const working = live && !plan.byHand && plan.state !== "Deciding" ? plan.tranches.filter((x) => x.filledAt === null) : [];
      let lo = Infinity;
      let hi = -Infinity;
      for (const x of line) {
        lo = Math.min(lo, x.p);
        hi = Math.max(hi, x.p);
      }
      for (const p of [plan.entry, plan.stop, plan.target, plan.exit, plan.avg ?? undefined, ...working.map((x) => x.price)]) {
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
      const t1 = live ? now : line[line.length - 1].t;
      const X = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * plotR;
      const Y = (p: number) => TOP + (1 - (p - lo) / (hi - lo)) * (BASE - TOP);
      model.current = { line, X, Y, plotR, W };

      // the time he was in, a quiet wash
      const xa = X(trade.openedAt);
      const xb = X(trade.closedAt ?? t1);
      g.fillStyle = col("--hover");
      g.fillRect(xa, 0, Math.max(1, xb - xa), BASE);

      // glow under the price, dithered, in the colour of our result
      const up = (plan.filled.length ? plan.pnl : trade.pnl + (live ? (line[line.length - 1].p - plan.entry) * plan.dir : 0)) >= 0;
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
          const f = 1 - (y - y0) / reach;
          const I = 0.02 + 0.4 * f * f * f;
          if (I > (BAYER4[((y / cell) & 3) * 4 + ((x / cell) & 3)] + 0.5) / 16) (I > 0.26 ? gb : ga).rect(x, y, 2, 2);
        }
      }
      g.fillStyle = col(up ? "--cv-dither-1" : "--cv-ember-1");
      g.fill(ga);
      g.fillStyle = col(up ? "--cv-dither-2" : "--cv-ember-2");
      g.fill(gb);

      const rule = (p: number, from: number, c: string, dash: number[], w = 1) => {
        const y = Math.round(Y(p)) + 0.5;
        g.setLineDash(dash);
        g.strokeStyle = c;
        g.lineWidth = w;
        g.beginPath();
        g.moveTo(Math.max(0, from), y);
        g.lineTo(W, y);
        g.stroke();
        g.setLineDash([]);
      };
      rule(plan.stop, 0, col("--ember"), [4, 3]);
      if (plan.target !== undefined) rule(plan.target, 0, col("--blue"), [4, 3]);
      for (const x of working) rule(x.price, xa, col("--dim"), [1, 4]);
      // ours first and his dashes over it, so both read when we went in at his price
      const firstFill = plan.filled.length ? Math.min(...plan.filled.map((x) => x.filledAt!)) : null;
      if (plan.avg !== null && firstFill !== null) rule(plan.avg, X(firstFill), col("--text-strong"), []);
      rule(plan.entry, xa, col("--his"), [5, 4], 1.5);

      // the price
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
      g.translate(xa, Y(plan.entry));
      g.rotate(Math.PI / 4);
      g.fillStyle = col("--page");
      g.fillRect(-7.5, -7.5, 15, 15);
      g.fillStyle = col("--his");
      g.fillRect(-5.5, -5.5, 11, 11);
      g.restore();
      if (trade.closedAt && plan.exit !== undefined) ring(xb, Y(plan.exit), col("--his"));
      // our fills (squares, ours) and our way out when it wasn't his
      for (const x of plan.filled) {
        const fx = Math.round(X(x.filledAt!));
        const fy = Math.round(Y(x.price));
        g.fillStyle = col("--page");
        g.fillRect(fx - 4.5, fy - 4.5, 9, 9);
        g.fillStyle = col("--text-strong");
        g.fillRect(fx - 3, fy - 3, 6, 6);
      }
      if (plan.byHand && myExit !== undefined && Number.isFinite(myEnd)) ring(X(myEnd), Y(myExit), col("--text-strong"));
      if (live) {
        const last = line[line.length - 1];
        g.fillStyle = col("--text-strong");
        g.fillRect(Math.round(X(last.t)) - 2.5, Math.round(Y(last.p)) - 2.5, 5, 5);
      }

      // the floor, and a notch for every step the agent took
      g.fillStyle = col("--tl");
      g.fillRect(0, BASE, W, 1);
      const ticks: Tick[] = [];
      let free = -Infinity;
      for (const st of plan.steps) {
        const x = X(st.at);
        if (x < 0 || x > plotR + 1) continue;
        g.fillStyle = col(st.done ? "--text-strong" : "--dim");
        g.fillRect(Math.round(x), BASE - 3, 1, 8);
        const half = (st.short.length * 6.4 + 12) / 2;
        const show = x - half > free;
        if (show) free = x + half;
        ticks.push({ x: Math.round(x), label: st.short, done: st.done, show, title: st.sub ? `${st.text}. ${st.sub}` : st.text });
      }

      // tags down the right edge, nudged apart where levels sit close
      const tags: Tag[] = [{ id: "stop", y: Y(plan.stop), label: "His stop", px: fmt(plan.stop), kind: "stop" }];
      if (plan.target !== undefined) tags.push({ id: "target", y: Y(plan.target), label: "His target", px: fmt(plan.target), kind: "target" });
      tags.push({ id: "his", y: Y(plan.entry), label: "Yazan", px: fmt(plan.entry), kind: "his" });
      if (plan.avg !== null) tags.push({ id: "you", y: Y(plan.avg) + 0.01, label: "You", px: fmt(plan.avg), kind: "you" });
      working.forEach((x, i) => tags.push({ id: `w${i}`, y: Y(x.price), label: "Working", px: fmt(x.price), kind: "order" }));
      tags.sort((p, q) => p.y - q.y);
      const GAP = 21;
      for (let i = 1; i < tags.length; i++) if (tags[i].y - tags[i - 1].y < GAP) tags[i].y = tags[i - 1].y + GAP;
      const over = tags.length ? tags[tags.length - 1].y - (BASE - 10) : 0;
      if (over > 0) {
        tags[tags.length - 1].y -= over;
        for (let i = tags.length - 2; i >= 0; i--) if (tags[i + 1].y - tags[i].y < GAP) tags[i].y = tags[i + 1].y - GAP;
      }
      for (const x of tags) x.y = Math.round(x.y);
      const next: Geo = { tags, ticks, base: BASE, from: t0, to: t1, live };
      const key = JSON.stringify([tags, ticks, BASE, Math.round(t0 / 1000), live ? 0 : Math.round(t1 / 1000)]);
      if (key !== geoKey.current) {
        geoKey.current = key;
        setGeo(next);
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(cv);
    return () => ro.disconnect();
  }, [trade, plan, inst.under, myEnd, myExit, theme]);

  const move = (e: RPE<HTMLDivElement>) => {
    const md = model.current;
    if (!md) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const { line } = md;
    // the nearest point of the price to the pointer
    let lo = 0;
    let hi = line.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (md.X(line[mid].t) < x) lo = mid + 1;
      else hi = mid;
    }
    const pt = line[Math.max(0, Math.min(line.length - 1, lo))];
    const end = trade.closedAt ?? Infinity;
    const his = pt.t >= trade.openedAt && pt.t <= end ? (pt.p - plan.entry) * plan.dir * trade.qty * inst.pv : null;
    const mineIn = plan.filled.filter((f) => f.filledAt! <= pt.t);
    const mine = mineIn.length && pt.t <= myEnd ? mineIn.reduce((acc, f) => acc + plan.per * (pt.p - f.price) * plan.dir * MICRO_VALUE[inst.under], 0) : null;
    const px = md.X(pt.t);
    setTip({ x: px, y: md.Y(pt.p), t: pt.t, p: pt.p, his, mine, flip: px > md.plotR - 190 });
  };

  return (
    <div className={f.duet} key={trade.id} onPointerMove={move} onPointerLeave={() => setTip(null)}>
      <div className={f.duetCv}>
        <canvas ref={ref} role="img" aria-label="Yazan's trade and ours on the price: his entry, stop and target, our fills, and the agent's steps in time" />
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
            <span key={i} className={f.tick} data-done={x.done ? "" : undefined} style={{ left: x.x, top: geo.base + 9 }} title={x.title}>
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

function Stage() {
  const following = useOwner((x) => x.following);
  const { trade, plan, now, ready } = useLive();
  const [open, setOpen] = useState<Open>(null);
  const next = plan?.steps.find((x) => !x.done);
  const acct = ACCOUNTS.length === 1 ? `${ACCOUNTS[0].name} · ${ACCOUNTS[0].size / 1000}K` : `${ACCOUNTS.length} accounts`;

  return (
    <>
      <header className={f.stageHead}>
        <button type="button" className={f.follow} data-on={following ? "" : undefined} aria-pressed={following} onClick={() => setOwner({ following: !following })}>
          <i />
          {following ? "Following Yazan" : "Paused"}
        </button>
        <span className={f.headMeta}>
          {!following ? (
            "The agent is standing down"
          ) : plan?.live && plan.byHand ? (
            "You're out. He's still in"
          ) : plan?.live && next ? (
            <>
              Next check in{" "}
              <b>
                <Countdown to={next.at} now={now} />
              </b>
            </>
          ) : plan?.live ? (
            "Watching for his exit"
          ) : (
            "Waiting for his next trade"
          )}
        </span>
        <span className={f.headAcct}>{acct}</span>
      </header>

      <div className={f.hero}>
        <Cell i={0} label={plan?.live ? "The call" : "The last call"} aside={plan ? clock(plan.placed) : undefined}>
          {plan ? (
            <div className={f.callSide}>
              <h2 className={f.call} key={plan.trade.id + plan.mode}>
                {CALL[plan.mode].split(" ").map((w, k) => (
                  <span key={k} style={{ "--w": k } as CSSProperties}>
                    {w}{" "}
                  </span>
                ))}
              </h2>
              <p className={f.why}>{plan.reason}.</p>
              {!plan.live && (
                <p className={f.result}>
                  He made <b className={plan.trade.pnl >= 0 ? f.pos : f.neg}>{signed(plan.trade.pnl)}</b>. We made <b className={plan.pnl >= 0 ? f.pos : f.neg}>{plan.filled.length ? signed(plan.pnl) : "$0"}</b>.
                </p>
              )}
              <dl className={f.trio}>
                <div>
                  <dt>His risk</dt>
                  <dd>{pct(plan.share)}</dd>
                  <dd>of his room</dd>
                </div>
                <div>
                  <dt>Ours</dt>
                  <dd>{pct(plan.ourShare)}</dd>
                  <dd>of our room</dd>
                </div>
                <div>
                  <dt>Similar trades</dt>
                  <dd>{plan.look[0]?.n ?? 0}</dd>
                  <dd>{pct(plan.look.find((x) => x.mode === plan.mode)?.win ?? 0)} paid this way</dd>
                </div>
              </dl>
            </div>
          ) : (
            <h2 className={f.call}>Waiting for his first trade.</h2>
          )}
        </Cell>
        <Cell
          i={1}
          label="One trade, both of us"
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
          {ready && trade && plan ? <Duet trade={trade} plan={plan} /> : <p className={f.quiet}>When Yazan takes a trade, it draws here.</p>}
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
          aside={<em className={f.state} data-live={plan?.live ? "" : undefined}>{plan?.live ? "Live" : trade ? "Last trade" : "No trades yet"}</em>}
        >
          {ready && trade ? (
            <div className={f.twin}>
              <Preview compact trade={trade} now={now} onOpen={() => setOpen("his")} />
              <footer className={f.twinFoot}>
                <p className={f.fine}>{plan ? `Risking ${pct(plan.share)} of his room on this one.` : ""}</p>
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
          aside={<em className={f.state} data-live={plan?.ownLive ? "" : undefined}>{plan ? (plan.byHand ? "Closed by hand" : plan.state) : acct}</em>}
        >
          {plan?.own ? (
            <div className={f.twin}>
              <Preview compact who="mine" trade={plan.own} now={now} onOpen={() => setOpen("mine")} />
              <footer className={f.twinFoot}>
                <p className={f.fine}>
                  {plan.filled.length} of {plan.tranches.length} {plan.tranches.length === 1 ? "order" : "orders"} filled
                  {plan.ownLive ? `. Worst case ${plain(plan.worst)}, ${pct(plan.ourShare)} of our room.` : "."}
                </p>
                <OpenBtn onClick={() => setOpen("mine")}>Chart and agent</OpenBtn>
              </footer>
            </div>
          ) : plan ? (
            <Waiting plan={plan} />
          ) : (
            <p className={f.quiet}>Our side shows here once he trades.</p>
          )}
        </Cell>
      </div>
      <TradeSheets open={open} trade={trade} plan={plan} now={now} onClose={() => setOpen(null)} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* the account                                                          */
/* ------------------------------------------------------------------ */

/** Balance against the floor over his history, the room between them in the dither. */
function RoomChart({ track, size }: { track: Result["track"][string]; size: number }) {
  const W = 760;
  const H = 210;
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const n = track.length;
  const lo = Math.min(...track.map((x) => x.floor)) - 300;
  const hi = Math.max(...track.map((x) => x.balance)) + 300;
  const X = (i: number) => (i / (n - 1)) * (W - 70);
  const Y = (v: number) => 10 + (1 - (v - lo) / (hi - lo)) * (H - 28);
  const balPts = track.map((x, i) => [X(i), Y(x.balance)] as const);
  const bal = balPts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  // the floor only moves at the close, so it steps
  const floorPts: [number, number][] = [[0, Y(track[0].floor)]];
  for (let i = 1; i < n; i++) {
    floorPts.push([X(i), floorPts[floorPts.length - 1][1]]);
    floorPts.push([X(i), Y(track[i].floor)]);
  }
  const floor = floorPts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${bal} ${[...floorPts]
    .reverse()
    .map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ")} Z`;
  const lock = size + 100;
  const h = hover !== null ? track[hover] : null;
  const move = (e: RPE<SVGSVGElement>) => {
    const r = ref.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.round((x / (W - 70)) * (n - 1)))));
  };
  const endB = Y(track[n - 1].balance);
  const endF = Y(track[n - 1].floor);
  return (
    <div className={f.roomChart}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onPointerMove={move} onPointerLeave={() => setHover(null)} role="img" aria-label="Balance against the firm's floor over his history">
        <defs>
          <pattern id="room-dots" width="4" height="4" patternUnits="userSpaceOnUse">
            <rect width="1.7" height="1.7" className={f.dot} />
          </pattern>
        </defs>
        <path d={area} fill="url(#room-dots)" />
        {lock > lo && lock < hi && <line x1="0" x2={W - 70} y1={Y(lock)} y2={Y(lock)} className={f.lockRule} />}
        <path d={floor} className={f.floorLine} />
        <path d={bal} className={f.balLine} />
        <rect x={X(n - 1) - 3} y={endB - 3} width="6" height="6" className={f.endSq} />
        {hover !== null && <line x1={X(hover)} x2={X(hover)} y1="4" y2={H - 14} className={f.scrub} />}
      </svg>
      <span className={f.roomTag} style={{ top: `${(endB / H) * 100}%` }}>
        Balance
      </span>
      <span className={`${f.roomTag} ${f.roomTagFloor}`} style={{ top: `${(Math.max(endF, endB + 18) / H) * 100}%` }}>
        Floor
      </span>
      {h && (
        <div className={f.roomTip} style={{ left: `${(X(hover!) / W) * 100}%` }}>
          <span>After trade {hover}</span>
          <b>{plain(h.balance)}</b>
          <em>
            {plain(h.balance - h.floor)} above the floor{h.paid ? ` · ${plain(h.paid)} paid out` : ""}
          </em>
        </div>
      )}
    </div>
  );
}

function Account({ result }: { result: Result }) {
  const a = ACCOUNTS.find((x) => x.lead) ?? ACCOUNTS[0];
  const st = result.accounts[a.id];
  const room = st.balance - st.floor;
  const lock = a.size + 100;
  const locked = st.floor >= lock;
  const payoutAt = st.floor + 5_000;
  const paused = useOwner((x) => x.paused);
  // the gauge runs from the floor to where a payout is due
  const span = Math.max(payoutAt, st.balance) - st.floor;
  const g = (v: number) => Math.max(0, Math.min(1, (v - st.floor) / span));
  return (
    <div className={f.account}>
      <div className={f.acctTop}>
        <div>
          <span className={f.k}>Balance</span>
          <Money value={money(st.balance).replace("+", "")} className={f.acctBal} />
        </div>
        <div className={f.acctRoom}>
          <span className={f.k}>Room to the floor</span>
          <b>{plain(room)}</b>
        </div>
      </div>
      <div className={f.gauge} style={{ "--b": g(st.balance), "--l": g(lock) } as CSSProperties}>
        <span className={f.gaugeLine} aria-hidden="true" />
        <span className={f.gaugeFill} aria-hidden="true" />
        <i className={f.gFloor} />
        <i className={f.gBal} />
        {!locked && <i className={f.gLock} />}
        <i className={f.gPay} />
        <span className={f.gLabels}>
          <span>
            Floor {fmt(st.floor, 0)}
            <em>{locked ? "Locked" : "Trails the close"}</em>
          </span>
          <span data-end="">
            Payout at {fmt(payoutAt, 0)}
            <em>{plain(Math.max(0, payoutAt - st.balance))} to go</em>
          </span>
        </span>
      </div>
      <RoomChart track={result.track[a.id]} size={a.size} />
      <dl className={f.acctFacts}>
        <div>
          <dt>Account</dt>
          <dd>
            {a.name} · {a.size / 1000}K
          </dd>
        </div>
        <div>
          <dt>Firm drawdown</dt>
          <dd>{plain(a.dd)}, end of day</dd>
        </div>
        <div>
          <dt>Paid out</dt>
          <dd>{plain(st.payouts)}</dd>
        </div>
        <div>
          <dt>Worst drawdown</dt>
          <dd className={st.maxDD < 0 ? f.neg : undefined}>{st.maxDD < 0 ? `−${plain(st.maxDD)}` : "None"}</dd>
        </div>
      </dl>
      {ACCOUNTS.length > 1 && (
        <ul className={f.others}>
          {ACCOUNTS.map((x) => {
            const y = result.accounts[x.id];
            const on = !paused[x.id] && y.breachedAt === null;
            return (
              <li key={x.id}>
                <b>{x.name}</b>
                <span>{x.size / 1000}K</span>
                <span>{plain(y.balance - y.floor)} room</span>
                <button type="button" className={f.switch} role="switch" aria-checked={on} onClick={() => setOwner({ paused: { ...paused, [x.id]: on } })} aria-label={`${on ? "Pause" : "Resume"} ${x.name}`}>
                  <i />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* limits: numbers you drag                                             */
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
  const at = (value - min) / (max - min);
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
      style={{ "--at": at } as CSSProperties}
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

function Limits() {
  const st = useOwner((x) => x.settings);
  return (
    <div className={f.limits}>
      <div className={f.scrubs}>
        <Scrub label="Follow strength" value={st.follow} min={0.5} max={2} step={0.05} show={(v) => `${v.toFixed(2)}×`} hint="Our risk against his, each as a share of room" onChange={(v) => setSetting("follow", v)} />
        <Scrub label="Max loss a trade" value={st.maxRisk} min={0.05} max={0.4} step={0.01} show={(v) => pct(v)} hint="Of our room, whatever the agent decides" onChange={(v) => setSetting("maxRisk", v)} />
        <Scrub label="Daily stop" value={st.dailyStop} min={0.1} max={0.6} step={0.05} show={(v) => pct(v)} hint="No new trades once the day costs this much" onChange={(v) => setSetting("dailyStop", v)} />
        <Scrub label="Caution" value={st.caution} min={0} max={0.25} step={0.01} show={(v) => v.toFixed(2)} hint="Steadier, smaller results as it rises" onChange={(v) => setSetting("caution", v)} />
      </div>
      <div className={f.toggleRow}>
        <span>
          <b>Skip near releases</b>
          <em>No new trade with a scheduled release due within ten minutes</em>
        </span>
        <button type="button" className={f.switch} role="switch" aria-checked={st.skipNews} onClick={() => setSetting("skipNews", !st.skipNews)} aria-label="Skip near releases">
          <i />
        </button>
      </div>
      <p className={f.fine}>Drag a number sideways, or use the arrow keys. Everything below reruns as you do.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* six ways in                                                          */
/* ------------------------------------------------------------------ */

type Run = { id: Method; label: string; blurb: string; sum: ReturnType<typeof summarize> };

function Ways({ result }: { result: Result }) {
  const settings = useOwner((x) => x.settings);
  const method = useOwner((x) => x.method);
  const runs: Run[] = useMemo(() => METHODS.map((m) => ({ ...m, sum: summarize(m.id === method ? result : replay(m.id, settings)) })), [settings, method, result]);
  const maxNet = Math.max(1, ...runs.map((r) => Math.abs(r.sum.net)));
  const maxDD = Math.max(1, ...runs.map((r) => -r.sum.maxDD));
  const score = (r: Run) => r.sum.net / Math.max(1, -r.sum.maxDD);
  const best = runs.filter((r) => r.id !== "full").reduce((a, r) => (score(r) > score(a) ? r : a));
  const [hot, setHot] = useState<Method | null>(null);
  return (
    <div className={f.ways}>
      <div className={f.spine}>
        <div className={f.spineHead} aria-hidden="true">
          <span />
          <span className={f.spineL}>Worst drawdown</span>
          <span className={f.spineR}>P&amp;L</span>
          <span>Win rate</span>
        </div>
        <ol>
          {runs.map((r, k) => (
            <li
              key={r.id}
              style={{ "--k": k, "--dd": -r.sum.maxDD / maxDD, "--pl": Math.abs(r.sum.net) / maxNet } as CSSProperties}
              data-pick={r.id === method ? "" : undefined}
              data-hot={hot === r.id ? "" : undefined}
              onPointerEnter={() => setHot(r.id)}
              onPointerLeave={() => setHot(null)}
            >
              <button type="button" onClick={() => setOwner({ method: r.id })} aria-pressed={r.id === method} aria-label={`Show ${r.label} on the dashboard`}>
                <span className={f.wayName}>
                  <b>
                    {r.label}
                    {r.id === best.id && <span className={f.best}>Best</span>}
                  </b>
                  <em>{r.blurb}</em>
                </span>
                <span className={f.ddSide}>
                  <em>−{plain(r.sum.maxDD)}</em>
                  <i />
                </span>
                <span className={f.plSide}>
                  <i data-neg={r.sum.net < 0 ? "" : undefined} />
                  <em>{signed(r.sum.net)}</em>
                </span>
                <span className={f.wayMeta}>
                  <b>{pct(r.sum.winRate)}</b>
                  <em>{r.sum.breached ? `Breached` : `$${score(r).toFixed(2)} per $1 down`}</em>
                </span>
              </button>
            </li>
          ))}
        </ol>
        <p className={f.fine}>The marked way is what your Dashboard shows; click another to switch. Best is the most P&amp;L for each dollar of drawdown.</p>
      </div>
      <Curves runs={runs} hot={hot ?? method} result={result} />
    </div>
  );
}

function Curves({ runs, hot, result }: { runs: Run[]; hot: Method; result: Result }) {
  const W = 620;
  const H = 300;
  const ref = useRef<SVGSVGElement>(null);
  const [at, setAt] = useState<number | null>(null);
  const ghost = useMemo(() => summarize(result).ghost, [result]);
  const vals = runs.filter((r) => r.id !== "full").flatMap((r) => r.sum.curve.map((c) => c.eq));
  const lo = Math.min(0, ...vals);
  const hi = Math.max(1, ...vals);
  const n = runs[0].sum.curve.length;
  const X = (i: number) => (i / (n - 1)) * (W - 6);
  const Y = (v: number) => 10 + (1 - (Math.max(lo, Math.min(hi * 1.04, v)) - lo) / (hi * 1.04 - lo)) * (H - 26);
  const path = (v: number[]) => {
    const step = Math.max(1, Math.floor(v.length / 300));
    let d = "";
    for (let i = 0; i < v.length; i += step) d += `${d ? "L" : "M"}${X(i).toFixed(1)} ${Y(v[i]).toFixed(1)}`;
    return `${d}L${X(v.length - 1).toFixed(1)} ${Y(v[v.length - 1]).toFixed(1)}`;
  };
  const sel = runs.find((r) => r.id === hot)!;
  const move = (e: RPE<SVGSVGElement>) => {
    const r = ref.current!.getBoundingClientRect();
    setAt(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width) * (n - 1)))));
  };
  const i = at ?? n - 1;
  return (
    <div className={f.curves}>
      <div className={f.curveHead}>
        <span className={f.k}>{at === null ? "Over his whole record" : `After his trade ${at}`}</span>
        <span className={f.curveRead}>
          <b>{sel.label}</b>
          <span className={sel.sum.curve[i].eq >= 0 ? f.pos : f.neg}>{signed(sel.sum.curve[i].eq)}</span>
        </span>
      </div>
      <div className={f.curveBox}>
        <svg ref={ref} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onPointerMove={move} onPointerLeave={() => setAt(null)} role="img" aria-label="Each way of joining, over his record">
          <line x1="0" x2={W} y1={Y(0)} y2={Y(0)} className={f.zero} />
          {runs.map((r) => (
            <path key={r.id} d={path(r.sum.curve.map((c) => c.eq))} className={f.curve} data-on={r.id === hot ? "" : undefined} data-full={r.id === "full" ? "" : undefined} />
          ))}
          {at !== null && <line x1={X(at)} x2={X(at)} y1="0" y2={H - 10} className={f.scrub} />}
        </svg>
        <i className={f.curveDot} style={{ left: `${(X(i) / W) * 100}%`, top: `${(Y(sel.sum.curve[i].eq) / H) * 100}%` }} />
      </div>
      <p className={f.fine}>
        Yazan made {signed(ghost[ghost.length - 1])} at his full size over the same trades. The 1:1 copy runs off the top: it makes the most and breaches the account.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* recent calls                                                         */
/* ------------------------------------------------------------------ */

function Calls({ rows }: { rows: Row[] }) {
  const list = rows.slice(-8).reverse();
  return (
    <ol className={f.calls}>
      {list.map((r, k) => {
        const filled = r.legs.some((l) => l.filled.length);
        const m = r.decision.mode;
        return (
          <li key={r.t.id} style={{ "--k": k } as CSSProperties}>
            <time>
              {dayLabel(r.t.day)} <span>{hhmm(r.t.minute)}</span>
            </time>
            <span className={f.callHis}>
              <span className={`${f.side} ${r.t.side === "LONG" ? f.sideL : f.sideS}`}>{r.t.side === "LONG" ? "Long" : "Short"}</span>
              <span>{r.t.mkt}</span>
              <b className={r.t.pnl >= 0 ? f.pos : f.neg}>{signed(r.t.pnl)}</b>
            </span>
            <span className={f.callMode} data-m={m} data-unfilled={m !== "skip" && !filled ? "" : undefined}>
              {m === "skip" ? "Skipped" : MODE_LABEL[m]}
              {m !== "skip" && !filled && <em> · not filled</em>}
            </span>
            <p>{r.decision.reason}</p>
            <b className={!filled ? f.dimNum : r.pnl >= 0 ? f.pos : f.neg}>{filled ? signed(r.pnl) : "–"}</b>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* the page                                                             */
/* ------------------------------------------------------------------ */

export function Follow() {
  const { result } = useOwnerReplay();
  const sum = useMemo(() => summarize(result), [result]);
  return (
    <div className={f.page}>
      <div className={s.sheet}>
        <i className={s.sheetR} aria-hidden="true" />
        <i className={s.sheetB} aria-hidden="true" />
        <Stage />
        <div className={f.acctRow}>
          <Cell i={4} label={ACCOUNTS.length === 1 ? "The account" : "The accounts"} aside="Sample until it's connected">
            <Account result={result} />
          </Cell>
          <Cell i={5} label="Limits" aside="Enforced in code">
            <Limits />
          </Cell>
        </div>
        <div className={s.row1}>
          <Cell i={6} label="Six ways in" aside={`His ${result.rows.length} trades, through our account`}>
            <Ways result={result} />
          </Cell>
        </div>
        <div className={s.row1}>
          <Cell i={7} label="Recent calls" aside={`${sum.taken} taken · ${sum.skipped} skipped · ${sum.unfilled} not filled`}>
            <Calls rows={result.rows} />
          </Cell>
        </div>
      </div>
      <p className={f.sample}>Sample data. Yazan&apos;s record is the seeded one and our account is simulated until both are connected.</p>
    </div>
  );
}
