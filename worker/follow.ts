import type { Market } from "@/lib/desk/market";
import type { BookData, Op } from "@/lib/desk/broker";
import type { Sym } from "@/lib/desk/instruments";
import type { Quote } from "@/lib/desk/market";
import { DEFAULT_LIMITS, DEFAULT_RULES, account, initState, restart, sessionDay, tick, PHASE_LABEL, type Advice, type Alert, type Ask, type Limits, type Rules, type State } from "@/lib/follow/engine";
import { addSpend, coach, decide, discord, freshSpend, keys, pick, tiers, weeklyCap, weekOf, type Spend, type Tier } from "@/lib/follow/ai";
import { opsOf, worldFrom } from "@/lib/follow/world";
import { load, saver } from "./persist";

/*
 * The follow engine, running all the time on the server against the owner's paper book. It
 * reads Yazan's book and the tape once a second, places and manages our orders, asks the AI
 * when the engine wants judgement, sends Discord alerts, and writes the day's review.
 */

export type Sent = { at: number; kind: Alert["kind"] | "review"; title: string; lines: string[]; sent: boolean | null };
export type AiCall = {
  at: number;
  his?: string;
  kind: Ask["kind"] | "coach";
  tier: Tier;
  model: string;
  label: string;
  ok: boolean;
  /** whether the engine was given this answer (the second opinion never is) */
  acted: boolean;
  action?: string;
  price?: number;
  reason?: string;
  error?: string;
  usd: number;
  ms: number;
  inTok: number;
  outTok: number;
};
export type Review = {
  day: number;
  at: number;
  title: string;
  lines: string[];
  equity: number;
  /** the day's change in equity */
  pnl: number;
  trades: number;
  phase: string;
  coach?: { text: string; label: string; usd: number };
  coachError?: string;
};

export type FollowData = {
  v: 3;
  state: State | null;
  rules: Rules;
  limits: Limits;
  following: boolean;
  advice: Advice[];
  alerts: Sent[];
  calls: AiCall[];
  spend: Spend;
  reviews: Review[];
};

/** What the owner's pages are sent. */
export type FollowView = FollowData & {
  thinking: Record<string, boolean>;
  aiPausedUntil: number;
  wiring: { anthropic: boolean; google: boolean; discord: boolean; cap: number; tiers: Record<Tier, string> };
};

const HOOK = process.env.DISCORD_WEBHOOK_URL ?? "";
const CAL = process.env.CALENDAR_URL || `${(process.env.SITE_URL || "https://altron.capital").replace(/\/$/, "")}/api/watch/calendar`;

type Env = {
  his: () => BookData;
  mine: () => (BookData & { start: number }) | null;
  quotes: () => Record<Sym, Quote>;
  market: () => Market;
  /** apply operations to the owner's book */
  act: (ops: Op[]) => void;
  /** reset the owner's book to a fresh account */
  resetOwner: (start: number) => void;
  changed: () => void;
};

export class Follow {
  data: FollowData = { v: 3, state: null, rules: DEFAULT_RULES, limits: DEFAULT_LIMITS, following: true, advice: [], alerts: [], calls: [], spend: freshSpend(), reviews: [] };
  thinking: Record<string, boolean> = {};
  aiFails = 0;
  aiPausedUntil = 0;
  private cal: { title: string; at: number; impact: number }[] = [];
  private calAt = 0;
  private store = saver("follow", () => this.data, 2000);

  constructor(private env: Env) {}

  async boot() {
    const saved = await load<FollowData>("follow");
    if (saved?.v === 3) {
      this.data = {
        ...this.data,
        ...saved,
        rules: { ...DEFAULT_RULES, ...saved.rules },
        limits: { ...DEFAULT_LIMITS, ...saved.limits, risk: { ...DEFAULT_LIMITS.risk, ...saved.limits?.risk }, minStop: { ...DEFAULT_LIMITS.minStop, ...saved.limits?.minStop } },
      };
    }
    void this.refreshCalendar();
    setInterval(() => void this.refreshCalendar(), 15 * 60_000);
    setInterval(() => this.step(), 1000);
  }

  view(): FollowView {
    const t = tiers();
    const k = keys();
    return {
      ...this.data,
      calls: this.data.calls.slice(-80),
      alerts: this.data.alerts.slice(-60),
      thinking: this.thinking,
      aiPausedUntil: this.aiPausedUntil,
      wiring: { anthropic: !!k.anthropic, google: !!k.google, discord: !!HOOK, cap: weeklyCap(), tiers: { entry: t.entry.label, shadow: t.shadow.label, manage: t.manage.label, coach: t.coach.label } },
    };
  }

  private mark() {
    this.store.mark();
    this.env.changed();
  }
  flush() {
    return this.store.now();
  }

  /* ---------- the owner's controls ---------- */

  setRules(patch: Partial<Rules>) {
    this.data.rules = { ...this.data.rules, ...patch };
    this.mark();
  }
  setLimits(patch: Partial<Limits>) {
    this.data.limits = { ...this.data.limits, ...patch };
    this.mark();
  }
  setFollowing(on: boolean) {
    this.data.following = on;
    this.mark();
  }
  restart() {
    if (!this.data.state) return;
    this.data.state = restart(this.data.state, Date.now());
    this.mark();
  }
  startOver() {
    this.env.resetOwner(this.data.rules.size);
    this.data.state = initState(this.data.rules, this.data.rules.size, Date.now());
    this.data.advice = [];
    this.mark();
  }
  /** The day's review now, rather than at the close. Once a day. */
  reviewNow(): boolean {
    const mine = this.env.mine();
    if (!mine || !this.data.state) return false;
    const day = sessionDay(Date.now() - 60_000);
    if (this.data.reviews.some((r) => r.day === day && (r.coach || !r.coachError))) return false;
    const w = worldFrom({ now: Date.now(), his: this.env.his(), mine, start: mine.start, quotes: this.env.quotes(), market: this.env.market(), following: this.data.following, news: null, advice: [], ai: false });
    const equity = w.mine.balance + w.mine.open;
    const d = equity - this.data.state.dayStart;
    void this.review({ kind: "summary", title: `The day so far: ${d >= 0 ? "+" : "−"}$${Math.round(Math.abs(d)).toLocaleString("en-US")}`, lines: ["Asked for before the close."] }, equity);
    return true;
  }

  test() {
    void this.raise({ kind: "info", title: "Test alert from Altron", lines: ["Sent by the server. If this reached your phone, stop line alerts, session summaries and the daily review will too."] });
  }

  /* ---------- the loop ---------- */

  private step() {
    const mine = this.env.mine();
    if (!mine) return;
    const now = Date.now();
    const d = this.data;
    const world = () =>
      worldFrom({
        now,
        his: this.env.his(),
        mine,
        start: mine.start,
        quotes: this.env.quotes(),
        market: this.env.market(),
        following: d.following,
        news: this.newsNext(now),
        advice: d.advice,
        ai: d.limits.useAI && now >= this.aiPausedUntil && !!pick("manage", d.spend, now),
      });
    if (!d.state) {
      const w = world();
      d.state = initState(d.rules, w.mine.balance + w.mine.open, now);
      this.mark();
      return;
    }
    const w = world();
    const out = tick(d.state, w, d.rules, d.limits);
    const logged = out.state.log.length !== d.state.log.length;
    d.state = out.state;
    if (d.state.log.length > 600) d.state = { ...d.state, log: d.state.log.slice(-500) };
    for (const a of out.actions) this.env.act(opsOf(a));
    for (const al of out.alerts) {
      void this.raise(al);
      if (al.kind === "summary") void this.review(al, w.mine.balance + w.mine.open);
    }
    for (const q of out.asks) void this.ask(q);
    if (out.actions.length || out.alerts.length || logged) this.mark();
  }

  /* ---------- the calendar ---------- */

  private async refreshCalendar() {
    if (Date.now() - this.calAt < 15 * 60_000) return;
    this.calAt = Date.now();
    try {
      const r = await fetch(CAL, { signal: AbortSignal.timeout(20_000) });
      const j = (await r.json()) as { events?: { title: string; at: number; impact: number; allDay?: boolean }[] };
      this.cal = (j.events ?? []).filter((e) => e.impact >= 3 && !e.allDay);
    } catch {
      /* no calendar: no news guard until the next try */
    }
  }
  private newsNext(now: number) {
    const e = this.cal.filter((x) => x.at >= now - 5 * 60_000).sort((a, b) => a.at - b.at)[0];
    return e ? { name: e.title, at: e.at } : null;
  }

  /* ---------- alerts ---------- */

  private async raise(al: { kind: Sent["kind"]; title: string; lines: string[] }) {
    const entry: Sent = { at: Date.now(), kind: al.kind, title: al.title, lines: al.lines, sent: null };
    this.data.alerts = [...this.data.alerts.slice(-79), entry];
    this.mark();
    entry.sent = await discord(HOOK, al);
    this.data.alerts = this.data.alerts.slice();
    this.mark();
  }

  private note(his: string | undefined, text: string) {
    const st = this.data.state;
    if (st) this.data.state = { ...st, log: [...st.log, { at: Date.now(), his, kind: "guard", text }] };
  }

  /* ---------- the AI ---------- */

  private record(c: AiCall) {
    this.data.calls = [...this.data.calls.slice(-299), c];
    this.data.spend = addSpend(this.data.spend, c.model, c.inTok, c.outTok, c.at);
  }

  private async ask(q: Ask) {
    if (this.thinking[q.his]) return;
    const now = Date.now();
    const tier: Tier = q.kind === "entry" ? "entry" : "manage";
    const m = pick(tier, this.data.spend, now);
    if (!m) return;
    this.thinking = { ...this.thinking, [q.his]: true };
    this.mark();
    // a second opinion on entries, for comparing; it never acts
    const s = q.kind === "entry" ? pick("shadow", this.data.spend, now) : null;
    if (s)
      void decide(s, q).then((r) => {
        this.record({ at: Date.now(), his: q.his, kind: q.kind, tier: "shadow", model: r.model, label: r.label, ok: r.ok, acted: false, ...(r.ok ? r.decision : { error: r.error }), usd: r.usd, ms: r.ms, inTok: r.inTok, outTok: r.outTok });
        this.mark();
      });
    try {
      const r = await decide(m, q);
      this.record({ at: Date.now(), his: q.his, kind: q.kind, tier, model: r.model, label: r.label, ok: r.ok, acted: r.ok, ...(r.ok ? r.decision : { error: r.error }), usd: r.usd, ms: r.ms, inTok: r.inTok, outTok: r.outTok });
      if (r.ok) {
        this.data.advice = [...this.data.advice.slice(-30), { his: q.his, at: Date.now(), kind: q.kind, action: r.decision.action, price: r.decision.price, reason: r.decision.reason }];
        this.aiFails = 0;
      } else {
        this.aiFails++;
        // two misses in a row: the rules decide on their own for ten minutes
        if (this.aiFails >= 2) this.aiPausedUntil = Date.now() + 10 * 60_000;
        if (this.aiFails === 2) this.note(q.his, `${m.label} isn't answering (${r.error}). The rules are deciding on their own for ten minutes`);
      }
    } finally {
      this.thinking = { ...this.thinking, [q.his]: false };
      this.mark();
    }
  }

  /* ---------- the day's review ---------- */

  private async review(al: Alert, equity: number) {
    const d = this.data;
    const st = d.state;
    if (!st) return;
    const now = Date.now();
    const since = now - 24 * 3_600_000;
    const day = sessionDay(now - 60_000);
    // a day is reviewed once; one that failed (no key, a timeout) can be asked for again
    if (d.reviews.some((r) => r.day === day && (r.coach || !r.coachError))) return;
    d.reviews = d.reviews.filter((r) => r.day !== day);
    const acc = account(d.rules, d.limits, st, equity);
    const follows = Object.values(st.follows).filter((f) => f.seenAt >= since);
    const rev: Review = { day, at: now, title: al.title, lines: al.lines, equity, pnl: equity - st.dayStart, trades: follows.filter((f) => f.enteredAt).length, phase: PHASE_LABEL[acc.phase] };
    d.reviews = [...d.reviews.slice(-89), rev];
    this.mark();

    const m = pick("coach", d.spend, now);
    if (!m) {
      rev.coachError = keys().anthropic ? "Skipped: the week's AI budget is nearly spent" : "No AI key set";
      this.mark();
      return;
    }
    const his = this.env.his().trades.filter((t) => t.openedAt >= since).map((t) => ({ id: t.id, sym: t.sym, side: t.side, qty: t.qty, openedAt: new Date(t.openedAt).toISOString(), closedAt: t.closedAt ? new Date(t.closedAt).toISOString() : null, entry: t.entryValue / Math.max(1, t.entryQty), exit: t.exitQty ? t.exitValue / t.exitQty : null, stop: t.stop ?? null, target: t.target ?? null, pnl: Math.round(t.pnl) }));
    const data = {
      day: new Date(now).toISOString().slice(0, 10),
      account: { rules: d.rules, phase: rev.phase, equity: Math.round(equity), dayStart: Math.round(st.dayStart), floor: Math.round(acc.floor), drawdownUsed: Math.round(acc.used * 100) + "%", roomAboveStopLine: Math.round(acc.usable) },
      settings: d.limits,
      yazan: his,
      ours: follows.map((f) => ({ ...f, seenAt: new Date(f.seenAt).toISOString() })),
      decisions: st.log.filter((x) => x.at >= since).map((x) => ({ at: new Date(x.at).toISOString().slice(11, 19), his: x.his, kind: x.kind, by: x.by, text: x.text, sub: x.sub })),
      models: d.calls.filter((c) => c.at >= since).map((c) => ({ at: new Date(c.at).toISOString().slice(11, 19), his: c.his, model: c.label, acted: c.acted, action: c.action, reason: c.reason, error: c.error, seconds: Math.round(c.ms / 1000) })),
      halted: st.halted,
    };
    const r = await coach(m, data);
    this.record({ at: Date.now(), kind: "coach", tier: "coach", model: r.model, label: r.label, ok: r.ok, acted: false, error: r.ok ? undefined : r.error, usd: r.usd, ms: r.ms, inTok: r.inTok, outTok: r.outTok });
    if (r.ok) {
      rev.coach = { text: r.text, label: r.label, usd: r.usd };
      void this.raise({ kind: "review", title: `Review of the day, by ${r.label}`, lines: [r.text] });
    } else rev.coachError = r.error;
    d.reviews = d.reviews.slice();
    this.mark();
  }

  /** Spend this week, for the health check. */
  spent() {
    const s = this.data.spend;
    return s.week === weekOf() ? s.usd : 0;
  }
}
