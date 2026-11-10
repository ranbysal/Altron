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
import { addAccount, ago, removeAccount, resetAccounts, startWatch, useFeed, useNow, useWatch, DEFAULT_ACCOUNTS, type CalEvent, type Calendar, type FeedState, type Wire } from "@/lib/community/watch";
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

/*
 * X has no free feed to read on a server: its robots rules close the embed endpoint to
 * automated readers, and it has pursued the services that read it anyway. So Voices uses
 * the one route X offers without the API, its own embedded timeline, loaded by the
 * visitor's browser straight from X. The list of accounts is ours; the posts are X's.
 */
type Twttr = {
  ready?: (cb: (t: Twttr) => void) => void;
  widgets?: { createTimeline: (src: { sourceType: "profile"; screenName: string }, el: HTMLElement, opts: Record<string, unknown>) => Promise<HTMLElement | undefined> };
};
let widgets: Promise<Twttr> | null = null;
function loadWidgets(): Promise<Twttr> {
  if (widgets) return widgets;
  widgets = new Promise<Twttr>((resolve, reject) => {
    const w = window as unknown as { twttr?: Twttr };
    if (w.twttr?.widgets) return resolve(w.twttr);
    const el = document.createElement("script");
    el.src = "https://platform.twitter.com/widgets.js";
    el.async = true;
    el.onload = () => {
      const t = (window as unknown as { twttr?: Twttr }).twttr;
      if (t?.ready) t.ready((x) => resolve(x));
      else if (t?.widgets) resolve(t);
      else reject(new Error("no widgets"));
    };
    el.onerror = () => {
      widgets = null;
      reject(new Error("blocked"));
    };
    document.head.appendChild(el);
  });
  return widgets;
}

type VoiceState = "loading" | "ok" | "quiet";

function XTimeline({ handle, onState }: { handle: string; onState: (s: VoiceState) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<VoiceState>("loading");
  const [theme, setTheme] = useState("light");
  useEffect(() => {
    const read = () => setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    read();
    return onThemeChange(read);
  }, []);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let dead = false;
    const set = (v: VoiceState) => {
      if (dead) return;
      setState(v);
      onState(v);
    };
    set("loading");
    el.replaceChildren();
    const timer = window.setTimeout(() => set("quiet"), 10_000);
    loadWidgets()
      .then((tw) => tw.widgets!.createTimeline({ sourceType: "profile", screenName: handle }, el, { theme, chrome: "noheader nofooter noborders transparent", dnt: true, height: Math.max(380, el.clientHeight - 8) }))
      .then((node) => {
        window.clearTimeout(timer);
        set(node ? "ok" : "quiet");
      })
      .catch(() => {
        window.clearTimeout(timer);
        set("quiet");
      });
    return () => {
      dead = true;
      window.clearTimeout(timer);
      el.replaceChildren();
    };
  }, [handle, theme, onState]);
  return (
    <div className={c.xwrap}>
      <div ref={box} className={c.xframe} data-state={state} />
      {state !== "ok" && (
        <div className={c.empty}>
          {state === "loading" ? (
            <>
              <i className={c.skel} />
              <i className={c.skel} />
              <i className={c.skel} />
            </>
          ) : (
            <>
              <p>X didn&apos;t load this timeline here.</p>
              <span>Posts come from X&apos;s own embed, in your browser. A content blocker or X itself can hold it back.</span>
              <a className={c.outLink} href={`https://x.com/${handle}`} target="_blank" rel="noreferrer noopener">
                Open @{handle} on X
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function VoicesPanel({ onState }: { onState: (s: VoiceState) => void }) {
  const accounts = useWatch((s) => s.accounts);
  const [pick, setPick] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const sel = accounts.find((a) => a.handle === pick) ?? accounts[0];
  const isDefault = accounts.length === DEFAULT_ACCOUNTS.length && accounts.every((a, i) => a.handle === DEFAULT_ACCOUNTS[i].handle);

  return (
    <div className={c.voices}>
      <div className={c.accounts}>
        <ul>
          {accounts.map((a) => (
            <li key={a.handle} data-on={sel?.handle === a.handle ? "" : undefined}>
              <button type="button" className={c.acct} aria-pressed={sel?.handle === a.handle} onClick={() => setPick(a.handle)} title={`Show @${a.handle}`}>
                <span className={c.mono2} aria-hidden="true">
                  {mono(a.name)}
                </span>
                <span className={c.acctName}>
                  <b>{a.name}</b>
                  <em>@{a.handle}</em>
                </span>
              </button>
              <button type="button" className={c.acctX} onClick={() => removeAccount(a.handle)} aria-label={`Stop following @${a.handle}`}>
                ×
              </button>
            </li>
          ))}
        </ul>
        <form
          className={c.addAcct}
          onSubmit={(e) => {
            e.preventDefault();
            const before = useWatch.getState().accounts.length;
            const why = addAccount(draft);
            setErr(why);
            if (!why) {
              setDraft("");
              const list = useWatch.getState().accounts;
              if (list.length > before) setPick(list[list.length - 1].handle);
            }
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
        {sel ? (
          <>
            <div className={c.postsBar}>
              <span>
                {sel.name !== sel.handle && `${sel.name} · `}@{sel.handle}
              </span>
              <a href={`https://x.com/${sel.handle}`} target="_blank" rel="noreferrer noopener">
                Open on X
              </a>
            </div>
            <XTimeline key={sel.handle} handle={sel.handle} onState={onState} />
          </>
        ) : (
          <div className={c.empty}>
            <p>No one on the list.</p>
            <span>Add an X handle on the left to follow it here.</span>
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

const SRC = { BLS: "Bureau of Labor Statistics", BEA: "Bureau of Economic Analysis", Fed: "Federal Reserve" } as const;
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
    <span className={c.pips} data-n={n} aria-label={n === 3 ? "High impact" : n === 2 ? "Medium impact" : "Low impact"}>
      <i />
      <i />
      <i />
    </span>
  );
}

function CalendarPanel({ feed, now }: { feed: FeedState<Calendar>; now: number }) {
  const keyOnly = useWatch((s) => s.keyOnly);
  const all = feed.data?.events ?? [];
  const today = dayKey(now);
  const events = useMemo(() => all.filter((e) => (!keyOnly || e.impact >= 2) && dayKey(e.at) >= today), [all, keyOnly, today]);
  const next = events.find((e) => e.at > now && e.impact >= 2 && !e.allDay) ?? events.find((e) => e.at > now);
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
            <span>Releases and Fed events load from the agencies&apos; own calendars and refresh through the day.</span>
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
            {SRC[next.src]} · {dayKey(next.at) === today ? "today" : DAY_LONG.format(next.at)}
            {!next.allDay && ` ${clock(next.at)} ET`}
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
                  <time>{e.allDay ? "Day" : clock(e.at)}</time>
                  <Pips n={e.impact} />
                  <span className={c.calTitle} title={e.title}>
                    {e.title}
                  </span>
                  <span className={c.calNums}>{e.src}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {!events.length && <p className={c.none}>{keyOnly ? "No key releases in the next ten days. Switch to All for the rest." : "Nothing scheduled in the next ten days."}</p>}
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
  const [voice, setVoice] = useState<VoiceState>("loading");
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
          <Light name="Voices" state={voice} at={0} now={now} />
          <Light name="Wire" state={lit(wire, !!wire.data?.items.length)} at={wire.at} now={now} />
          <Light name="Calendar" state={lit(cal, !!cal.data?.events.length)} at={cal.at} now={now} />
          <Light name="Moves" state="ok" at={0} now={now} />
        </div>
      </Cell>
      <section className={c.watch} aria-label="Altron Watcher">
        <Cell i={5} className={c.aVoices} label="Voices" aside="Posts on X" bodyClass={c.bodyTall}>
          <VoicesPanel onState={setVoice} />
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
  const keyOnly = useWatch((s) => s.keyOnly);
  return (
    <span className={c.calToggle} role="group" aria-label="Which releases">
      <button type="button" aria-pressed={keyOnly} onClick={() => useWatch.setState({ keyOnly: true })}>
        Key
      </button>
      <button type="button" aria-pressed={!keyOnly} onClick={() => useWatch.setState({ keyOnly: false })}>
        All
      </button>
    </span>
  );
}
