import { TRADES, TRADING_DAYS, type Trade as YTrade } from "@/lib/journal";
import { mulberry32 } from "@/lib/noise";

/*
 * The owner's side: Yazan's trades run through the owner's accounts.
 *
 * Sample data. Yazan's journal is the seeded one; how far each trade went against him
 * (its dip) and the price two minutes after his entry are generated here, deterministically,
 * until his real fills are recorded. Everything is measured in R, his stop distance, so a
 * dip of 0.5 means price went halfway to his stop.
 *
 * The lead account decides how to join (the copier needs one plan for all accounts);
 * each account sizes by its own room. Room is equity above the firm's floor.
 */

export type Method = "ai" | "mirror" | "staged" | "late" | "delay" | "full";
export type Mode = "mirror" | "staged" | "late";

export const METHODS: { id: Method; label: string; blurb: string }[] = [
  { id: "ai", label: "AI agent", blurb: "Picks a plan per trade from room, his size and similar past trades" },
  { id: "mirror", label: "Scaled copy", blurb: "Joins at his entry, sized by room" },
  { id: "staged", label: "Staged", blurb: "A third at his entry, two adds toward his stop" },
  { id: "late", label: "Late only", blurb: "All in two thirds of the way to his stop" },
  { id: "delay", label: "2 min delay", blurb: "Scaled copy at market two minutes later" },
  { id: "full", label: "1:1 copy", blurb: "His exact size, as a plain copier would" },
];

export const MODE_LABEL: Record<Mode, string> = { mirror: "At entry", staged: "Staged", late: "Late" };

/** Where each mode joins, as a share of the way to his stop, with equal size at each level. */
export const LEVELS: Record<Mode, number[]> = { mirror: [0], staged: [0, 1 / 3, 2 / 3], late: [2 / 3] };

export type Account = { id: string; name: string; size: number; dd: number; fee: number; lead?: boolean };

/** The owner's accounts. One for now; the pages fill in as more are added. */
export const ACCOUNTS: Account[] = [{ id: "a1", name: "Account 1", size: 150_000, dd: 4_500, fee: 360, lead: true }];

/** Yazan's room in the sample: a 150K with a cushion built up. */
export const HIS_ROOM = 20_000;
const MICRO_PV = { NQ: 2, MNQ: 2, ES: 5, MES: 5 } as const;
const MINI_PER = { NQ: 10, MNQ: 1, ES: 10, MES: 1 } as const; // micros per contract
const COMMISSION = 0.9; // per micro, round turn

export type Settings = {
  /** risk per trade against Yazan's, as shares of each one's room */
  follow: number;
  /** never more than this share of an account's room on one trade */
  maxRisk: number;
  /** stop for the day once the day has cost this share of the room it started with */
  dailyStop: number;
  /** below this room (as a share of his) join late; below `mirrorAbove` stage in */
  lateBelow: number;
  mirrorAbove: number;
  skipNews: boolean;
  payouts: boolean;
  /** how much the agent marks down a way of joining for uneven results; scaled up as room thins */
  caution: number;
};

export const DEFAULT_SETTINGS: Settings = { follow: 1.2, maxRisk: 0.22, dailyStop: 0.3, lateBelow: 0.3, mirrorAbove: 0.75, skipNews: true, payouts: true, caution: 0.1 };

/* ------------------------------------------------------------------ */
/* what we know about each of his trades                               */
/* ------------------------------------------------------------------ */

export type Path = {
  /** how far it went against him, in R (1 = his stop) */
  dip: number;
  /** where price was two minutes after his entry, in R against him (negative = in his favour) */
  at2m: number;
  /** a scheduled release within ten minutes of the entry */
  news: string | null;
  /** his risk as a share of his room */
  share: number;
  /** sized well above his recent norm: spending buffer */
  heavy: boolean;
};

const RELEASES = ["CPI", "PPI", "jobless claims", "retail sales", "a Fed speaker", "ISM services"];

export const PATHS: Path[] = (() => {
  const rnd = mulberry32(5150);
  const out: Path[] = [];
  TRADES.forEach((t, i) => {
    const u = rnd();
    let dip: number;
    if (t.r > 0.2) dip = 0.94 * Math.pow(u, 1.55);
    else if (t.r < -0.97) dip = 1;
    else if (t.r < -0.2) dip = Math.min(1, -t.r + 0.12 * u);
    else dip = 0.12 + 0.45 * u;
    const g = (rnd() + rnd() + rnd() - 1.5) * 0.32;
    const at2m = Math.max(-0.8, Math.min(dip, g + (t.r > 0.2 ? -0.05 : 0.08)));
    const news = rnd() < 0.07 ? RELEASES[Math.floor(rnd() * RELEASES.length)] : null;
    const recent = TRADES.slice(Math.max(0, i - 20), i).map((x) => x.risk).sort((a, b) => a - b);
    const med = recent.length ? recent[Math.floor(recent.length / 2)] : t.risk;
    out.push({ dip, at2m, news, share: t.risk / HIS_ROOM, heavy: recent.length >= 8 && t.risk > med * 1.6 });
  });
  return out;
})();

/** Of his trades that went at least this far against him, how many still won. */
export function dipCurve(upTo = TRADES.length, filter?: (t: YTrade) => boolean) {
  const steps = Array.from({ length: 10 }, (_, k) => k / 10);
  return steps.map((d) => {
    let n = 0;
    let w = 0;
    for (let i = 0; i < upTo; i++) {
      const t = TRADES[i];
      if (filter && !filter(t)) continue;
      if (PATHS[i].dip + 1e-9 < d) continue;
      n++;
      if (t.r > 0.2) w++;
    }
    return { d, n, win: n ? w / n : 0 };
  });
}

/* ------------------------------------------------------------------ */
/* the replay                                                          */
/* ------------------------------------------------------------------ */

export type Leg = {
  acct: string;
  micros: number;
  filled: number[]; // levels that filled
  pnl: number;
  /** open loss at the worst point of the trade */
  heat: number;
  risk: number;
  breached?: boolean;
};

export type Decision = { mode: Mode | "skip"; reason: string };

export type Row = {
  i: number;
  t: YTrade;
  decision: Decision;
  legs: Leg[];
  pnl: number;
  /** what the simple rules made on the same trade, all accounts */
  rules: Record<"mirror" | "staged" | "late", number>;
};

export type AcctState = { balance: number; floor: number; high: number; peak: number; maxDD: number; breachedAt: number | null; payouts: number; trades: number; wins: number };

export type Payout = { acct: string; day: string; amount: number };

export type Result = {
  method: Method;
  rows: Row[];
  accounts: Record<string, AcctState>;
  /** per account, after each of his trades: balance and floor */
  /** after each of his trades: the account's balance, its floor, and what it had paid out so far */
  track: Record<string, { balance: number; floor: number; paid: number }[]>;
  payouts: Payout[];
};

const pct = (x: number) => `${Math.round(x * 100)}%`;
const roomOf = (a: AcctState) => a.balance - a.floor;

function legFor(t: YTrade, p: Path, mode: Mode | "at2m" | "full", budget: number, mult = 1): Leg | null {
  const D = Math.abs(t.entry - t.stop);
  const pv = MICRO_PV[t.mkt];
  const levels = mode === "at2m" ? [p.at2m] : mode === "full" ? [0] : LEVELS[mode];
  let micros: number;
  if (mode === "full") micros = t.size * MINI_PER[t.mkt] * mult;
  else {
    const lossPer = levels.reduce((a, d) => a + (1 - d) * D * pv + COMMISSION, 0);
    micros = Math.floor(budget / lossPer);
  }
  if (micros < 1) return null;
  const filled = mode === "at2m" || mode === "full" ? levels : levels.filter((d) => p.dip + 1e-9 >= d);
  if (!filled.length) return { acct: "", micros, filled, pnl: 0, heat: 0, risk: 0 };
  let pnl = 0;
  let heat = 0;
  let risk = 0;
  for (const d of filled) {
    pnl += micros * ((t.r + d) * D * pv - COMMISSION);
    heat += micros * Math.max(0, p.dip - d) * D * pv;
    risk += micros * (1 - d) * D * pv;
  }
  return { acct: "", micros, filled, pnl, heat, risk };
}

/** A trade's result in units of the most it could lose, had we joined it this way. */
function perRisk(t: YTrade, p: Path, mode: Mode): number {
  const levels = LEVELS[mode];
  const filled = levels.filter((d) => p.dip + 1e-9 >= d);
  const risk = levels.reduce((a, d) => a + (1 - d), 0);
  return filled.reduce((a, d) => a + (t.r + d), 0) / risk;
}

export type Outlook = { mode: Mode; n: number; mean: number; sd: number; win: number; score: number };

/**
 * How each way of joining would have done on his similar trades before this one (same index,
 * same side, most recent first), scored by return per unit of risk less a penalty for how
 * uneven it was. The thinner the room, the heavier the penalty: long losing runs are what end
 * a small account.
 */
export function outlook(i: number, ratio: number, caution = DEFAULT_SETTINGS.caution): Outlook[] {
  const t = TRADES[i];
  return outlookFor(t.mkt === "NQ" || t.mkt === "MNQ", t.side, i, ratio, caution);
}

/** The same, for any trade: which index, which side, and how much of his history came before it. */
export function outlookFor(nq: boolean, side: YTrade["side"], upTo: number, ratio: number, caution = DEFAULT_SETTINGS.caution): Outlook[] {
  const past: number[] = [];
  for (let j = upTo - 1; j >= 0 && past.length < 120; j--) {
    const x = TRADES[j];
    if ((x.mkt === "NQ" || x.mkt === "MNQ") === nq && x.side === side) past.push(j);
  }
  const lambda = caution / Math.max(0.08, ratio);
  return (["mirror", "staged", "late"] as Mode[]).map((mode) => {
    const xs = past.map((j) => perRisk(TRADES[j], PATHS[j], mode));
    const n = xs.length;
    const mean = n ? xs.reduce((a, b) => a + b, 0) / n : 0;
    const sd = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
    const win = n ? xs.filter((x) => x > 0).length / n : 0;
    return { mode, n, mean, sd, win, score: mean - lambda * sd };
  });
}

/** A plan for a live trade, from all of his history so far. */
export function planLive(nq: boolean, side: YTrade["side"], leadRoom: number, s: Settings): { mode: Mode; reason: string; look: Outlook[]; ratio: number } {
  const ratio = leadRoom / HIS_ROOM;
  const look = outlookFor(nq, side, TRADES.length, ratio, s.caution);
  const best = look.reduce((a, b) => (b.score > a.score ? b : a));
  const why = best.mode === "late" ? `${pct(best.win)} of his similar trades paid from near his stop` : best.mode === "staged" ? `${pct(best.win)} of his similar trades paid when staged` : `${pct(best.win)} of his similar trades paid from his entry`;
  return { mode: best.mode, reason: `Room is ${pct(ratio)} of his. ${why}, and it scores best once uneven results are marked down`, look, ratio };
}

export function microsFor(budget: number, stopPts: number, pv: number, mode: Mode): number {
  return Math.max(0, Math.floor(budget / LEVELS[mode].reduce((a, d) => a + (1 - d) * stopPts * pv + COMMISSION, 0)));
}
export const MICRO_VALUE = MICRO_PV;


/** What the agent decides, from what was known when he entered. */
export function decide(i: number, leadRoom: number, s: Settings, stopped: boolean): Decision {
  const p = PATHS[i];
  if (stopped) return { mode: "skip", reason: "Daily stop reached on the lead account" };
  if (s.skipNews && p.news) return { mode: "skip", reason: `${p.news[0].toUpperCase()}${p.news.slice(1)} due within ten minutes` };
  const ratio = leadRoom / HIS_ROOM;
  const room: Mode = ratio < s.lateBelow ? "late" : ratio < s.mirrorAbove ? "staged" : "mirror";
  const look = outlook(i, ratio, s.caution);
  if (look[0].n < 15) return { mode: room, reason: `Not enough similar trades yet. Room is ${pct(ratio)} of his, so ${MODE_LABEL[room].toLowerCase()}` };
  const best = look.reduce((a, b) => (b.score > a.score ? b : a));
  if (best.mean <= 0) return { mode: "skip", reason: `His similar trades have lost lately, whichever way we join` };
  const heavy = p.heavy ? ". He is sized above his norm, so half size" : "";
  const why = best.mode === "late" ? `${pct(best.win)} of similar trades paid from near his stop` : best.mode === "staged" ? `${pct(best.win)} of similar trades paid when staged` : `${pct(best.win)} of similar trades paid from his entry`;
  return { mode: best.mode, reason: `Room is ${pct(ratio)} of his. ${MODE_LABEL[best.mode]}: ${why}${heavy}` };
}

export function replay(method: Method, s: Settings = DEFAULT_SETTINGS, accounts: Account[] = ACCOUNTS): Result {
  const st: Record<string, AcctState> = {};
  const track: Record<string, { balance: number; floor: number; paid: number }[]> = {};
  for (const a of accounts) {
    st[a.id] = { balance: a.size, floor: a.size - a.dd, high: a.size, peak: a.size, maxDD: 0, breachedAt: null, payouts: 0, trades: 0, wins: 0 };
    track[a.id] = [{ balance: a.size, floor: a.size - a.dd, paid: 0 }];
  }
  const lead = accounts.find((a) => a.lead) ?? accounts[0];
  const rows: Row[] = [];
  const payouts: Payout[] = [];
  let day = "";
  let week = -1;
  const dayStart: Record<string, number> = {};
  const dayPnl: Record<string, number> = {};

  const close = () => {
    // end of day: the floor trails the closing high until it locks just above the start
    for (const a of accounts) {
      const x = st[a.id];
      if (x.breachedAt !== null) continue;
      if (x.balance > x.high) x.high = x.balance;
      x.floor = Math.max(x.floor, Math.min(x.high - a.dd, a.size + 100));
    }
  };

  TRADES.forEach((t, i) => {
    const p = PATHS[i];
    if (t.day !== day) {
      if (day) close();
      day = t.day;
      const wk = Math.floor(t.dayIndex / 5);
      if (s.payouts && wk !== week && week >= 0) {
        for (const a of accounts) {
          const x = st[a.id];
          if (x.breachedAt !== null) continue;
          const locked = x.floor >= a.size + 100;
          if (locked && roomOf(x) >= 5_000) {
            const amount = Math.min(2_500, roomOf(x) - 2_500);
            x.balance -= amount;
            x.peak -= amount;
            x.payouts += amount;
            payouts.push({ acct: a.id, day, amount });
          }
        }
      }
      week = wk;
      for (const a of accounts) {
        dayStart[a.id] = roomOf(st[a.id]);
        dayPnl[a.id] = 0;
      }
    }

    const leadSt = st[lead.id];
    const stopped = dayPnl[lead.id] <= -s.dailyStop * dayStart[lead.id];
    const rules = { mirror: 0, staged: 0, late: 0 };
    let decision: Decision;
    if (method === "ai") decision = decide(i, roomOf(leadSt), s, stopped);
    else if (stopped && method !== "full") decision = { mode: "skip", reason: "Daily stop reached" };
    else if (method === "mirror" || method === "delay" || method === "full") decision = { mode: "mirror", reason: METHODS.find((m) => m.id === method)!.blurb };
    else decision = { mode: method, reason: METHODS.find((m) => m.id === method)!.blurb };

    const legs: Leg[] = [];
    for (const a of accounts) {
      const x = st[a.id];
      if (x.breachedAt !== null) continue;
      const room = roomOf(x);
      const budget = Math.min(p.share * s.follow, s.maxRisk) * room * (method === "ai" && p.heavy ? 0.5 : 1);
      for (const m of ["mirror", "staged", "late"] as const) rules[m] += legFor(t, p, m, Math.min(p.share * s.follow, s.maxRisk) * room)?.pnl ?? 0;
      if (decision.mode === "skip") continue;
      const leg = legFor(t, p, method === "delay" ? "at2m" : method === "full" ? "full" : decision.mode, budget, a.size / 150_000);
      if (!leg) continue;
      leg.acct = a.id;
      if (!leg.filled.length) {
        legs.push(leg);
        continue;
      }
      // the worst moment of the trade comes before the exit
      if (x.balance - leg.heat <= x.floor) {
        leg.pnl = -(x.balance - x.floor);
        leg.breached = true;
        x.breachedAt = i;
      }
      x.balance += leg.pnl;
      x.trades++;
      if (leg.pnl > 0) x.wins++;
      dayPnl[a.id] += leg.pnl;
      if (x.balance > x.peak) x.peak = x.balance;
      x.maxDD = Math.min(x.maxDD, x.balance - x.peak);
      legs.push(leg);
    }
    for (const a of accounts) track[a.id].push({ balance: st[a.id].balance, floor: st[a.id].floor, paid: st[a.id].payouts });
    rows.push({ i, t, decision, legs, pnl: legs.reduce((acc, l) => acc + l.pnl, 0), rules });
  });
  close();
  return { method, rows, accounts: st, track, payouts };
}

/* ------------------------------------------------------------------ */
/* reading a result                                                    */
/* ------------------------------------------------------------------ */

export function summarize(r: Result, from = 0) {
  const rows = r.rows.filter((x) => x.t.dayIndex >= from);
  const taken = rows.filter((x) => x.legs.some((l) => l.filled.length));
  const wins = taken.filter((x) => x.pnl > 0).length;
  let eq = 0;
  let peak = 0;
  let maxDD = 0;
  let his = 0;
  const curve: { eq: number; dd: number }[] = [{ eq: 0, dd: 0 }];
  const ghost: number[] = [0];
  for (const x of rows) {
    eq += x.pnl;
    peak = Math.max(peak, eq);
    maxDD = Math.min(maxDD, eq - peak);
    curve.push({ eq, dd: eq - peak });
    his += x.t.pnl;
    ghost.push(his);
  }
  const hisWins = rows.filter((x) => x.t.r > 0.2).length;
  const gw = taken.filter((x) => x.pnl > 0).reduce((a, x) => a + x.pnl, 0);
  const gl = -taken.filter((x) => x.pnl < 0).reduce((a, x) => a + x.pnl, 0);
  const days = TRADING_DAYS.slice(from);
  const payouts = r.payouts.filter((p) => days.includes(p.day));
  return {
    rows,
    net: eq,
    his,
    curve,
    ghost,
    maxDD,
    taken: taken.length,
    skipped: rows.filter((x) => x.decision.mode === "skip").length,
    unfilled: rows.filter((x) => x.decision.mode !== "skip" && !x.legs.some((l) => l.filled.length)).length,
    winRate: taken.length ? wins / taken.length : 0,
    wins,
    losses: taken.length - wins,
    hisWinRate: rows.length ? hisWins / rows.length : 0,
    pf: gl ? gw / gl : 0,
    payouts: payouts.reduce((a, p) => a + p.amount, 0),
    payoutList: payouts,
    breached: Object.values(r.accounts).filter((a) => a.breachedAt !== null).length,
    worstAcctDD: Math.min(0, ...Object.values(r.accounts).map((a) => a.maxDD)),
  };
}

export type Summary = ReturnType<typeof summarize>;

export function dailyOf(rows: Row[]): Map<string, { pnl: number; trades: number; r: number }> {
  const m = new Map<string, { pnl: number; trades: number; r: number }>();
  for (const x of rows) {
    if (!x.legs.some((l) => l.filled.length)) continue;
    const d = m.get(x.t.day) ?? { pnl: 0, trades: 0, r: 0 };
    d.pnl += x.pnl;
    d.trades += 1;
    m.set(x.t.day, d);
  }
  return m;
}

export const FEES_TOTAL = ACCOUNTS.reduce((a, x) => a + x.fee, 0);
