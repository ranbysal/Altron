import { tick, initState, DEFAULT_RULES, DEFAULT_LIMITS, account, type World, type His, type Action, type Advice, type Limits, type Rules } from "../../lib/follow/engine";

type O = { id: string; side: 1 | -1; qty: number; type: "MKT" | "LMT" | "STP"; price: number; follows?: string; tag?: string; reduce: boolean; role: string };
type F = { side: 1 | -1; qty: number; price: number; at: number; role: "entry" | "stop" | "target" | "exit"; follows?: string };

export function run(name: string, opts: { path: (t: number) => number; his: Partial<His> & { closeAt?: number }; secs: number; start?: number; rules?: Partial<Rules>; limits?: Partial<Limits>; balance?: number; advice?: (t: number, asks: any[]) => Omit<Advice, "at" | "his"> | null; t0Offset?: number; manualCloseAt?: number; following?: boolean }) {
  const rules = { ...DEFAULT_RULES, ...opts.rules };
  const limits = { ...DEFAULT_LIMITS, useAI: !!opts.advice, ...opts.limits };
  const T0 = Date.UTC(2026, 10, 12, 15, 0, 0); // 10:00 NY
  const entryAt = T0 + 300_000;
  let seq = 0;
  let orders: O[] = [];
  const fills: F[] = [];
  let pos = null as { qty: number; avg: number; follows?: string } | null;
  let realized = opts.balance ?? rules.size;
  const results: Record<string, number> = {};
  let st = initState(rules, realized, T0);
  const his: His = { id: "H1", under: "NQ", dir: 1, qty: 2, entry: opts.path(0), openedAt: entryAt, targets: [], ...opts.his } as His;
  const ticks: { t: number; p: number }[] = [];
  const bars: World["bars"] = [];
  for (let i = 30; i > 0; i--) bars.push({ t: T0 - i * 60_000, h: 20010, l: 19990, c: 20000 }); // ATR 20
  const advice: Advice[] = [];
  const events: string[] = [];
  const fill = (o: O, p: number, now: number) => {
    const q = o.qty;
    if (!pos || pos.qty === 0) { pos = { qty: o.side * q, avg: p, follows: o.follows }; }
    else if (Math.sign(pos.qty) === o.side) { const n = Math.abs(pos.qty); pos = { ...pos, qty: pos.qty + o.side * q, avg: (pos.avg * n + p * q) / (n + q) }; }
    else { const c = Math.min(q, Math.abs(pos.qty)); const pnl = (p - pos.avg) * Math.sign(pos.qty) * c * 2 - 0.9 * c; realized += pnl; results[pos.follows ?? "?"] = (results[pos.follows ?? "?"] ?? 0) + pnl; pos = { ...pos, qty: pos.qty + o.side * c }; if (pos.qty === 0) { pos = null; orders = orders.filter((x) => !x.reduce); } }
    fills.push({ side: o.side, qty: q, price: p, at: now, role: o.role as F["role"], follows: o.follows });
    events.push(`${new Date(now - entryAt).toISOString().slice(14, 19)} FILL ${o.tag ?? o.role} ${o.side > 0 ? "B" : "S"}${q}@${p}`);
  };
  const apply = (a: Action, now: number, p: number) => {
    if (a.kind === "enter") { const o: O = { id: `o${seq++}`, side: a.side, qty: a.qty, type: a.type, price: a.price ?? p, follows: a.his, tag: "entry", reduce: false, role: "entry" }; if (a.type === "MKT") fill(o, p, now); else orders.push(o); }
    else if (a.kind === "exit") orders.push({ id: `o${seq++}`, side: a.side, qty: a.qty, type: a.role === "stop" ? "STP" : "LMT", price: a.price, follows: a.his, tag: a.tag, reduce: true, role: a.role });
    else if (a.kind === "cancel") orders = orders.filter((o) => o.id !== a.id);
    else if (a.kind === "move") orders = orders.map((o) => (o.id === a.id ? { ...o, price: a.price } : o));
    else if (a.kind === "flatten") { orders = orders.filter((o) => !o.reduce); if (pos) fill({ id: "x", side: (-Math.sign(pos.qty)) as 1 | -1, qty: Math.abs(pos.qty), type: "MKT", price: p, reduce: true, role: "exit" }, p, now); }
  };
  for (let sec = -10; sec <= opts.secs; sec++) {
    const now = entryAt + sec * 1000;
    const p = opts.path(Math.max(0, sec));
    ticks.push({ t: now, p });
    // work orders
    for (const o of [...orders]) {
      if (!orders.includes(o)) continue;
      if (o.reduce && (!pos || Math.sign(pos.qty) === o.side)) continue;
      const hit = o.type === "LMT" ? (o.side > 0 ? p <= o.price : p >= o.price) : o.type === "STP" ? (o.side > 0 ? p >= o.price : p <= o.price) : false;
      if (hit) { orders = orders.filter((x) => x !== o); fill(o, o.type === "STP" ? p : o.price, now); }
    }
    if (opts.manualCloseAt !== undefined && sec === opts.manualCloseAt && pos) { events.push("MANUAL CLOSE"); fill({ id: "m", side: (-Math.sign(pos.qty)) as 1 | -1, qty: Math.abs(pos.qty), type: "MKT", price: p, reduce: true, role: "entry" }, p, now); orders = orders.filter((o) => !o.reduce); }
    const h: His = { ...his };
    if (sec < 0) continue;
    if (opts.his.closeAt !== undefined && sec >= opts.his.closeAt) { h.closedAt = entryAt + opts.his.closeAt * 1000; h.exit = opts.path(opts.his.closeAt); }
    const open = pos ? (p - pos.avg) * pos.qty * 2 : 0;
    const w: World = { now, last: p, bars, ticks: ticks.slice(-400), his: [h], mine: { positions: pos ? [{ under: "NQ", qty: pos.qty, avg: pos.avg, follows: pos.follows }] : [], orders: orders.map((o) => ({ id: o.id, side: o.side, qty: o.qty, price: o.price, follows: o.follows, tag: o.tag })), fills: fills.map(({ follows: _f, ...x }) => ({ ...x, under: "NQ" as const })), balance: realized, open, results }, following: opts.following ?? true, news: null, advice, ai: !!opts.advice };
    const out = tick(st, w, rules, limits);
    st = out.state;
    for (const a of out.actions) apply(a, now, p);
    for (const al of out.alerts) events.push(`ALERT ${al.title}`);
    if (out.asks.length && opts.advice) { const ad = opts.advice(sec, out.asks); if (ad) advice.push({ ...ad, his: "H1", at: now + 1500 }); }
  }
  console.log(`\n=== ${name}`);
  for (const l of st.log) console.log(`  ${new Date(l.at - entryAt).toISOString().slice(14, 19)} [${l.kind}${l.by === "ai" ? "/ai" : ""}] ${l.text}${l.sub ? ` — ${l.sub}` : ""}`);
  console.log("  events:", events.join(" | "));
  const f = st.follows.H1;
  console.log(`  RESULT status=${f?.status} why=${f?.exitWhy ?? f?.why} pnl=${f?.pnl?.toFixed(2)} pos=${JSON.stringify(pos)} orders=${orders.length} halted=${!!st.halted} equity=${realized.toFixed(0)}`);
  return { st, pos, orders };
}
