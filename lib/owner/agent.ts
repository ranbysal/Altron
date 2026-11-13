import { INSTRUMENTS } from "@/lib/desk/instruments";
import { cancelOrder, fillAt, flatten, moveOrder, placeOrder, useDesk, type Book, type Side, type Trade } from "@/lib/desk/store";
import { exitOf, stopOf, targetOf } from "@/lib/community/trades";
import { MICRO_OF, planFor } from "./live";
import { ACCOUNTS, replay, type Result } from "./replay";
import { useOwner } from "./store";

/*
 * The follow agent, working the owner's own book. It reads Yazan's book, decides how to
 * join (the same plan Follow shows), places the orders a few seconds after his entry, keeps
 * our stop and target where his are, and closes when he does. The owner can trade or close
 * by hand at any time; once he's out by hand, the agent pulls what it still had working.
 *
 * Everything here is paper, like the desk itself, until the accounts are connected.
 */

const DECIDE_MS = 7_000;
/** how many of his finished trades the book starts with, so the last trade is never empty */
const HISTORY = 6;

let key = "";
let cached: Result | null = null;
function resultNow(): Result {
  const o = useOwner.getState();
  const k = `${o.method}:${JSON.stringify(o.settings)}`;
  if (k !== key || !cached) {
    cached = replay(o.method, o.settings);
    key = k;
  }
  return cached;
}

/** where his stop and target sat when we last looked, by his trade */
const seen = new Map<string, { stop?: number; target?: number }>();

function mark(id: string) {
  const h = useOwner.getState().handled;
  if (!h.includes(id)) useOwner.setState({ handled: [...h.slice(-399), id] });
}

/** Put our side of one of his trades on the book: what has filled so far, and what still works. */
function join(t: Trade, his: Book, now: number) {
  const st = useDesk.getState();
  const inst = INSTRUMENTS[t.sym];
  const sym = MICRO_OF[inst.under];
  mark(t.id);
  // already in this market by hand: leave the owner's own trade alone
  if (st.positions[sym]) return;
  const plan = planFor(t, his.orders, resultNow(), useOwner.getState().settings, now, st.quotes[t.sym].last);
  if (plan.per <= 0) return;
  const side = plan.dir as Side;
  const exits = { stopPx: plan.stop, targetPx: plan.target };
  const done = plan.tranches.filter((x) => x.filledAt !== null).sort((a, b) => a.filledAt! - b.filledAt!);
  for (const x of done) fillAt({ sym, side, qty: plan.per, price: x.price, at: x.filledAt!, follows: t.id, exits });
  if (t.closedAt) {
    if (done.length) fillAt({ sym, side: -side as Side, qty: plan.per * done.length, price: exitOf(t) ?? plan.entry, at: t.closedAt, role: "exit" });
    return;
  }
  for (const x of plan.tranches) if (x.filledAt === null) placeOrder({ sym, side, qty: plan.per, type: "LMT", limit: x.price, exits, follows: t.id });
  seen.set(t.id, { stop: plan.stop, target: plan.target });
}

function run() {
  const st = useDesk.getState();
  if (!st.ready || st.seat !== "owner" || !st.other) return;
  const his = st.other;
  const own = useOwner.getState();
  const now = Date.now();

  // his finished trades from before this book existed: the most recent few go on the record
  const fresh = his.trades.filter((t) => !own.handled.includes(t.id));
  const closed = fresh.filter((t) => t.closedAt).sort((a, b) => a.openedAt - b.openedAt);
  if (closed.length) {
    const firstRun = !st.trades.some((x) => x.follows);
    for (const t of closed.slice(0, -HISTORY)) mark(t.id);
    for (const t of closed.slice(-HISTORY)) {
      // a trade of his that opened and closed while we were following live is handled below
      if (own.following || firstRun) join(t, his, now);
      else mark(t.id);
    }
    if (firstRun) {
      // the account's balance picks up where the replay leaves it
      const lead = ACCOUNTS.find((a) => a.lead) ?? ACCOUNTS[0];
      const made = useDesk.getState().trades.reduce((a, x) => a + x.pnl, 0);
      useDesk.setState({ start: resultNow().accounts[lead.id].balance - made });
    }
  }

  for (const t of his.trades) {
    if (t.closedAt) continue;
    const handled = useOwner.getState().handled.includes(t.id);
    if (!handled) {
      if (now < t.openedAt + DECIDE_MS) continue;
      if (own.following) join(t, his, now);
      else mark(t.id);
      continue;
    }
    if (!own.following) continue;
    // follow his stop and target when he moves them
    const me = useDesk.getState();
    const sym = MICRO_OF[INSTRUMENTS[t.sym].under];
    const mine = me.trades.find((x) => x.follows === t.id);
    const stop = stopOf(t, his.orders);
    const target = targetOf(t, his.orders);
    const was = seen.get(t.id);
    seen.set(t.id, { stop, target });
    if (mine && !mine.closedAt && was) {
      const myStop = me.orders.find((o) => o.sym === sym && o.role === "stop");
      const myTarget = me.orders.find((o) => o.sym === sym && o.role === "target");
      if (stop !== undefined && stop !== was.stop && myStop && myStop.stop !== stop) moveOrder(myStop.id, stop);
      if (target !== undefined && target !== was.target && myTarget && myTarget.limit !== target) moveOrder(myTarget.id, target);
    }
    // out by hand: nothing of the agent's should bring us back in
    if (mine?.closedAt) for (const o of me.orders) if (o.follows === t.id) cancelOrder(o.id);
  }

  // he's out: so are we, and anything still working for that trade comes off
  const me = useDesk.getState();
  for (const t of his.trades) {
    if (!t.closedAt) continue;
    const sym = MICRO_OF[INSTRUMENTS[t.sym].under];
    const mine = me.trades.find((x) => x.follows === t.id && !x.closedAt);
    const left = me.orders.filter((o) => o.follows === t.id);
    if (!mine && !left.length) continue;
    for (const o of left) cancelOrder(o.id);
    if (mine && own.following && useDesk.getState().positions[sym]?.tradeId === mine.id) flatten(sym);
  }
}

let started = false;
export function startAgent() {
  if (started || typeof window === "undefined") return;
  started = true;
  run();
  window.setInterval(run, 1000);
  // and straight away when the owner's book takes the desk
  useDesk.subscribe((s, prev) => {
    if (s.seat !== prev.seat) run();
  });
}
