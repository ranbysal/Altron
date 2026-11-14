/*
 * The follow engine. Watches each of Yazan's trades from the second he enters, decides whether
 * and how to join, sizes it to the room we have, manages our exits, and stops everything at the
 * stop line. Pure: it takes the state of the world and returns orders to send, things to log and
 * alerts to raise, so the same code runs in a browser on paper today and on a server tomorrow.
 *
 * Three parts, kept apart on purpose:
 *   - the watcher measures (move, speed, how far against him, room)
 *   - the brain chooses from a fixed menu (rules here, or the AI's advice when it's on)
 *   - the guardrails decide what's allowed, whatever the brain says
 */

/* ------------------------------------------------------------------ */
/* inputs                                                              */
/* ------------------------------------------------------------------ */

export type Under = "NQ" | "ES" | "YM" | "GC";
export type Dir = 1 | -1;

/** Yazan's trade as his book has it. */
export type His = {
  id: string;
  under: Under;
  dir: Dir;
  /** his size, in his contracts (minis) */
  qty: number;
  entry: number;
  openedAt: number;
  closedAt?: number;
  exit?: number;
  /** his targets, nearest first: half comes off at the first, the rest at the second */
  targets: number[];
  stop?: number;
};

/** An order of ours, tagged by what the engine placed it for. */
export type MyOrder = { id: string; side: Dir; qty: number; price: number; follows?: string; tag?: string };
export type MyFill = { under: Under; side: Dir; qty: number; price: number; at: number; role: "entry" | "stop" | "target" | "exit" };

export type Mine = {
  /** our positions in the micros, with the trade of his each follows */
  positions: { under: Under; qty: number; avg: number; follows?: string }[];
  orders: MyOrder[];
  /** our fills in his market, for telling how we got out */
  fills: MyFill[];
  /** what each of our closed trades made, by the trade of his it followed */
  results: Record<string, number>;
  /** start balance plus everything realized */
  balance: number;
  /** open P&L right now */
  open: number;
};

export type Advice = { his: string; at: number; kind: "entry" | "manage"; action: string; price?: number; reason: string };

export type World = {
  now: number;
  /** the last price of his market (the micro trades the same price) */
  last: number;
  /** recent one-minute bars of his market, oldest first */
  bars: { t: number; h: number; l: number; c: number }[];
  /** one-second closes since a little before his entry, oldest first */
  ticks: { t: number; p: number }[];
  /** his recent trades, oldest first; the last is his open one or his latest */
  his: His[];
  mine: Mine;
  following: boolean;
  /** the next high-impact release, if one is scheduled */
  news: { name: string; at: number } | null;
  advice: Advice[];
  /** whether an AI is answering; when it isn't, the rules decide everything */
  ai: boolean;
};

/** The firm's rules for the account. Entered by hand until accounts are connected. */
export type Rules = {
  name: string;
  size: number;
  drawdown: number;
  trailing: "eod" | "intraday";
  /** the evaluation's profit target */
  profitTarget: number;
  /** the firm's own daily loss limit, if it has one */
  dailyLoss: number | null;
  funded: boolean;
  /** the floor stops trailing once it reaches the start plus this */
  lockAbove: number;
  /** close anything open by this time, minutes after midnight New York */
  closeBy: number;
  /** the firm's consistency rule: no one day may make more than this share of the profit target */
  consistency: number | null;
  /** the most micros the firm lets the account hold */
  firmMicros: number | null;
  /** the preset these rules came from, if any */
  preset: string | null;
};

/** Firm accounts, as the firm lists them. Lucid Flex is the account being paper tested. */
export const PRESETS: { id: string; label: string; rules: Omit<Rules, "name" | "funded" | "closeBy"> }[] = [
  { id: "lucid-flex-150", label: "Lucid Flex 150K", rules: { size: 150_000, drawdown: 4_500, trailing: "eod", profitTarget: 9_000, dailyLoss: 2_700, lockAbove: 100, consistency: 0.4, firmMicros: 100, preset: "lucid-flex-150" } },
  { id: "lucid-flex-100", label: "Lucid Flex 100K", rules: { size: 100_000, drawdown: 3_000, trailing: "eod", profitTarget: 6_000, dailyLoss: 1_800, lockAbove: 100, consistency: 0.4, firmMicros: 60, preset: "lucid-flex-100" } },
];

export type Phase = "eval" | "buffer" | "built";

export type Limits = {
  /** stop everything once this share of the drawdown is used */
  stopLine: number;
  /** risk per trade as a share of the room left above the stop line, by phase */
  risk: Record<Phase, number>;
  /** no new trades once the day has cost this share of the day's starting room above the stop line */
  dailyStop: number;
  /** seconds from his entry in which we decide */
  window: number;
  /** the least reward (to his first target) per unit of our stop we'll take */
  minRR: number;
  /** our stop, in one-minute average ranges */
  stopAtr: number;
  /** never a stop tighter than this, in points */
  minStop: Record<Under, number>;
  /** no new trade with a release due within this many minutes */
  newsMin: number;
  /** most micros on one trade */
  maxMicros: number;
  useAI: boolean;
};

export const DEFAULT_RULES: Rules = { name: "Account 1", funded: false, closeBy: 16 * 60 + 55, ...PRESETS[0].rules };

export const DEFAULT_LIMITS: Limits = {
  stopLine: 0.75,
  risk: { eval: 0.15, buffer: 0.08, built: 0.15 },
  dailyStop: 0.35,
  window: 120,
  minRR: 1.2,
  stopAtr: 4,
  minStop: { NQ: 40, ES: 10, YM: 80, GC: 6 },
  newsMin: 2,
  maxMicros: 30,
  useAI: true,
};

export const MICRO = { NQ: { sym: "MNQ", pv: 2, tick: 0.25 }, ES: { sym: "MES", pv: 5, tick: 0.25 }, YM: { sym: "MYM", pv: 0.5, tick: 1 }, GC: { sym: "MGC", pv: 10, tick: 0.1 } } as const;
const COMMISSION = 0.9; // per micro, round turn

/* ------------------------------------------------------------------ */
/* state                                                               */
/* ------------------------------------------------------------------ */

export type Status = "watching" | "working" | "in" | "done" | "passed";

/** Our side of one of his trades. */
export type Follow = {
  his: string;
  under: Under;
  dir: Dir;
  status: Status;
  seenAt: number;
  /** what we decided, and whether the rules or the AI decided it */
  decidedAt?: number;
  by?: "rules" | "ai";
  why?: string;
  micros?: number;
  stopDist?: number;
  tp1?: number;
  tp2?: number;
  q1?: number;
  q2?: number;
  /** the better price we asked for */
  limit?: number;
  enteredAt?: number;
  avg?: number;
  stop?: number;
  tp1Done?: boolean;
  /** set before we close it ourselves, so the log says why */
  closing?: string;
  exitAt?: number;
  exitWhy?: string;
  pnl?: number;
  askedAt?: number;
  usedAdvice?: number;
};

export type LogKind = "see" | "think" | "act" | "fill" | "out" | "guard" | "alert";
export type LogItem = { at: number; his?: string; kind: LogKind; text: string; sub?: string; by?: "rules" | "ai" };

export type State = {
  v: 2;
  startedAt: number;
  halted: { at: number; why: string } | null;
  follows: Record<string, Follow>;
  log: LogItem[];
  /** the trading day (sessions open at 6 pm New York) and where it started */
  day: number;
  dayStart: number;
  /** the firm's floor and what it trails */
  floor: number;
  high: number;
  lastEquity: number;
  summaryDay: number;
  passedAt: number | null;
};

export function initState(rules: Rules, equity: number, now: number): State {
  return { v: 2, startedAt: now, halted: null, follows: {}, log: [], day: sessionDay(now), dayStart: equity, floor: rules.size - rules.drawdown, high: Math.max(rules.size, equity), lastEquity: equity, summaryDay: -1, passedAt: null };
}

/* ------------------------------------------------------------------ */
/* outputs                                                             */
/* ------------------------------------------------------------------ */

export type Action =
  | { kind: "enter"; his: string; under: Under; side: Dir; qty: number; type: "MKT" | "LMT"; price?: number }
  | { kind: "exit"; his: string; under: Under; side: Dir; qty: number; role: "stop" | "target"; tag: "stop" | "tp1" | "tp2" | "half"; price: number }
  | { kind: "cancel"; id: string }
  | { kind: "move"; id: string; price: number }
  | { kind: "flatten"; under?: Under; his?: string };

export type Alert = { kind: "stopline" | "summary" | "passed" | "info"; title: string; lines: string[] };

/** A question for the AI, with everything it needs to answer it. */
export type Ask = { his: string; kind: "entry" | "manage"; brief: Brief };

export type Brief = {
  market: Under;
  side: "long" | "short";
  hisEntry: number;
  hisTargets: number[];
  hisStop: number | null;
  hisSize: number;
  secondsSinceEntry: number;
  window: number;
  price: number;
  /** points, positive in his favour */
  move: number;
  best: number;
  worst: number;
  speed30: number;
  atr: number;
  rewardToRisk: number | null;
  phase: Phase;
  room: number;
  roomAboveStopLine: number;
  budget: number;
  plan: { micros: number; stop: number } | null;
  ours: { qty: number; avg: number; stop: number | undefined; tp1Done: boolean; pnl: number } | null;
  news: string | null;
  menu: string[];
};

export type Out = { state: State; actions: Action[]; alerts: Alert[]; asks: Ask[] };

/* ------------------------------------------------------------------ */
/* the account                                                         */
/* ------------------------------------------------------------------ */

export type Account = { equity: number; floor: number; room: number; used: number; usable: number; phase: Phase; target: number; passed: boolean };

export function account(rules: Rules, limits: Limits, st: State, equity: number): Account {
  const room = equity - st.floor;
  const used = Math.max(0, rules.drawdown - room) / rules.drawdown;
  const usable = room - (1 - limits.stopLine) * rules.drawdown;
  const target = rules.size + rules.profitTarget;
  const phase: Phase = !rules.funded ? "eval" : equity >= rules.size + rules.drawdown ? "built" : "buffer";
  return { equity, floor: st.floor, room, used, usable, phase, target, passed: !rules.funded && equity >= target };
}

export const PHASE_LABEL: Record<Phase, string> = { eval: "Evaluation", buffer: "Building the buffer", built: "Buffer built" };

/* ------------------------------------------------------------------ */
/* the watcher                                                         */
/* ------------------------------------------------------------------ */

export type Seen = { t: number; move: number; best: number; worst: number; speed30: number; speed10: number; atr: number; progress: number };

/** Average one-minute range over the last fourteen bars. */
export function atrOf(bars: World["bars"]): number {
  const xs = bars.slice(-15);
  if (xs.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < xs.length; i++) sum += Math.max(xs[i].h - xs[i].l, Math.abs(xs[i].h - xs[i - 1].c), Math.abs(xs[i].l - xs[i - 1].c));
  return sum / (xs.length - 1);
}

export function watch(h: His, w: World): Seen {
  const dir = h.dir;
  const since = w.ticks.filter((x) => x.t >= h.openedAt);
  let best = 0;
  let worst = 0;
  for (const x of since) {
    const m = (x.p - h.entry) * dir;
    best = Math.max(best, m);
    worst = Math.min(worst, m);
  }
  const move = (w.last - h.entry) * dir;
  best = Math.max(best, move);
  worst = Math.min(worst, move);
  const ago = [...w.ticks].reverse().find((x) => x.t <= w.now - 30_000);
  const speed30 = ago ? (w.last - ago.p) * dir : move;
  const ago10 = [...w.ticks].reverse().find((x) => x.t <= w.now - 10_000);
  const speed10 = ago10 ? (w.last - ago10.p) * dir : move;
  const tp = h.targets[0];
  const progress = tp !== undefined ? move / Math.max(1e-9, Math.abs(tp - h.entry)) : 0;
  return { t: (w.now - h.openedAt) / 1000, move, best, worst, speed30, speed10, atr: atrOf(w.bars), progress };
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const NY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" });
function nyParts(ms: number) {
  const p = Object.fromEntries(NY.formatToParts(ms).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, min: (+p.hour % 24) * 60 + +p.minute };
}
/** Minutes after midnight, New York. */
export const nyMin = (ms: number) => nyParts(ms).min;
/** The trading day: sessions open at 6 pm New York the evening before. */
export function sessionDay(ms: number): number {
  const p = nyParts(ms);
  return Math.floor(Date.UTC(p.y, p.mo - 1, p.d) / 86_400_000) + (p.min >= 18 * 60 ? 1 : 0);
}
const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
const pts = (n: number) => `${Math.abs(n) >= 10 ? Math.round(Math.abs(n)) : Math.abs(n).toFixed(2)} pts`;
const px = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const snap = (u: Under, p: number) => Math.round(p / MICRO[u].tick) * MICRO[u].tick;
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Our stop distance for this trade: wide enough for normal noise, never under the floor for the market. */
function stopFor(h: His, s: Seen, limits: Limits, from: number): number {
  let d = Math.max(limits.minStop[h.under], limits.stopAtr * s.atr);
  // if he has a stop of his own that's tighter, we're out when he is anyway
  if (h.stop !== undefined) {
    const his = (from - h.stop) * h.dir;
    if (his > 0 && his < d) d = Math.max(limits.minStop[h.under] * 0.5, his);
  }
  return d;
}

/** Size to the budget: as many micros as the stop allows, or none. */
function size(h: His, budget: number, stopDist: number, limits: Limits, firmCap = Infinity): { micros: number; stopDist: number } | null {
  const pv = MICRO[h.under].pv;
  let micros = Math.floor(budget / (stopDist * pv + COMMISSION));
  if (micros >= 1) return { micros: Math.min(micros, limits.maxMicros, firmCap, Math.max(1, h.qty * 10)), stopDist };
  // one micro fits only with a tighter stop: take it if that stop is still sensible
  const tight = (budget - COMMISSION) / pv;
  if (tight >= limits.minStop[h.under]) return { micros: 1, stopDist: tight };
  micros = 0;
  return null;
}

/** Half at his first target, the rest at the second. With one micro, the first while the buffer is thin. */
function split(micros: number, h: His, phase: Phase): { q1: number; q2: number } {
  if (h.targets.length < 2) return { q1: micros, q2: 0 };
  if (micros === 1) return phase === "built" ? { q1: 0, q2: 1 } : { q1: 1, q2: 0 };
  const q1 = Math.ceil(micros / 2);
  return { q1, q2: micros - q1 };
}

/** Reward to his first target per unit of our stop, from a given price. */
function rr(h: His, price: number, stopDist: number): number | null {
  const tp = h.targets[0];
  if (tp === undefined) return null;
  return ((tp - price) * h.dir) / stopDist;
}

/* ------------------------------------------------------------------ */
/* the brain: rules                                                    */
/* ------------------------------------------------------------------ */

export type EntryCall = { act: "now" | "limit" | "wait" | "pass" | "cancel"; price?: number; why: string };

/**
 * What the rules would do with his trade right now. They never rest an order under the market
 * to "get a better price": a trade that's failing is exactly the one that would fill it. They
 * go in when the trade shows its hand: running his way, or dipping and turning back.
 */
export function rulesEntry(h: His, s: Seen, f: Follow, limits: Limits, stopDist: number, price: number): EntryCall {
  const ratio = rr(h, price, stopDist);
  if (s.t < 5) return { act: "wait", why: "Reading his trade" };
  if (ratio !== null && ratio < limits.minRR) {
    return { act: "pass", why: `Price is ${pct(Math.max(0, s.progress))} of the way to his target; what's left is ${(Math.floor(ratio * 100) / 100).toFixed(ratio >= limits.minRR - 0.1 ? 2 : 1)}× our stop, under the ${limits.minRR.toFixed(1)}× we need` };
  }
  if (f.limit !== undefined && s.speed30 <= -0.5 * s.atr) return { act: "cancel", why: `Falling fast against him (${pts(-s.speed30)} in 30 seconds); pulled our order and kept watching` };
  if (s.speed30 >= 0.75 * s.atr && s.move > 0.15 * s.atr) return { act: "now", why: `Moving his way fast (${pts(s.speed30)} in 30 seconds), going now so we don't miss it` };
  if (s.worst <= -0.3 * s.atr && s.speed10 >= 0.15 * s.atr && s.move > s.worst + 0.25 * s.atr && s.move < 0.5 * s.atr) {
    return { act: "now", why: `It dipped ${pts(-s.worst)} against him and is turning back his way (${pts(s.speed10)} in 10 seconds)` };
  }
  if (s.t >= limits.window) {
    if (s.move < -s.atr && s.speed30 < 0) return { act: "pass", why: `It's ${pts(-s.move)} against him and still falling. Not joining a trade that's failing` };
    return { act: "now", why: s.move >= 0 ? `Window's up and the price still works (${ratio === null ? "no target set" : `${ratio.toFixed(1)}× our stop to his target`})` : `Window's up; it's ${pts(-s.move)} against him but steadying, a better price than his` };
  }
  return { act: "wait", why: s.speed30 < 0 ? "Going against him; waiting to see it turn" : "Watching for it to show its hand" };
}

/** Check the AI's entry answer against the menu and the guardrails. */
function checkEntry(a: Advice, h: His, s: Seen, limits: Limits, stopDist: number, price: number): EntryCall | null {
  const ratio = rr(h, price, stopDist);
  if (a.action === "pass") return { act: "pass", why: a.reason };
  if (a.action === "wait") return { act: "wait", why: a.reason };
  if (a.action === "enter_now") {
    if (ratio !== null && ratio < limits.minRR) return null;
    return { act: "now", why: a.reason };
  }
  if (a.action === "limit" && a.price !== undefined) {
    // a better price than the market, within reach
    const better = (price - a.price) * h.dir;
    if (better < 0 || better > 1.5 * Math.max(s.atr, limits.minStop[h.under] / 4)) return null;
    const r = rr(h, a.price, stopDist);
    if (r !== null && r < limits.minRR) return null;
    return { act: "limit", price: snap(h.under, a.price), why: a.reason };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* one step                                                            */
/* ------------------------------------------------------------------ */

const ASK_ENTRY_MS = 20_000;
const ASK_MANAGE_MS = 45_000;
const LOG_MAX = 400;

export function tick(prev: State, w: World, rules: Rules, limits: Limits): Out {
  const st: State = { ...prev, follows: { ...prev.follows }, log: prev.log.slice() };
  const actions: Action[] = [];
  const alerts: Alert[] = [];
  const asks: Ask[] = [];
  const log = (x: Omit<LogItem, "at">) => {
    st.log.push({ at: w.now, ...x });
    if (st.log.length > LOG_MAX) st.log.splice(0, st.log.length - LOG_MAX);
  };
  const equity = w.mine.balance + w.mine.open;
  const min = nyMin(w.now);

  /* ---------- the floor, the day, the summary ---------- */
  const day = sessionDay(w.now);
  if (rules.trailing === "intraday") {
    st.high = Math.max(st.high, equity);
    st.floor = Math.max(st.floor, Math.min(st.high - rules.drawdown, rules.size + rules.lockAbove));
  }
  if (day !== st.day) {
    if (rules.trailing === "eod") {
      // the close sets the floor: where the account ended the last session
      st.high = Math.max(st.high, st.lastEquity);
      st.floor = Math.max(st.floor, Math.min(st.high - rules.drawdown, rules.size + rules.lockAbove));
    }
    st.day = day;
    st.dayStart = equity;
  }
  st.lastEquity = equity;
  const acct = account(rules, limits, st, equity);
  if (acct.passed && st.passedAt === null) {
    st.passedAt = w.now;
    alerts.push({ kind: "passed", title: "Evaluation target reached", lines: [`Equity ${money(equity)}, target ${money(acct.target)}.`, "Mark the account funded on Follow when the firm confirms."] });
    log({ kind: "alert", text: "Evaluation target reached", sub: `Equity ${money(equity)}` });
  }
  // the session summary, once a day at the 5 pm close
  if (min >= 17 * 60 && min < 18 * 60 && st.summaryDay !== day) {
    st.summaryDay = day;
    const today = Object.values(st.follows).filter((f) => f.why !== "Before following started" && sessionDay(f.seenAt) === day);
    const taken = today.filter((f) => f.enteredAt);
    const made = taken.reduce((a, f) => a + (f.pnl ?? 0), 0);
    const d = equity - st.dayStart;
    alerts.push({
      kind: "summary",
      title: `Session summary: ${d >= 0 ? "+" : ""}${money(d)}`,
      lines: [
        `Yazan traded ${today.length} ${today.length === 1 ? "time" : "times"}. We joined ${taken.length}, passed ${today.length - taken.length}.`,
        taken.length ? `Our trades made ${money(made)}.` : "No trades of ours today.",
        `${PHASE_LABEL[acct.phase]}. Equity ${money(equity)}, ${money(acct.room)} above the floor, ${money(Math.max(0, acct.usable))} before the stop line.`,
        st.halted ? `Stopped since ${new Date(st.halted.at).toLocaleString("en-US", { timeZone: "America/New_York" })}: ${st.halted.why}` : "",
      ].filter(Boolean),
    });
    log({ kind: "alert", text: "Session summary sent" });
  }

  /* ---------- the stop line ---------- */
  if (!st.halted && acct.usable <= 0) {
    st.halted = { at: w.now, why: `${pct(acct.used)} of the drawdown used` };
    actions.push({ kind: "flatten" });
    for (const o of w.mine.orders) actions.push({ kind: "cancel", id: o.id });
    for (const f of Object.values(st.follows)) {
      if (f.status === "watching" || f.status === "working") st.follows[f.his] = { ...f, status: "passed", why: "Stop line hit" };
      if (f.status === "in") st.follows[f.his] = { ...f, closing: "Stop line hit" };
    }
    alerts.push({ kind: "stopline", title: "Stop line hit: trading stopped", lines: [`${pct(acct.used)} of the ${money(rules.drawdown)} drawdown is used. Everything is closed.`, `Equity ${money(equity)}, ${money(acct.room)} above the floor.`, "Nothing more trades until you restart it on Follow."] });
    log({ kind: "guard", text: "Stop line hit. Everything closed, trading stopped", sub: `${pct(acct.used)} of the drawdown used` });
  }

  const dayDown = equity - st.dayStart;
  const dayBudget = Math.max(0, st.dayStart - st.floor - (1 - limits.stopLine) * rules.drawdown) * limits.dailyStop;
  const dayStopped = dayDown <= -dayBudget && dayBudget > 0;
  const closing = min >= rules.closeBy && min < 18 * 60;

  /* ---------- why we can't take a new trade, if we can't ---------- */
  const blocked = (): string | null => {
    if (st.halted) return "Trading is stopped at the stop line";
    if (!w.following) return "Following is paused";
    if (dayStopped) return `Today has cost ${money(-dayDown)}, the daily stop`;
    if (rules.dailyLoss !== null && -dayDown >= rules.dailyLoss * 0.8) return "Close to the firm's daily loss limit";
    // in the evaluation, no one day may make too much of the target: stop a little short of it
    if (!rules.funded && rules.consistency !== null && dayDown >= rules.consistency * rules.profitTarget * 0.9) return `Up ${money(dayDown)} today: more would break the ${Math.round(rules.consistency * 100)}% consistency rule`;
    if (closing) return "Too close to the session close";
    if (w.news && w.news.at - w.now <= limits.newsMin * 60_000 && w.news.at - w.now > -limits.newsMin * 60_000) return `${w.news.name} is due`;
    return null;
  };

  /* ---------- his trades ---------- */
  // anything of ours that outlived the trade it followed
  for (const f of Object.values(st.follows)) {
    if (f.status !== "done" && f.status !== "passed") continue;
    for (const o of w.mine.orders) if (o.follows === f.his && !actions.some((a) => a.kind === "cancel" && a.id === o.id)) actions.push({ kind: "cancel", id: o.id });
  }
  const latest = w.his[w.his.length - 1];
  for (const h of w.his) {
    const f = st.follows[h.id];
    if (h === latest || (f && (f.status === "watching" || f.status === "working" || f.status === "in"))) step(h);
  }

  function step(h: His) {
    if (!st.follows[h.id]) {
      const late = (w.now - h.openedAt) / 1000;
      const why = h.closedAt ? (h.closedAt < st.startedAt ? "Before following started" : "Missed: Follow wasn't running") : late > limits.window ? `Seen ${late >= 5400 ? `${Math.round(late / 3600)} h` : `${Math.round(late / 60)} min`} after his entry, past the window` : null;
      st.follows[h.id] = { his: h.id, under: h.under, dir: h.dir, status: why ? "passed" : "watching", seenAt: w.now, why: why ?? undefined };
      if (!why) log({ his: h.id, kind: "see", text: `Yazan ${h.dir > 0 ? "bought" : "sold"} ${h.qty} ${h.under} at ${px(h.entry)}`, sub: h.targets.length ? `${h.targets.length > 1 ? "Targets" : "Target"} ${h.targets.map(px).join(" and ")}${h.stop !== undefined ? `, stop ${px(h.stop)}` : ", no stop posted"}` : "No target posted yet" });
    }
    let f = st.follows[h.id];
    if (f.status === "done" || f.status === "passed") return;
    const s = watch(h, w);
    const pv = MICRO[h.under].pv;
    const sym = MICRO[h.under].sym;
    const mine = w.mine.positions.find((p) => p.follows === h.id && p.under === h.under) ?? null;
    const ours = (tag: string) => w.mine.orders.find((o) => o.follows === h.id && o.tag === tag);
    const set = (patch: Partial<Follow>) => {
      f = { ...f, ...patch };
      st.follows[h.id] = f;
    };
    const budget = Math.max(0, acct.usable) * limits.risk[acct.phase];
    const brief = (kind: "entry" | "manage", plan: { micros: number; stop: number } | null): Brief => ({
      market: h.under,
      side: h.dir > 0 ? "long" : "short",
      hisEntry: h.entry,
      hisTargets: h.targets,
      hisStop: h.stop ?? null,
      hisSize: h.qty,
      secondsSinceEntry: Math.round(s.t),
      window: limits.window,
      price: w.last,
      move: s.move,
      best: s.best,
      worst: s.worst,
      speed30: s.speed30,
      atr: Math.round(s.atr * 100) / 100,
      rewardToRisk: plan && plan.stop ? rr(h, w.last, plan.stop) : null,
      phase: acct.phase,
      room: Math.round(acct.room),
      roomAboveStopLine: Math.round(acct.usable),
      budget: Math.round(budget),
      plan,
      ours: mine ? { qty: Math.abs(mine.qty), avg: mine.avg, stop: f.stop, tp1Done: !!f.tp1Done, pnl: Math.round((w.last - mine.avg) * mine.qty * pv) } : null,
      news: w.news ? `${w.news.name} in ${Math.round((w.news.at - w.now) / 60_000)} min` : null,
      menu: kind === "entry" ? ["enter_now", "limit (price: a better price than now)", "wait", "pass"] : ["hold", "tighten (price: a new stop, closer to price, never wider)", "take_half", "exit"],
    });
    const freshAdvice = (kind: "entry" | "manage") => w.advice.filter((a) => a.his === h.id && a.kind === kind && a.at > (f.usedAdvice ?? 0)).pop();

    /* ---------- watching, or an entry working ---------- */
    if (f.status === "watching" || f.status === "working") {
      const entryO = ours("entry");
      if (mine) {
        set({ status: "in", enteredAt: w.now, avg: mine.avg });
        log({ his: h.id, kind: "fill", text: `Filled ${Math.abs(mine.qty)} ${sym} at ${px(mine.avg)}`, sub: `${pts(Math.abs(h.entry - mine.avg))} ${(h.entry - mine.avg) * h.dir >= 0 ? "better" : "worse"} than his entry` });
      } else if (h.closedAt) {
        if (entryO) actions.push({ kind: "cancel", id: entryO.id });
        set({ status: "passed", why: "He was out before we got in" });
        log({ his: h.id, kind: "act", text: "Passed. He was out before we got in" });
        return;
      } else {
        const block = blocked();
        const sd = stopFor(h, s, limits, w.last);
        const sized = size(h, budget, sd, limits, rules.firmMicros ?? Infinity);
        if (block || !sized) {
          if (entryO) actions.push({ kind: "cancel", id: entryO.id });
          const why = block ?? `Room is too thin for a sensible stop`;
          set({ status: "passed", why });
          log({ his: h.id, kind: "guard", text: `Passed. ${why}`, sub: block ? undefined : `${money(budget)} to risk; one ${sym} with a ${pts(sd)} stop risks ${money(sd * pv + COMMISSION)}` });
          return;
        }
        // the AI is asked at his entry and every twenty seconds; its answer is acted on once it's back
        let call: EntryCall | null = null;
        let by: "rules" | "ai" = "rules";
        const aiOn = limits.useAI && w.ai;
        const adv = aiOn ? freshAdvice("entry") : undefined;
        if (adv) {
          set({ usedAdvice: adv.at });
          call = checkEntry(adv, h, s, limits, sized.stopDist, w.last);
          if (call) by = "ai";
          else log({ his: h.id, kind: "guard", text: "Set aside the AI's answer", sub: `It said ${adv.action}${adv.price ? ` at ${px(adv.price)}` : ""}, which the guardrails don't allow here`, by: "ai" });
        }
        if (!call || call.act === "wait") {
          const r = rulesEntry(h, s, f, limits, sized.stopDist, w.last);
          // the rules always take the hard cases; with the AI on, the in-between ones wait for it
          if (!aiOn || r.act === "pass" || r.act === "now" || s.t >= limits.window) {
            if (r.act !== "wait") {
              call = r;
              by = "rules";
            }
          }
        }
        if (aiOn && s.t >= 4 && s.t < limits.window && (f.askedAt === undefined || w.now - f.askedAt >= ASK_ENTRY_MS)) {
          set({ askedAt: w.now });
          asks.push({ his: h.id, kind: "entry", brief: brief("entry", { micros: sized.micros, stop: sized.stopDist }) });
        }
        if (call?.act === "wait" && call.why && by === "ai" && adv) log({ his: h.id, kind: "think", text: "Waiting", sub: call.why, by });
        if (call?.act === "pass") {
          if (entryO) actions.push({ kind: "cancel", id: entryO.id });
          set({ status: "passed", why: call.why, by, decidedAt: w.now });
          log({ his: h.id, kind: "think", text: `Passed. ${call.why}`, by });
          return;
        }
        if (call?.act === "cancel") {
          if (entryO) actions.push({ kind: "cancel", id: entryO.id });
          set({ status: "watching", limit: undefined });
          log({ his: h.id, kind: "think", text: "Pulled our order", sub: call.why, by });
          return;
        }
        if (call?.act === "now") {
          if (entryO) actions.push({ kind: "cancel", id: entryO.id });
          const { q1, q2 } = split(sized.micros, h, acct.phase);
          set({ micros: sized.micros, stopDist: sized.stopDist, tp1: h.targets[0], tp2: h.targets[1], q1, q2, status: "working", decidedAt: w.now, by, why: call.why, limit: undefined });
          actions.push({ kind: "enter", his: h.id, under: h.under, side: h.dir, qty: sized.micros, type: "MKT" });
          log({ his: h.id, kind: "think", text: `Going in now: ${sized.micros} ${sym}`, sub: `${call.why}. Our stop ${pts(sized.stopDist)} away, risking ${money(sized.micros * (sized.stopDist * pv + COMMISSION))} of the ${money(budget)} allowed`, by });
          return;
        }
        if (call?.act === "limit" && call.price !== undefined && (!entryO || Math.abs(entryO.price - call.price) >= MICRO[h.under].tick)) {
          const at = size(h, budget, stopFor(h, s, limits, call.price), limits, rules.firmMicros ?? Infinity) ?? sized;
          const { q1, q2 } = split(at.micros, h, acct.phase);
          if (entryO) actions.push({ kind: "move", id: entryO.id, price: call.price });
          else actions.push({ kind: "enter", his: h.id, under: h.under, side: h.dir, qty: at.micros, type: "LMT", price: call.price });
          set({ status: "working", limit: call.price, micros: at.micros, stopDist: at.stopDist, tp1: h.targets[0], tp2: h.targets[1], q1, q2, decidedAt: w.now, by, why: call.why });
          log({ his: h.id, kind: "think", text: `Asking for ${px(call.price)}: ${at.micros} ${sym}`, sub: call.why, by });
        }
        return;
      }
    }

    /* ---------- in the trade ---------- */
    if (f.status !== "in") return;
    const stopO = ours("stop");
    const t1 = ours("tp1");
    const t2 = ours("tp2");
    if (!mine) {
      // out: by our stop, a target, him, or by hand
      const exits = w.mine.fills.filter((x) => x.under === h.under && x.side === -h.dir && x.at >= (f.enteredAt ?? 0) - 1000);
      const last = exits[exits.length - 1];
      const why = f.closing ?? (last?.role === "stop" ? (f.tp1Done ? "Stopped at our entry" : "Our stop") : last?.role === "target" ? (f.q2 && !f.tp1Done ? "His first target" : "His target") : "You closed it by hand");
      const pnl = w.mine.results[h.id] ?? 0;
      for (const o of [stopO, t1, t2, ours("entry")]) if (o) actions.push({ kind: "cancel", id: o.id });
      set({ status: "done", exitAt: w.now, exitWhy: why, pnl });
      log({ his: h.id, kind: "out", text: `Out: ${why}`, sub: `${money(pnl)} on the trade${why === "You closed it by hand" ? ". The agent won't go back in on this one" : ""}` });
      return;
    }
    const qty = Math.abs(mine.qty);
    const side = (-h.dir) as Dir;
    let stopDone = false;
    const placeStop = (p: number) => {
      if (stopO) actions.push({ kind: "cancel", id: stopO.id });
      actions.push({ kind: "exit", his: h.id, under: h.under, side, qty, role: "stop", tag: "stop", price: p });
      set({ stop: p });
      stopDone = true;
    };
    // first moment in: the stop and the targets go on
    if (f.stop === undefined) {
      const stop = snap(h.under, mine.avg - h.dir * (f.stopDist ?? limits.minStop[h.under]));
      set({ avg: mine.avg });
      placeStop(stop);
      const tp1 = h.targets[0];
      const tp2 = h.targets[1];
      const q1 = Math.min(qty, f.q1 ?? qty);
      const q2 = Math.min(qty - q1, f.q2 ?? 0);
      if (tp1 !== undefined && q1 > 0) actions.push({ kind: "exit", his: h.id, under: h.under, side, qty: q1, role: "target", tag: "tp1", price: tp1 });
      if (tp2 !== undefined && q2 > 0) actions.push({ kind: "exit", his: h.id, under: h.under, side, qty: q2, role: "target", tag: "tp2", price: tp2 });
      if (q1 === 0) set({ tp1Done: true });
      const plan = [q1 && tp1 !== undefined ? `${q1} off at ${px(tp1)}` : "", q2 && tp2 !== undefined ? `${q2} at ${px(tp2)}` : ""].filter(Boolean).join(", ");
      log({ his: h.id, kind: "act", text: `Stop at ${px(stop)}${plan ? `; ${plan}` : ""}`, sub: tp1 === undefined ? `Risk ${money(qty * Math.abs(mine.avg - stop) * pv)}. He has no target yet; we'll use his when he sets one, or follow him out` : `Risk ${money(qty * Math.abs(mine.avg - stop) * pv)}` });
      return;
    }
    // his first target took our first half: the rest can't lose now
    if (!f.tp1Done && f.q1 && !t1 && qty < (f.micros ?? qty + 1)) {
      const be = snap(h.under, mine.avg);
      const moved = (f.stop - be) * h.dir < 0;
      set({ tp1Done: true });
      placeStop(moved ? be : f.stop);
      log({ his: h.id, kind: "fill", text: `First target hit: ${(f.micros ?? qty) - qty} off at ${px(h.targets[0] ?? w.last)}`, sub: `${moved ? `Stop to our entry, ${px(be)}. ` : ""}${qty} left for ${h.targets[1] !== undefined ? px(h.targets[1]) : "his exit"}` });
    }
    // follow his targets when he moves them
    const moveTo = (o: MyOrder | undefined, p: number | undefined, label: string) => {
      if (!o || p === undefined || Math.abs(o.price - p) < MICRO[h.under].tick / 2) return;
      actions.push({ kind: "move", id: o.id, price: p });
      log({ his: h.id, kind: "act", text: `He moved his ${label}; ours to ${px(p)}` });
    };
    moveTo(t1, h.targets[0], "first target");
    moveTo(t2, h.targets[1], "second target");
    // he set a target after we were in
    if (!t1 && !t2 && !f.tp1Done && h.targets[0] !== undefined && f.tp1 === undefined) {
      set({ tp1: h.targets[0], q1: qty, q2: 0 });
      actions.push({ kind: "exit", his: h.id, under: h.under, side, qty, role: "target", tag: "tp1", price: h.targets[0] });
      log({ his: h.id, kind: "act", text: `He set a target; ours at ${px(h.targets[0])}` });
    }
    // halfway to his first target: the trade can't turn into a loss
    if (!stopDone && !f.tp1Done && h.targets[0] !== undefined && (f.stop - mine.avg) * h.dir < 0) {
      const halfway = ((w.last - mine.avg) * h.dir) / Math.max(1e-9, (h.targets[0] - mine.avg) * h.dir);
      if (halfway >= 0.5) {
        const be = snap(h.under, mine.avg);
        placeStop(be);
        log({ his: h.id, kind: "act", text: `Halfway to his target. Stop to our entry, ${px(be)}` });
      }
    }
    // keep the stop on, and the size of what's left
    if (!stopDone && (!stopO || stopO.qty !== qty)) placeStop(stopO?.price ?? f.stop);
    // he's out, or the session is closing: so are we
    if (f.closing) return;
    if (h.closedAt) {
      set({ closing: "He closed, so did we" });
      actions.push({ kind: "flatten", under: h.under, his: h.id });
      log({ his: h.id, kind: "act", text: `He closed at ${h.exit !== undefined ? px(h.exit) : "market"}. Closing ours` });
      return;
    }
    if (closing) {
      set({ closing: "Session close" });
      actions.push({ kind: "flatten", under: h.under, his: h.id });
      log({ his: h.id, kind: "guard", text: "Closing ahead of the session close" });
      return;
    }
    // the AI looks in every forty-five seconds; its answer is checked before anything is done
    const aiOn = limits.useAI && w.ai;
    const adv = aiOn ? freshAdvice("manage") : undefined;
    if (adv) {
      set({ usedAdvice: adv.at });
      if (adv.action === "exit") {
        set({ closing: "Closed ahead of him" });
        actions.push({ kind: "flatten", under: h.under, his: h.id });
        log({ his: h.id, kind: "think", text: "Closing ours ahead of him", sub: adv.reason, by: "ai" });
      } else if (adv.action === "take_half" && qty >= 2) {
        const q = Math.floor(qty / 2);
        actions.push({ kind: "exit", his: h.id, under: h.under, side, qty: q, role: "target", tag: "half", price: w.last });
        log({ his: h.id, kind: "think", text: `Taking ${q} off at ${px(w.last)}`, sub: adv.reason, by: "ai" });
      } else if (adv.action === "tighten" && adv.price !== undefined && !stopDone && Math.abs(snap(h.under, adv.price) - f.stop) >= MICRO[h.under].tick) {
        const p = snap(h.under, adv.price);
        const tighter = (p - f.stop) * h.dir > 0 && (w.last - p) * h.dir > MICRO[h.under].tick * 4;
        if (tighter) {
          placeStop(p);
          log({ his: h.id, kind: "think", text: `Stop tightened to ${px(p)}`, sub: adv.reason, by: "ai" });
        } else log({ his: h.id, kind: "guard", text: "Set aside the AI's new stop", sub: `${px(p)} would widen it or sit on the price`, by: "ai" });
      } else if (adv.action === "hold" && adv.reason) {
        log({ his: h.id, kind: "think", text: "Holding", sub: adv.reason, by: "ai" });
      }
    }
    if (aiOn && (f.askedAt === undefined || w.now - f.askedAt >= ASK_MANAGE_MS)) {
      set({ askedAt: w.now });
      asks.push({ his: h.id, kind: "manage", brief: brief("manage", { micros: f.micros ?? qty, stop: f.stopDist ?? 0 }) });
    }
  }

  return { state: st, actions, alerts, asks };
}

/** Back to trading after the stop line, when the owner says so. */
export function restart(st: State, now: number): State {
  return { ...st, halted: null, log: [...st.log, { at: now, kind: "guard", text: "Restarted by you" }] };
}
