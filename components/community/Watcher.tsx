"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { dayStart, getMarket, useDesk } from "@/lib/desk/store";
import { INSTRUMENTS, type Under } from "@/lib/desk/instruments";
import { fmt } from "@/lib/format";
import { BAYER4 } from "@/lib/noise";
import { onThemeChange } from "@/lib/theme";
import { movesOf, sessionOf, type Move, type Session } from "@/lib/community/moves";
import { clock, dayKey } from "@/lib/community/trades";
import { ago, startWatch, useWatch, POSTS, type CalEvent, type Calendar, type FeedState, type Post, type Wire, type WireItem } from "@/lib/community/watch";
import c from "./community.module.css";

/*
 * The page's market panels: Watcher (posts on X), News, Calendar and Moves.
 */

const mono = (name: string) =>
  name
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "·";

/** A stable tint per name, so each account and source keeps its own colour. */
function hue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

/* ------------------------------------------------------------------ */
/* watcher: posts on X                                                 */
/* ------------------------------------------------------------------ */

/*
 * X has no free feed to read on a server: its robots rules close the embed endpoint to
 * automated readers. So the Watcher shows posts through X's own embed, loaded by the
 * visitor's browser, which brings the text, photos and video exactly as X shows them.
 */
type Twttr = {
  ready?: (cb: (t: Twttr) => void) => void;
  widgets?: {
    createTweet: (id: string, el: HTMLElement, opts: Record<string, unknown>) => Promise<HTMLElement | undefined>;
  };
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

function useTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">(() => (typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light"));
  useEffect(() => {
    const read = () => setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    read();
    return onThemeChange(read);
  }, []);
  return theme;
}

function XPost({ post, theme }: { post: Post; theme: "light" | "dark" }) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ok" | "quiet">("loading");
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let dead = false;
    const set = (v: "loading" | "ok" | "quiet") => !dead && setState(v);
    set("loading");
    // a fresh host each time, so an embed still on its way from an earlier theme lands nowhere
    const host = document.createElement("div");
    el.replaceChildren(host);
    const timer = window.setTimeout(() => set("quiet"), 12_000);
    loadWidgets()
      .then((tw) =>
        tw.widgets!.createTweet(post.id, host, {
          theme,
          dnt: true,
          conversation: "none",
          align: "center",
        }),
      )
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
      host.remove();
    };
  }, [post.id, theme]);
  const url = `https://x.com/${post.handle}/status/${post.id}`;
  return (
    <li className={c.xpost} data-state={state}>
      <div ref={box} className={c.xframe} />
      {state === "loading" && (
        <div className={c.xskel} aria-hidden="true">
          <span className={c.mono2}>{mono(post.handle)}</span>
          <i className={c.skel} />
          <i className={c.skel} />
          <i className={c.skel} />
        </div>
      )}
      {state === "quiet" && (
        <a className={c.xmiss} href={url} target="_blank" rel="noreferrer noopener">
          <span className={c.mono2} style={{ "--h": hue(post.handle) } as CSSProperties}>
            {mono(post.handle)}
          </span>
          <span>
            <b>@{post.handle}</b>
            <em>X didn&apos;t load this post here. Open it on X</em>
          </span>
        </a>
      )}
    </li>
  );
}

export function XWatcher() {
  const theme = useTheme();
  return (
    <ol className={c.watcher} aria-label="Posts on X">
      {POSTS.map((p) => (
        <XPost key={p.id} post={p} theme={theme} />
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* news                                                                */
/* ------------------------------------------------------------------ */

function Thumb({ item }: { item: WireItem }) {
  const [bad, setBad] = useState(false);
  if (item.image && !bad)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img className={c.thumb} src={item.image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBad(true)} />
    );
  return (
    <span className={`${c.thumb} ${c.thumbMono}`} style={{ "--h": hue(item.source) } as CSSProperties} aria-hidden="true">
      {mono(item.source)}
    </span>
  );
}

export function News({ feed, now }: { feed: FeedState<Wire>; now: number }) {
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
            <p>No headlines right now.</p>
            <span>Headlines come straight from publishers&apos; own feeds and refresh every minute.</span>
          </>
        )}
      </div>
    );
  return (
    <ol className={`${c.scroll} ${c.news}`}>
      {items.map((x) => (
        <li key={x.id} data-fresh={now - x.at < 12 * 60_000 ? "" : undefined}>
          <a href={x.url} target="_blank" rel="noreferrer noopener">
            <span className={c.newsText}>
              <span className={c.wMeta}>
                <time dateTime={new Date(x.at).toISOString()}>{dayKey(x.at) === today ? clock(x.at) : ago(x.at, now)}</time>
                <em>{x.source}</em>
              </span>
              <b>{x.title}</b>
            </span>
            <Thumb item={x} />
          </a>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* calendar: a list and a week, taking turns                           */
/* ------------------------------------------------------------------ */

const SRC = {
  BLS: "Bureau of Labor Statistics",
  BEA: "Bureau of Economic Analysis",
  Fed: "Federal Reserve",
} as const;
const DAY_LONG = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "long",
  month: "short",
  day: "numeric",
});
const WD = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
});
const DN = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  day: "numeric",
});
const CYCLE_MS = 7000;

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

/** The next five weekdays, from today (or Monday, at a weekend). */
function weekdays(now: number): { key: string; at: number }[] {
  const out: { key: string; at: number }[] = [];
  for (let d = 0; out.length < 5 && d < 10; d++) {
    const at = now + d * 86_400_000;
    const w = WD.format(at);
    if (w === "Sat" || w === "Sun") continue;
    out.push({ key: dayKey(at), at });
  }
  return out;
}

/** Which calendar view shows, taking turns every seven seconds unless a hand is on the panel. */
export function useCalView(on: boolean) {
  const [view, setView] = useState<"list" | "week">("list");
  const [held, setHeld] = useState(false);
  const [lap, setLap] = useState(0);
  const reduce = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  useEffect(() => {
    if (held || reduce || !on) return;
    const id = window.setTimeout(() => {
      setView((v) => (v === "list" ? "week" : "list"));
      setLap((n) => n + 1);
    }, CYCLE_MS);
    return () => window.clearTimeout(id);
  }, [view, held, reduce, on, lap]);
  const choose = useCallback((v: "list" | "week") => {
    setView(v);
    setLap((n) => n + 1);
  }, []);
  return { view, held, setHeld, lap, reduce, choose, on };
}
export type CalView = ReturnType<typeof useCalView>;

/** The calendar's controls, in its header: the two views, then key releases or all of them. */
export function CalControls({ v }: { v: CalView }) {
  useEffect(() => startWatch(), []);
  const keyOnly = useWatch((s) => s.keyOnly);
  return (
    <span className={c.calCtl}>
      <span className={c.views} role="tablist" aria-label="Calendar view">
        {(["list", "week"] as const).map((x) => (
          <button key={x} type="button" role="tab" aria-selected={v.view === x} onClick={() => v.choose(x)}>
            {x === "list" ? "List" : "Week"}
            {v.view === x && v.on && !v.held && !v.reduce && <i key={v.lap} className={c.lapBar} style={{ animationDuration: `${CYCLE_MS}ms` }} aria-hidden="true" />}
          </button>
        ))}
      </span>
      <i className={c.calSep} aria-hidden="true" />
      <span className={c.calToggle} role="group" aria-label="Which releases">
        <button type="button" aria-pressed={keyOnly} onClick={() => useWatch.setState({ keyOnly: true })}>
          Key
        </button>
        <button type="button" aria-pressed={!keyOnly} onClick={() => useWatch.setState({ keyOnly: false })}>
          All
        </button>
      </span>
    </span>
  );
}

export function CalendarCard({ feed, now, v }: { feed: FeedState<Calendar>; now: number; v: CalView }) {
  const keyOnly = useWatch((s) => s.keyOnly);
  const { view, setHeld } = v;
  const all = feed.data?.events ?? [];
  const today = dayKey(now);
  const events = useMemo(() => all.filter((e) => (!keyOnly || e.impact >= 2) && dayKey(e.at) >= today), [all, keyOnly, today]);
  const next = events.find((e) => e.at > now && e.impact >= 2 && !e.allDay) ?? events.find((e) => e.at > now);

  const groups = useMemo(() => {
    const out: { key: string; label: string; rows: CalEvent[] }[] = [];
    for (const e of events) {
      const k = dayKey(e.at);
      let g = out[out.length - 1];
      if (!g || g.key !== k)
        out.push(
          (g = {
            key: k,
            label: k === today ? "Today" : DAY_LONG.format(e.at),
            rows: [],
          }),
        );
      g.rows.push(e);
    }
    return out;
  }, [events, today]);
  const days = useMemo(() => weekdays(now), [now]);

  return (
    <div className={c.cal} onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)} onFocus={() => setHeld(true)} onBlur={() => setHeld(false)}>
      {!all.length ? (
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
      ) : (
        <>
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
          <div className={c.calStage}>
            <div className={`${c.scroll} ${c.calList}`} data-on={view === "list" ? "" : undefined} aria-hidden={view !== "list"} inert={view !== "list"}>
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
                        <span className={c.calSrc}>{e.src}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {!events.length && <p className={c.none}>{keyOnly ? "No key releases in the next ten days. Switch to All for the rest." : "Nothing scheduled in the next ten days."}</p>}
            </div>
            <div className={c.week} data-on={view === "week" ? "" : undefined} aria-hidden={view !== "week"} inert={view !== "week"}>
              {days.map((d) => {
                const rows = events.filter((e) => dayKey(e.at) === d.key);
                const shown = rows.slice(0, 5);
                return (
                  <div key={d.key} className={c.day} data-today={d.key === today ? "" : undefined}>
                    <header>
                      <span>{WD.format(d.at)}</span>
                      <b>{DN.format(d.at)}</b>
                    </header>
                    <ul>
                      {shown.map((e) => (
                        <li key={e.id} data-n={e.impact} data-past={e.at < now ? "" : undefined} title={`${e.title} · ${SRC[e.src]}`}>
                          <time>{e.allDay ? "Day" : clock(e.at).replace(/ (AM|PM)$/, (m) => m.trim().toLowerCase().slice(0, 1))}</time>
                          <span>{e.title}</span>
                        </li>
                      ))}
                    </ul>
                    {rows.length > shown.length && <em>+{rows.length - shown.length} more</em>}
                    {!rows.length && <em>Nothing</em>}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
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

export function Moves({ now }: { now: number }) {
  const ready = useDesk((st) => st.ready);
  const [state, setState] = useState<{
    sessions: Partial<Record<Under, Session>>;
    moves: Move[];
  }>({ sessions: {}, moves: [] });
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
