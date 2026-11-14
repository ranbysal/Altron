import http from "node:http";
import { gzipSync } from "node:zlib";
import { Market, type MarketTick, type Quote } from "@/lib/desk/market";
import { applyOp, draftOf, workAll, type BookData, type Op } from "@/lib/desk/broker";
import { INSTRUMENTS, SYMS, UNDERS, type Sym } from "@/lib/desk/instruments";
import type { Seat, Toast } from "@/lib/desk/types";
import { canSee, canTrade, whoIs, type Who } from "./auth";
import { Follow } from "./follow";
import { load, saver, where } from "./persist";

/*
 * Altron's worker: one tape and one set of books for everyone, always on.
 *
 *   GET  /health            alive, and what's wired
 *   GET  /market            the recent tape, for a page to draw from
 *   GET  /books             the books this person may see
 *   GET  /stream            server-sent events: the tape four times a second, book changes,
 *                           and (for the owner) the follow engine
 *   POST /op                orders and notes from the desk, applied here and sent to everyone
 *   GET  /follow, POST /follow   the follow engine's state and the owner's controls
 *
 * Browsers authenticate with their Supabase access token (Authorization: Bearer, or ?token=
 * for the event stream, which can't send headers).
 */

const PORT = Number(process.env.PORT) || 8787;
const ORIGINS = (process.env.ALLOWED_ORIGINS || "https://altron.capital,https://www.altron.capital,http://localhost:3000,http://localhost:3100").split(",").map((s) => s.trim()).filter(Boolean);
const PREVIEWS = /^https:\/\/altron-[a-z0-9-]+\.vercel\.app$/;
const START = { trader: 100_000, owner: 150_000 };

/* ------------------------------------------------------------------ */
/* the tape                                                            */
/* ------------------------------------------------------------------ */

type Saved = { v: 1; books: Record<Seat, BookData & { start: number; rev: number }>; prices?: Record<string, number> };
const blank = (start: number) => ({ positions: {}, orders: [], fills: [], trades: [], notes: [], notices: [], start, rev: 0 });

let market: Market;
let quotes: Record<Sym, Quote>;
const readQuotes = (): Record<Sym, Quote> => Object.fromEntries(SYMS.map((s) => [s, market.quote(INSTRUMENTS[s].under)])) as Record<Sym, Quote>;

/* ------------------------------------------------------------------ */
/* the books                                                           */
/* ------------------------------------------------------------------ */

let books: Saved["books"] = { trader: blank(START.trader), owner: blank(START.owner) };
const booksSaver = saver("books", (): Saved => ({ v: 1, books: trim(books), prices: Object.fromEntries(UNDERS.map((u) => [u, market.quote(u).last])) }), 1500);

function trim(b: Saved["books"]): Saved["books"] {
  const one = (x: Saved["books"]["trader"]) => ({ ...x, fills: x.fills.slice(-600), trades: x.trades.slice(-400), notices: x.notices.slice(-300), notes: x.notes.slice(-400) });
  return { trader: one(b.trader), owner: one(b.owner) };
}

/** Run some operations, or the tape, against one book; send what changed. */
function change(seat: Seat, fn: (d: ReturnType<typeof draftOf>) => boolean, toasts = true): boolean {
  const b = books[seat];
  const d = draftOf(b, seat, []);
  if (!fn(d)) return false;
  const same = sameList(d.orders, b.orders) && sameList(d.fills, b.fills) && sameList(d.trades, b.trades) && sameList(d.notes, b.notes) && sameList(d.notices, b.notices) && samePositions(d.positions, b.positions);
  if (same && !d.toasts.length) return false;
  books[seat] = { positions: d.positions, orders: d.orders, fills: d.fills, trades: d.trades, notes: d.notes, notices: d.notices, start: b.start, rev: b.rev + 1 };
  booksSaver.mark();
  sendBook(seat, toasts ? d.toasts : []);
  return true;
}
function sameList<T>(a: readonly T[], b: readonly T[]) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
function samePositions(a: BookData["positions"], b: BookData["positions"]) {
  const ka = Object.keys(a) as Sym[];
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

/** Toasts go out for what the server did on its own; whoever sent an order saw its toast already. */
function applyOps(seat: Seat, ops: Op[], toasts = true): boolean {
  return change(
    seat,
    (d) => {
      let any = false;
      for (const x of ops) if (applyOp(d, x, { now: Date.now(), quotes })) any = true;
      return any;
    },
    toasts,
  );
}

/* ------------------------------------------------------------------ */
/* who's listening                                                     */
/* ------------------------------------------------------------------ */

type Client = { res: http.ServerResponse; who: Who | null };
const clients = new Set<Client>();

function send(c: Client, event: string, data: unknown) {
  c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function sendBook(seat: Seat, toasts: Toast[] = []) {
  const b = books[seat];
  const msg = { seat, rev: b.rev, book: b, toasts };
  for (const c of clients) if (canSee(c.who, seat)) send(c, "book", msg);
}
let followDue = false;
function sendFollow() {
  followDue = true;
}

/* ------------------------------------------------------------------ */
/* http                                                                */
/* ------------------------------------------------------------------ */

function cors(req: http.IncomingMessage, res: http.ServerResponse) {
  const o = req.headers.origin;
  if (o && (ORIGINS.includes(o) || PREVIEWS.test(o))) {
    res.setHeader("access-control-allow-origin", o);
    res.setHeader("vary", "origin");
    res.setHeader("access-control-allow-headers", "authorization, content-type");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    res.setHeader("access-control-max-age", "600");
  }
}
function json(res: http.ServerResponse, status: number, body: unknown) {
  const s = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(s);
}
async function body<T>(req: http.IncomingMessage): Promise<T | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 256_000) return null;
    chunks.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    return null;
  }
}
const tokenOf = (req: http.IncomingMessage, url: URL) => {
  const h = req.headers.authorization;
  return h?.startsWith("Bearer ") ? h.slice(7) : url.searchParams.get("token");
};

const OPS = new Set(["place", "cancel", "cancelAll", "move", "notifyMove", "dismissMove", "addBracket", "close", "flatten", "exit", "fillAt", "note", "editNote", "reset"]);

let follow: Follow;
const booted = Date.now();

const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") return void res.writeHead(204).end();
  const url = new URL(req.url ?? "/", "http://x");
  const p = url.pathname;
  try {
    if (p === "/health") return json(res, 200, { ok: true, now: Date.now(), up: Math.round((Date.now() - booted) / 1000), clients: clients.size, store: where(), ai: follow.view().wiring, spent: Math.round(follow.spent() * 100) / 100 });

    if (p === "/market" && req.method === "GET") {
      const raw = Buffer.from(JSON.stringify(market.snapshot()));
      const gz = /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", vary: "accept-encoding", ...(gz ? { "content-encoding": "gzip" } : {}) });
      return void res.end(gz ? gzipSync(raw) : raw);
    }

    const who = await whoIs(tokenOf(req, url));

    if (p === "/books" && req.method === "GET") {
      if (!who) return json(res, 401, { error: "Sign in" });
      const out: Partial<Saved["books"]> = {};
      for (const seat of ["trader", "owner"] as Seat[]) if (canSee(who, seat)) out[seat] = books[seat];
      return json(res, 200, { role: who.role, books: out });
    }

    if (p === "/stream" && req.method === "GET") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
      const c: Client = { res, who };
      clients.add(c);
      send(c, "hello", { role: who?.role ?? null, revs: { trader: books.trader.rev, owner: canSee(who, "owner") ? books.owner.rev : undefined } });
      if (who?.role === "owner") send(c, "follow", follow.view());
      req.on("close", () => clients.delete(c));
      return;
    }

    if (p === "/op" && req.method === "POST") {
      const b = await body<{ seat?: Seat; ops?: Op[] }>(req);
      const seat = b?.seat;
      if (!b || (seat !== "trader" && seat !== "owner") || !Array.isArray(b.ops) || b.ops.length > 20 || !b.ops.every((x) => x && OPS.has(x.op))) return json(res, 400, { error: "Bad request" });
      if (!canTrade(who, seat)) return json(res, 403, { error: "Not allowed" });
      applyOps(seat, b.ops, false);
      if (seat === "owner" && b.ops.some((x) => x.op === "reset")) books.owner.start = follow.data.rules.size;
      return json(res, 200, { seat, rev: books[seat].rev, book: books[seat] });
    }

    if (p === "/follow") {
      if (who?.role !== "owner") return json(res, 403, { error: "Not allowed" });
      if (req.method === "GET") return json(res, 200, follow.view());
      const b = await body<{ action?: string; patch?: Record<string, unknown>; on?: boolean }>(req);
      if (!b) return json(res, 400, { error: "Bad request" });
      if (b.action === "rules" && b.patch) follow.setRules(b.patch);
      else if (b.action === "limits" && b.patch) follow.setLimits(b.patch);
      else if (b.action === "following") follow.setFollowing(!!b.on);
      else if (b.action === "restart") follow.restart();
      else if (b.action === "startOver") follow.startOver();
      else if (b.action === "test") follow.test();
      else return json(res, 400, { error: "Unknown action" });
      return json(res, 200, follow.view());
    }

    json(res, 404, { error: "Not found" });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: "Server error" });
  }
});

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  const saved = await load<Saved>("books");
  market = new Market(saved?.prices);
  quotes = readQuotes();
  if (saved?.v === 1) books = { trader: { ...blank(START.trader), ...saved.books.trader }, owner: { ...blank(START.owner), ...saved.books.owner } };

  follow = new Follow({
    his: () => books.trader,
    mine: () => books.owner,
    quotes: () => quotes,
    market: () => market,
    act: (ops) => void applyOps("owner", ops),
    resetOwner: (start) => {
      applyOps("owner", [{ op: "reset" }]);
      books.owner = { ...books.owner, start, rev: books.owner.rev + 1 };
      sendBook("owner");
    },
    changed: sendFollow,
  });
  await follow.boot();

  // the tape: four steps a second, every resting order worked against it
  setInterval(() => {
    const now = Date.now();
    if (!market.step(now)) return;
    quotes = readQuotes();
    for (const seat of ["trader", "owner"] as Seat[]) if (books[seat].orders.length) change(seat, (d) => (workAll(d, quotes, now), true));
    const t: MarketTick = market.tickNow();
    for (const c of clients) send(c, "tick", t);
  }, 250);

  // the follow engine's state to the owner's pages, at most once a second
  setInterval(() => {
    if (!followDue) return;
    followDue = false;
    const v = follow.view();
    for (const c of clients) if (c.who?.role === "owner") send(c, "follow", v);
  }, 1000);

  // a comment line keeps proxies from closing a quiet stream
  setInterval(() => {
    for (const c of clients) c.res.write(": .\n\n");
  }, 20_000);

  // prices now and then, so a restart picks up where the tape was
  setInterval(() => booksSaver.mark(), 60_000);

  server.listen(PORT, () => console.log(`altron worker on :${PORT}, keeping state in ${where()}`));

  const stop = async () => {
    console.log("saving before exit");
    await Promise.allSettled([booksSaver.now(), follow.flush()]);
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

void main();
