"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Cell } from "@/components/trader/parts";
import { dayStart, getMarket, useDesk } from "@/lib/desk/store";
import { INSTRUMENTS, type Under } from "@/lib/desk/instruments";
import { fmt } from "@/lib/format";
import { BAYER4 } from "@/lib/noise";
import { onThemeChange } from "@/lib/theme";
import { movesOf, sessionOf, type Move, type Session } from "@/lib/community/moves";
import { clock, dayKey } from "@/lib/community/trades";
import { addAccount, ago, nameAccount, removeAccount, resetAccounts, startWatch, useFeed, useNow, useWatch, DEFAULT_ACCOUNTS, type CalEvent, type Calendar, type FeedState, type Voices, type Wire, type XPost } from "@/lib/community/watch";
import c from "./community.module.css";

const mono = (name: string) =>
  name
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "·";

/* ------------------------------------------------------------------ */
/* voices: posts from X                                                */
/* ------------------------------------------------------------------ */

function Post({ p, now }: { p: XPost; now: number }) {
  return (
    <li className={c.post} data-fresh={now - p.at < 15 * 60_000 ? "" : undefined}>
      <header>
        <span className={c.mono2} aria-hidden="true">
          {mono(p.name)}
        </span>
        <b>{p.name}</b>
        <span className={c.handle}>@{p.handle}</span>
        <time dateTime={new Date(p.at).toISOString()} title={new Date(p.at).toLocaleString()}>
          {ago(p.at, now)}
        </time>
        <a href={p.url} target="_blank" rel="noreferrer noopener" aria-label={`Open this post by ${p.name} on X`}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4.5 2.5h5v5M9.5 2.5l-7 7" />
          </svg>
        </a>
      </header>
      {p.repost && (
        <span className={c.repost}>
          Reposted {p.repost.name} @{p.repost.handle}
        </span>
      )}
      <p>
        {p.parts.map((x, i) =>
          x.href ? (
            <a key={i} href={x.href} target="_blank" rel="noreferrer noopener nofollow">
              {x.t}
            </a>
          ) : (
            <span key={i}>{x.t}</span>
          ),
        )}
        {p.media > 0 && (
          <a className={c.media} href={p.url} target="_blank" rel="noreferrer noopener">
            {p.media === 1 ? "1 attachment" : `${p.media} attachments`}
          </a>
        )}
      </p>
    </li>
  );
}

function VoicesPanel({ feed, now }: { feed: FeedState<Voices>; now: number }) {
  const accounts = useWatch((s) => s.accounts);
  const replies = useWatch((s) => s.replies);
  const [only, setOnly] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const data = feed.data;

  useEffect(() => {
    for (const a of data?.accounts ?? []) if (a.ok && a.name) nameAccount(a.handle, a.name);
  }, [data]);
  useEffect(() => {
    if (only && !accounts.some((a) => a.handle === only)) setOnly(null);
  }, [accounts, only]);

  const info = useMemo(() => new Map((data?.accounts ?? []).map((a) => [a.handle.toLowerCase(), a])), [data]);
  const posts = useMemo(() => {
    const follow = new Set(accounts.map((a) => a.handle.toLowerCase()));
    return (data?.posts ?? []).filter((p) => follow.has(p.handle.toLowerCase()) && (!only || p.handle.toLowerCase() === only.toLowerCase()) && (replies || !p.reply));
  }, [data, accounts, only, replies]);
  const isDefault = accounts.length === DEFAULT_ACCOUNTS.length && accounts.every((a, i) => a.handle === DEFAULT_ACCOUNTS[i].handle);

  return (
    <div className={c.voices}>
      <div className={c.accounts}>
        <ul>
          {accounts.map((a) => {
            const st = info.get(a.handle.toLowerCase());
            return (
              <li key={a.handle} data-on={only === a.handle ? "" : undefined} data-quiet={st && !st.ok ? "" : undefined}>
                <button type="button" className={c.acct} aria-pressed={only === a.handle} onClick={() => setOnly(only === a.handle ? null : a.handle)} title={st && !st.ok ? `X returned nothing for @${a.handle} (${st.why ?? "no posts"})` : `Show only @${a.handle}`}>
                  <span className={c.mono2} aria-hidden="true">
                    {mono(a.name)}
                  </span>
                  <span className={c.acctName}>
                    <b>{a.name}</b>
                    <em>@{a.handle}</em>
                  </span>
                </button>
                <a className={c.acctOut} href={`https://x.com/${a.handle}`} target="_blank" rel="noreferrer noopener" aria-label={`Open @${a.handle} on X`}>
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4.5 2.5h5v5M9.5 2.5l-7 7" />
                  </svg>
                </a>
                <button type="button" className={c.acctX} onClick={() => removeAccount(a.handle)} aria-label={`Stop following @${a.handle}`}>
                  ×
                </button>
              </li>
            );
          })}
        </ul>
        <form
          className={c.addAcct}
          onSubmit={(e) => {
            e.preventDefault();
            const why = addAccount(draft);
            setErr(why);
            if (!why) setDraft("");
          }}
        >
          <input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setErr(null);
            }}
            placeholder="Add @handle"
            aria-label="Add an X account to follow"
            spellCheck={false}
            autoCapitalize="none"
          />
          <button type="submit" disabled={!draft.trim()}>
            Add
          </button>
        </form>
        <div className={c.acctFoot}>
          {err ? <span className={c.neg}>{err}</span> : <span>{accounts.length} followed</span>}
          {!isDefault && (
            <button type="button" onClick={resetAccounts}>
              Reset
            </button>
          )}
        </div>
      </div>

      <div className={c.posts}>
        <div className={c.postsBar}>
          <span>{only ? `@${only}` : "Everyone"}</span>
          <button type="button" role="switch" aria-checked={replies} onClick={() => useWatch.setState({ replies: !replies })}>
            Replies {replies ? "shown" : "hidden"}
          </button>
        </div>
        {posts.length ? (
          <ol className={c.scroll}>
            {posts.map((p) => (
              <Post key={p.id} p={p} now={now} />
            ))}
          </ol>
        ) : (
          <div className={c.empty}>
            {feed.state === "loading" ? (
              <>
                <i className={c.skel} />
                <i className={c.skel} />
                <i className={c.skel} />
              </>
            ) : (
              <>
                <p>Nothing from X at the moment.</p>
                <span>The Watcher reads the public feed behind X&apos;s own embeds and checks again every 90 seconds. Each account opens on X from the list.</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* the wire: headlines                                                 */
/* ------------------------------------------------------------------ */

function WirePanel({ feed, now }: { feed: FeedState<Wire>; now: number }) {
  const items = feed.data?.items ?? [];
  const today = dayKey(now);
  if (!items.length)
    return (
      <div className={c.empty}>
        {feed.state === "loading" ? (
          <>
            <i className={c.skel} />
            <i className={c.skel} />
            <i className={c.skel} />
          </>
        ) : (
          <>
            <p>The wire is quiet.</p>
            <span>Headlines come straight from publishers&apos; own feeds and refresh every minute.</span>
          </>
        )}
      </div>
    );
  return (
    <ol className={`${c.scroll} ${c.wire}`}>
      {items.map((x) => (
        <li key={x.id} data-fresh={now - x.at < 12 * 60_000 ? "" : undefined}>
          <span className={c.wMeta}>
            <time dateTime={new Date(x.at).toISOString()}>{dayKey(x.at) === today ? clock(x.at) : ago(x.at, now)}</time>
            <em>{x.source}</em>
          </span>
          <a href={x.url} target="_blank" rel="noreferrer noopener">
            {x.title}
          </a>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* the calendar: this week's releases                                  */
/* ------------------------------------------------------------------ */

const DAY_LONG = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long", month: "short", day: "numeric" });

function until(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 1) return "now";
  if (m < 60) return `in ${m}m`;
  if (m < 1440) return `in ${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
  return `in ${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
}

function Pips({ n }: { n: number }) {
  return (
    <span className={c.pips} data-n={n} aria-label={n === 3 ? "High impact" : n === 2 ? "Medium impact" : n === 1 ? "Low impact" : "Holiday"}>
      <i />
      <i />
      <i />
    </span>
  );
}

function CalendarPanel({ feed, now }: { feed: FeedState<Calendar>; now: number }) {
  const usdOnly = useWatch((s) => s.usdOnly);
  const all = feed.data?.events ?? [];
  const today = dayKey(now);
  const events = useMemo(() => all.filter((e) => (!usdOnly || e.ccy === "USD") && dayKey(e.at) >= today), [all, usdOnly, today]);
  const next = events.find((e) => e.at > now && e.impact >= 2) ?? events.find((e) => e.at > now);
  const groups = useMemo(() => {
    const out: { key: string; label: string; rows: CalEvent[] }[] = [];
    for (const e of events) {
      const k = dayKey(e.at);
      let g = out[out.length - 1];
      if (!g || g.key !== k) out.push((g = { key: k, label: k === today ? "Today" : DAY_LONG.format(e.at), rows: [] }));
      g.rows.push(e);
    }
    return out;
  }, [events, today]);

  if (!all.length)
    return (
      <div className={c.empty}>
        {feed.state === "loading" ? (
          <>
            <i className={c.skel} />
            <i className={c.skel} />
            <i className={c.skel} />
          </>
        ) : (
          <>
            <p>No calendar right now.</p>
            <span>This week&apos;s releases load from the public economic calendar and refresh through the day.</span>
          </>
        )}
      </div>
    );
  return (
    <div className={c.cal}>
      {next && (
        <div className={c.next}>
          <span className={c.nextWhen}>
            Next <b>{until(next.at - now)}</b>
          </span>
          <strong>{next.title}</strong>
          <span className={c.nextMeta}>
            <Pips n={next.impact} />
            {next.ccy} · {dayKey(next.at) === today ? "today" : DAY_LONG.format(next.at)} {clock(next.at)} ET
            {next.forecast && ` · forecast ${next.forecast}`}
            {next.previous && ` · previous ${next.previous}`}
          </span>
        </div>
      )}
      <div className={`${c.scroll} ${c.calList}`}>
        {groups.map((g) => (
          <section key={g.key}>
            <h4>{g.label}</h4>
            <ul>
              {g.rows.map((e) => (
                <li key={e.id} data-past={e.at < now ? "" : undefined} data-next={e === next ? "" : undefined}>
                  <time>{clock(e.at)}</time>
                  <Pips n={e.impact} />
                  <span className={c.calTitle}>
                    {!usdOnly && <em>{e.ccy}</em>}
                    {e.title}
                  </span>
                  <span className={c.calNums}>
                    {e.forecast && (
                      <span>
                        <i>F</i>
                        {e.forecast}
                      </span>
                    )}
                    {e.previous && (
                      <span>
                        <i>P</i>
                        {e.previous}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {!events.length && <p className={c.none}>Nothing left on the calendar this week{usdOnly ? " for the dollar" : ""}.</p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* moves: the futures the desk follows                                 */
/* ------------------------------------------------------------------ */

/** The session as a thin line over a dithered glow, as on the landing band. Marks sit where the pushes ended. */
function SessionLine({ s, up, marks, hot }: { s: Session; up: boolean; marks: Move[]; hot: string | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [theme, setTheme] = useState(0);
  useEffect(() => onThemeChange(() => setTheme((n) => n + 1)), []);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const draw = () => {
      const W = cv.clientWidth;
      const H = cv.clientHeight;
      if (!W || !H) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      const g = cv.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const cs = getComputedStyle(cv);
      const v = (n: string) => cs.getPropertyValue(n).trim();
      const pad = 12; // the live point never touches the edge
      const n = s.line.length;
      const lo = s.lo;
      const hi = s.hi === s.lo ? s.lo + 1 : s.hi;
      const X = (i: number) => (i / Math.max(1, n - 1)) * (W - pad - 2) + 1;
      const Y = (p: number) => 8 + (1 - (p - lo) / (hi - lo)) * (H - 20);
      // glow
      const cell = 3;
      const a = new Path2D();
      const b = new Path2D();
      for (let x = 0; x < W - pad; x += cell) {
        const i = Math.min(n - 1, Math.round(((x - 1) / (W - pad - 2)) * (n - 1)));
        if (i < 0) continue;
        const y0 = Y(s.line[i]);
        const reach = Math.max(1, H - y0);
        for (let y = Math.ceil(y0 / cell) * cell; y < H; y += cell) {
          const k = 1 - (y - y0) / reach;
          const I = 0.03 + 0.5 * k * k * k;
          if (I > (BAYER4[((y / cell) & 3) * 4 + ((x / cell) & 3)] + 0.5) / 16) (I > 0.3 ? b : a).rect(x, y, 2, 2);
        }
      }
      g.fillStyle = v(up ? "--cv-dither-1" : "--cv-ember-1");
      g.fill(a);
      g.fillStyle = v(up ? "--cv-dither-2" : "--cv-ember-2");
      g.fill(b);
      // line
      g.beginPath();
      s.line.forEach((p, i) => (i ? g.lineTo(X(i), Y(p)) : g.moveTo(X(i), Y(p))));
      g.strokeStyle = v("--text-strong");
      g.lineWidth = 1.25;
      g.lineJoin = "round";
      g.stroke();
      // pushes
      for (const m of marks) {
        if (m.kind !== "push") continue;
        const f = (m.at - s.t0) / Math.max(1, s.t1 - s.t0);
        if (f < 0 || f > 1) continue;
        const i = Math.round(f * (n - 1));
        const x = X(i);
        const y = Y(s.line[i]);
        const on = hot === m.id;
        g.fillStyle = v("--page");
        g.strokeStyle = v(m.delta > 0 ? "--blue" : "--ember");
        g.lineWidth = on ? 2 : 1.25;
        g.beginPath();
        g.arc(x, y, on ? 4.5 : 3, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
      // the live end, a small square as on the sheet's sparklines
      const ex = X(n - 1);
      const ey = Y(s.line[n - 1]);
      g.fillStyle = v("--text-strong");
      g.fillRect(Math.round(ex) - 2.5, Math.round(ey) - 2.5, 5, 5);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(cv);
    return () => ro.disconnect();
  }, [s, up, marks, hot, theme]);
  return <canvas ref={ref} className={c.sLine} role="img" aria-label={`${s.under} session, low ${fmt(s.lo)} to high ${fmt(s.hi)}`} />;
}

function Market({ under, s, marks, hot }: { under: Under; s: Session | null; marks: Move[]; hot: string | null }) {
  const q = useDesk((st) => st.quotes[under]);
  const inst = INSTRUMENTS[under];
  const chg = q.last - q.prev;
  const pct = q.prev ? (chg / q.prev) * 100 : 0;
  const up = chg >= 0;
  const hi = s ? Math.max(s.hi, q.last) : q.hi;
  const lo = s ? Math.min(s.lo, q.last) : q.lo;
  const at = hi > lo ? (q.last - lo) / (hi - lo) : 0.5;
  return (
    <div className={c.mkt}>
      <div className={c.mktHead}>
        <b>{under}</b>
        <span>{inst.name}</span>
      </div>
      <div className={c.mktNum}>
        <span className={c.mktPx}>{q.last ? fmt(q.last) : "0.00"}</span>
        <span className={up ? c.pos : c.neg}>
          {up ? "+" : "−"}
          {fmt(Math.abs(chg))}
          <em>
            {up ? "+" : "−"}
            {Math.abs(pct).toFixed(2)}%
          </em>
        </span>
      </div>
      {s ? <SessionLine s={s} up={up} marks={marks} hot={hot} /> : <div className={c.sLine} />}
      <div className={c.range} style={{ "--at": at } as CSSProperties}>
        <span>{fmt(lo)}</span>
        <span className={c.rangeBar} aria-hidden="true">
          <i />
        </span>
        <span>{fmt(hi)}</span>
      </div>
    </div>
  );
}

function MovesPanel({ now }: { now: number }) {
  const ready = useDesk((st) => st.ready);
  const [state, setState] = useState<{ sessions: Partial<Record<Under, Session>>; moves: Move[] }>({ sessions: {}, moves: [] });
  const [hot, setHot] = useState<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    const run = () => {
      const m = getMarket();
      if (!m) return;
      const since = dayStart();
      const sessions: Partial<Record<Under, Session>> = {};
      const moves: Move[] = [];
      for (const u of ["NQ", "ES"] as Under[]) {
        const s = sessionOf(m, u, since);
        if (!s) continue;
        sessions[u] = s;
        moves.push(...movesOf(s));
      }
      setState({ sessions, moves: moves.sort((a, b) => b.at - a.at) });
    };
    run();
    const id = window.setInterval(run, 4000);
    return () => window.clearInterval(id);
  }, [ready]);
  const today = dayKey(now);
  return (
    <div className={c.moves}>
      {(["NQ", "ES"] as Under[]).map((u) => (
        <Market key={u} under={u} s={state.sessions[u] ?? null} marks={state.moves.filter((x) => x.under === u)} hot={hot} />
      ))}
      <ol className={`${c.scroll} ${c.moveLog}`} onMouseLeave={() => setHot(null)}>
        {state.moves.map((m) => (
          <li key={m.id} data-kind={m.kind} onMouseEnter={() => setHot(m.id)}>
            <time>{dayKey(m.at) === today ? clock(m.at) : ago(m.at, now)}</time>
            <b>{m.under}</b>
            <span>{m.text}</span>
            <em className={m.delta >= 0 ? c.pos : c.neg}>
              {m.delta >= 0 ? "+" : "−"}
              {Math.abs(m.pct).toFixed(2)}%
            </em>
          </li>
        ))}
        {!state.moves.length && <li className={c.none}>The session is just getting going.</li>}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* the watcher                                                         */
/* ------------------------------------------------------------------ */

function Light({ name, state, at, now }: { name: string; state: "ok" | "quiet" | "loading"; at: number; now: number }) {
  return (
    <span className={c.light} data-state={state}>
      <i />
      {name}
      {state === "ok" && at > 0 && <em>{ago(at, now)}</em>}
    </span>
  );
}

export function Watcher() {
  useEffect(() => startWatch(), []);
  const accounts = useWatch((s) => s.accounts);
  const handles = accounts.map((a) => a.handle).join(",");
  const voices = useFeed<Voices>(handles ? `/api/watch/voices?h=${handles}` : null, 90_000);
  const wire = useFeed<Wire>("/api/watch/wire", 60_000);
  const cal = useFeed<Calendar>("/api/watch/calendar", 15 * 60_000);
  const now = useNow(15_000);
  const lit = <T,>(f: FeedState<T>, has: boolean) => (f.state === "loading" ? "loading" : has ? "ok" : "quiet");

  return (
    <>
      <Cell i={4} className={c.aBand} bodyClass={c.band}>
        <div>
          <h2>Altron Watcher</h2>
          <p>What can move the tape: who is posting, what just crossed the wire, what is due, and what price has already done.</p>
        </div>
        <div className={c.lights}>
          <Light name="Voices" state={lit(voices, !!voices.data?.posts.length)} at={voices.at} now={now} />
          <Light name="Wire" state={lit(wire, !!wire.data?.items.length)} at={wire.at} now={now} />
          <Light name="Calendar" state={lit(cal, !!cal.data?.events.length)} at={cal.at} now={now} />
          <Light name="Moves" state="ok" at={0} now={now} />
        </div>
      </Cell>
      <section className={c.watch} aria-label="Altron Watcher">
        <Cell i={5} className={c.aVoices} label="Voices" aside="Posts on X" bodyClass={c.bodyTall}>
          <VoicesPanel feed={voices} now={now} />
        </Cell>
        <Cell i={6} className={c.aWire} label="Wire" aside="Breaking" bodyClass={c.bodyTall}>
          <WirePanel feed={wire} now={now} />
        </Cell>
        <Cell i={7} className={c.aCal} label="Calendar" aside={<CalToggle />} bodyClass={c.bodyTall}>
          <CalendarPanel feed={cal} now={now} />
        </Cell>
      </section>
      <Cell i={8} className={c.aMoves} label="Moves" aside="NQ and ES futures · this session" bodyClass={c.body}>
        <MovesPanel now={now} />
      </Cell>
    </>
  );
}

function CalToggle() {
  const usdOnly = useWatch((s) => s.usdOnly);
  return (
    <span className={c.calToggle} role="group" aria-label="Currencies">
      <button type="button" aria-pressed={usdOnly} onClick={() => useWatch.setState({ usdOnly: true })}>
        USD
      </button>
      <button type="button" aria-pressed={!usdOnly} onClick={() => useWatch.setState({ usdOnly: false })}>
        All
      </button>
    </span>
  );
}
