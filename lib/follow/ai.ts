import type { Ask } from "./engine";

/*
 * The follow agent's judgement, from whichever model the moment deserves, inside a weekly budget.
 *
 *   joining his trade      Opus 5.5 at high effort decides; Gemini 4 Carbon at high answers the
 *                          same brief alongside, so the two can be compared, but never acts
 *   managing an open trade Haiku 5.5: quick, cheap, answers in seconds
 *   the end of the day     Fable 5.2 at max effort reviews the session as a coach
 *
 * Every call's tokens are priced and counted against the week. Past 70% of the cap the second
 * opinion stops; past 90% entries drop to Haiku; at the cap the rules decide alone until Monday.
 * Plain fetch only, so the same file runs in a Next route and in the worker.
 */

export type Provider = "anthropic" | "google";
export type Tier = "entry" | "shadow" | "manage" | "coach";
export type ModelSpec = { provider: Provider; id: string; label: string; effort?: "low" | "medium" | "high" | "xhigh" | "max"; timeout: number; maxTokens: number };

/** Dollars per million tokens, input and output (thinking is billed as output). */
export const PRICES: Record<string, { in: number; out: number; until?: { at: string; in: number; out: number } }> = {
  "claude-haiku-5-5": { in: 0.1, out: 0.5 },
  "claude-sonnet-5-5": { in: 2, out: 10 },
  "claude-opus-5-5": { in: 4, out: 20 },
  "claude-fable-5-2": { in: 8, out: 40 },
  // the introductory price ends with November
  "gemini-4-carbon": { in: 4, out: 20, until: { at: "2026-12-01T00:00:00-05:00", in: 2, out: 10 } },
};

export function priceOf(model: string, inTok: number, outTok: number, at = Date.now()): number {
  const p = PRICES[model];
  if (!p) return 0;
  const r = p.until && at < Date.parse(p.until.at) ? p.until : p;
  return (inTok * r.in + outTok * r.out) / 1e6;
}

const env = (k: string) => (typeof process !== "undefined" ? process.env[k] : undefined) ?? "";

export function tiers(): Record<Tier, ModelSpec> {
  return {
    entry: { provider: "anthropic", id: env("FOLLOW_ENTRY_MODEL") || "claude-opus-5-5", label: "Opus 5.5", effort: "high", timeout: 75_000, maxTokens: 16_000 },
    shadow: { provider: "google", id: env("FOLLOW_SHADOW_MODEL") || "gemini-4-carbon", label: "Gemini 4 Carbon", effort: "high", timeout: 150_000, maxTokens: 16_000 },
    manage: { provider: "anthropic", id: env("FOLLOW_MANAGE_MODEL") || "claude-haiku-5-5", label: "Haiku 5.5", effort: "low", timeout: 15_000, maxTokens: 400 },
    coach: { provider: "anthropic", id: env("FOLLOW_COACH_MODEL") || "claude-fable-5-2", label: "Fable 5.2", effort: "max", timeout: 600_000, maxTokens: 48_000 },
  };
}

export const keys = () => ({ anthropic: env("ANTHROPIC_API_KEY"), google: env("GEMINI_API_KEY") });
export const weeklyCap = () => Number(env("AI_WEEKLY_CAP")) || 25;

/* ------------------------------------------------------------------ */
/* the week's spend                                                    */
/* ------------------------------------------------------------------ */

export type Spend = { week: number; usd: number; calls: number; byModel: Record<string, { usd: number; calls: number; in: number; out: number }> };

/** The week starts Monday at midnight, New York time; the number is that Monday's date as days since 1970. */
export function weekOf(now = Date.now()): number {
  const ny = new Date(new Date(now).toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = Math.floor(Date.UTC(ny.getFullYear(), ny.getMonth(), ny.getDate()) / 86_400_000);
  const dow = (ny.getDay() + 6) % 7; // Monday is 0
  return day - dow;
}
export const freshSpend = (now = Date.now()): Spend => ({ week: weekOf(now), usd: 0, calls: 0, byModel: {} });

export function addSpend(s: Spend, model: string, inTok: number, outTok: number, now = Date.now()): Spend {
  const base = s.week === weekOf(now) ? s : freshSpend(now);
  const usd = priceOf(model, inTok, outTok, now);
  const m = base.byModel[model] ?? { usd: 0, calls: 0, in: 0, out: 0 };
  return { ...base, usd: base.usd + usd, calls: base.calls + 1, byModel: { ...base.byModel, [model]: { usd: m.usd + usd, calls: m.calls + 1, in: m.in + inTok, out: m.out + outTok } } };
}

/** Which model answers this ask, given what's been spent. Null: the rules decide alone. */
export function pick(tier: Tier, spend: Spend, now = Date.now()): ModelSpec | null {
  const t = tiers();
  const k = keys();
  const used = (spend.week === weekOf(now) ? spend.usd : 0) / weeklyCap();
  const has = (m: ModelSpec) => !!(m.provider === "anthropic" ? k.anthropic : k.google);
  if (used >= 1) return null;
  if (tier === "shadow") return used < 0.7 && has(t.shadow) ? t.shadow : null;
  if (tier === "coach") return used < 0.85 && has(t.coach) ? t.coach : null;
  if (tier === "entry") {
    if (used >= 0.9) return has(t.manage) ? t.manage : null;
    return has(t.entry) ? t.entry : null;
  }
  return has(t.manage) ? t.manage : null;
}

/* ------------------------------------------------------------------ */
/* asking                                                              */
/* ------------------------------------------------------------------ */

export const SYSTEM = `You help a small futures prop account follow a trader named Yazan. He has a large cushion above his firm's floor and can sit through big swings; our account has much less room, so we can't simply copy him. You are shown one of his trades as it stands right now, measured by code, and you choose one move from the menu.

What you know about Yazan: he trades NQ, the Dow (US30) and sometimes Gold. He places his stop and his targets when he enters and leaves them: half comes off at his first target, the rest at his second. He holds his stop where he set it.

How to think:
- Entering: the point of watching is to learn from how the trade behaves in its first minutes. Going in early catches fast winners; waiting for a dip to turn back gets a better price; resting an order below the market tends to fill on trades that are failing. Pass when what's left to his target is poor against our stop, or the trade is failing.
- Managing: we exit at his targets and when he exits. Only tighten the stop or take profit early when the trade has clearly stalled or turned; a tighter stop must sit between our stop and the price, never wider.
- Protecting the account matters more than any one trade, more so the less room is left above the stop line.

Answer only with the decide tool. Keep the reason to one plain sentence a trader would say, no jargon, under 25 words, no em dashes.`;

export const MENU: Record<Ask["kind"], string[]> = { entry: ["enter_now", "limit", "wait", "pass"], manage: ["hold", "tighten", "take_half", "exit"] };

export type Decision = { action: string; price?: number; reason: string };
export type CallResult = { ok: true; decision: Decision; model: string; label: string; inTok: number; outTok: number; usd: number; ms: number } | { ok: false; model: string; label: string; error: string; ms: number; inTok: number; outTok: number; usd: number };

function toolSchema(kind: Ask["kind"]) {
  return {
    type: "object",
    properties: {
      action: { type: "string", enum: MENU[kind] },
      price: { type: "number", description: kind === "entry" ? "Only for limit: the better price to ask for." : "Only for tighten: the new stop price." },
      reason: { type: "string", description: "One plain sentence, under 25 words." },
    },
    required: ["action", "reason"],
  };
}

function question(q: Pick<Ask, "kind" | "brief">) {
  return `${q.kind === "entry" ? "Should we join, and how?" : "We're in. What now?"}\n\n${JSON.stringify(q.brief, null, 1)}`;
}

function clean(kind: Ask["kind"], x: unknown): Decision | null {
  const o = x as { action?: unknown; price?: unknown; reason?: unknown } | null;
  if (!o || typeof o.action !== "string" || !MENU[kind].includes(o.action)) return null;
  return { action: o.action, price: typeof o.price === "number" && Number.isFinite(o.price) ? o.price : undefined, reason: String(o.reason ?? "").replace(/\s*—\s*/g, ", ").slice(0, 240) };
}

/** The first JSON object in some text, for answers that came back as words rather than a tool call. */
function jsonIn(text: string): unknown {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fn(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

type Usage = { inTok: number; outTok: number };

async function anthropic(m: ModelSpec, body: Record<string, unknown>): Promise<{ j: Record<string, unknown>; usage: Usage }> {
  const r = await withTimeout(m.timeout, (signal) =>
    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", "x-api-key": keys().anthropic, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: m.id, max_tokens: m.maxTokens, ...(m.effort ? { output_config: { effort: m.effort } } : {}), ...body }),
    }),
  );
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown> & { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number }; error?: { message?: string } };
  if (!r.ok) throw new Error(`${r.status} ${j.error?.message ?? ""}`.trim());
  return { j, usage: { inTok: (j.usage?.input_tokens ?? 0) + (j.usage?.cache_read_input_tokens ?? 0), outTok: j.usage?.output_tokens ?? 0 } };
}

async function google(m: ModelSpec, system: string, user: string, schema?: object): Promise<{ text: string; usage: Usage }> {
  const r = await withTimeout(m.timeout, (signal) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m.id}:generateContent`, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", "x-goog-api-key": keys().google },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          maxOutputTokens: m.maxTokens,
          ...(m.effort ? { thinkingConfig: { thinkingLevel: m.effort === "max" || m.effort === "xhigh" ? "HIGH" : m.effort.toUpperCase() } } : {}),
          ...(schema ? { responseMimeType: "application/json", responseSchema: schema } : {}),
        },
      }),
    }),
  );
  const j = (await r.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
    error?: { message?: string };
  };
  if (!r.ok) throw new Error(`${r.status} ${j.error?.message ?? ""}`.trim());
  const text = (j.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
  const u = j.usageMetadata ?? {};
  return { text, usage: { inTok: u.promptTokenCount ?? 0, outTok: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) } };
}

/** One decision from one model. Never throws. */
export async function decide(m: ModelSpec, q: Pick<Ask, "kind" | "brief">): Promise<CallResult> {
  const t0 = Date.now();
  const base = { model: m.id, label: m.label };
  let usage: Usage = { inTok: 0, outTok: 0 };
  try {
    let raw: unknown = null;
    if (m.provider === "anthropic") {
      // forcing the tool only works without thinking; the bigger models think, so they're asked nicely
      const thinks = m.effort !== "low";
      const out = await anthropic(m, {
        system: SYSTEM,
        tools: [{ name: "decide", description: q.kind === "entry" ? "Choose how to join his trade right now." : "Choose what to do with our open trade right now.", input_schema: toolSchema(q.kind) }],
        tool_choice: thinks ? { type: "auto" } : { type: "tool", name: "decide" },
        ...(thinks ? {} : { thinking: { type: "disabled" } }),
        messages: [{ role: "user", content: question(q) }],
      });
      usage = out.usage;
      const content = (out.j.content ?? []) as { type: string; name?: string; input?: unknown; text?: string }[];
      raw = content.find((c) => c.type === "tool_use" && c.name === "decide")?.input ?? jsonIn(content.filter((c) => c.type === "text").map((c) => c.text).join("\n"));
    } else {
      const out = await google(m, SYSTEM.replace("Answer only with the decide tool.", "Answer only with the JSON object asked for."), question(q), toolSchema(q.kind));
      usage = out.usage;
      raw = jsonIn(out.text);
    }
    const d = clean(q.kind, raw);
    const usd = priceOf(m.id, usage.inTok, usage.outTok);
    if (!d) return { ok: false, ...base, error: "No decision in the answer", ms: Date.now() - t0, ...usage, usd };
    return { ok: true, ...base, decision: d, ms: Date.now() - t0, ...usage, usd };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? "Timed out" : e.message) : "Failed";
    return { ok: false, ...base, error: msg.slice(0, 200), ms: Date.now() - t0, ...usage, usd: priceOf(m.id, usage.inTok, usage.outTok) };
  }
}

/* ------------------------------------------------------------------ */
/* the coach                                                           */
/* ------------------------------------------------------------------ */

export const COACH = `You review one trading session of an automated account that follows a trader named Yazan on a futures prop-firm account. You are given the day's numbers, every one of his trades, what our account did with each, every decision the agent made and why, and how the models' advice compared.

Write a short review for the account's owner, who will read it on his phone after a night shift. Plain, direct, no hype, no em dashes. Use these headings exactly: "The day", "What went right", "What cost us", "One change to consider". Under each, two to four short sentences or bullets. In "One change to consider", name one specific setting (by its name in the data) and the value you'd try, or say nothing should change. Base every claim on the data; if a day is too thin to judge, say so.`;

export type CoachResult = { ok: true; text: string; model: string; label: string; usd: number; ms: number; inTok: number; outTok: number } | { ok: false; model: string; label: string; error: string; usd: number; ms: number; inTok: number; outTok: number };

export async function coach(m: ModelSpec, data: unknown): Promise<CoachResult> {
  const t0 = Date.now();
  const base = { model: m.id, label: m.label };
  try {
    const out = await anthropic(m, { system: COACH, messages: [{ role: "user", content: JSON.stringify(data, null, 1) }] });
    const content = (out.j.content ?? []) as { type: string; text?: string }[];
    const text = content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n").replace(/\s*—\s*/g, ", ").trim();
    const usd = priceOf(m.id, out.usage.inTok, out.usage.outTok);
    if (!text) return { ok: false, ...base, error: "Empty review", usd, ms: Date.now() - t0, ...out.usage };
    return { ok: true, ...base, text, usd, ms: Date.now() - t0, ...out.usage };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? "Timed out" : e.message) : "Failed";
    return { ok: false, ...base, error: msg.slice(0, 200), usd: 0, ms: Date.now() - t0, inTok: 0, outTok: 0 };
  }
}

/* ------------------------------------------------------------------ */
/* Discord                                                             */
/* ------------------------------------------------------------------ */

const COLOR: Record<string, number> = { stopline: 0xff2ec4, summary: 0x4da3ff, passed: 0x3ccf7f, info: 0x8a8f98, review: 0x9b7bff };

export async function discord(hook: string, a: { kind: string; title: string; lines: string[] }): Promise<boolean> {
  if (!hook) return false;
  const title = a.title.slice(0, 240);
  const lines = a.lines.map((x) => String(x).slice(0, 1000)).slice(0, 20);
  const r = await fetch(hook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "Altron",
      content: a.kind === "stopline" ? "@here Trading stopped" : undefined,
      allowed_mentions: { parse: a.kind === "stopline" ? ["everyone"] : [] },
      embeds: [{ title, description: lines.join("\n").slice(0, 4000), color: COLOR[a.kind] ?? COLOR.info, timestamp: new Date().toISOString(), footer: { text: "Altron · Follow (paper)" } }],
    }),
  }).catch(() => null);
  return !!r?.ok;
}
