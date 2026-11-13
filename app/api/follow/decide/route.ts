import { NextResponse } from "next/server";
import { isOwner } from "@/lib/follow/owner";
import type { Brief } from "@/lib/follow/engine";

/*
 * The follow agent's judgement. The engine sends a short brief of Yazan's trade as it stands
 * (how far it's moved, how fast, our room, the plan); the model picks one move from a fixed
 * menu and says why in a sentence. The engine checks the answer against its guardrails before
 * anything is sent, and the rules take over whenever this route can't answer.
 *
 * Needs ANTHROPIC_API_KEY. FOLLOW_MODEL picks the model (a fast one: answers are needed in seconds).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY = process.env.ANTHROPIC_API_KEY ?? "";
const MODEL = process.env.FOLLOW_MODEL || "claude-haiku-5-5";

const SYSTEM = `You help a small futures account follow a trader named Yazan. He has a large cushion above his firm's floor and can sit through big swings; our account has much less room, so we can't simply copy him. You are shown one of his trades as it stands right now, measured by code, and you choose one move from the menu.

What you know about Yazan: he trades NQ and the Dow, posts an entry and one or two targets but rarely a stop, holds for hours, often sits through moves well against him before reaching target, and takes half off at his first target.

How to think:
- Entering: the point of watching is to learn from how the trade behaves in its first minutes. Going in early catches fast winners; waiting for a dip to turn back gets a better price; resting an order below the market tends to fill on trades that are failing. Pass when what's left to his target is poor against our stop, or the trade is failing.
- Managing: we exit at his targets and when he exits. Only tighten the stop or take profit early when the trade has clearly stalled or turned; a tighter stop must sit between our stop and the price, never wider.
- Protecting the account matters more than any one trade, more so the less room is left above the stop line.

Answer only with the decide tool. Keep the reason to one plain sentence a trader would say, no jargon, under 25 words, no em dashes.`;

type Kind = "entry" | "manage";
const MENU: Record<Kind, string[]> = { entry: ["enter_now", "limit", "wait", "pass"], manage: ["hold", "tighten", "take_half", "exit"] };

export async function GET() {
  if (!(await isOwner())) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  return NextResponse.json({ ai: !!KEY, model: KEY ? MODEL : null });
}

export async function POST(req: Request) {
  if (!(await isOwner())) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  if (!KEY) return NextResponse.json({ error: "No AI key set" }, { status: 501 });
  let body: { kind?: Kind; brief?: Brief };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const kind = body.kind;
  if (!kind || !(kind in MENU) || !body.brief) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const tool = {
    name: "decide",
    description: kind === "entry" ? "Choose how to join his trade right now." : "Choose what to do with our open trade right now.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: MENU[kind] },
        price: { type: "number", description: kind === "entry" ? "Only for limit: the better price to ask for." : "Only for tighten: the new stop price." },
        reason: { type: "string", description: "One plain sentence, under 25 words." },
      },
      required: ["action", "reason"],
    },
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        system: SYSTEM,
        tools: [tool],
        tool_choice: { type: "tool", name: "decide" },
        messages: [{ role: "user", content: `${kind === "entry" ? "Should we join, and how?" : "We're in. What now?"}\n\n${JSON.stringify(body.brief, null, 1)}` }],
      }),
    });
    if (!r.ok) return NextResponse.json({ error: `AI ${r.status}` }, { status: 502 });
    const j = (await r.json()) as { content?: { type: string; name?: string; input?: { action?: string; price?: number; reason?: string } }[] };
    const use = j.content?.find((c) => c.type === "tool_use" && c.name === "decide")?.input;
    if (!use?.action || !MENU[kind].includes(use.action)) return NextResponse.json({ error: "No decision" }, { status: 502 });
    return NextResponse.json({ action: use.action, price: typeof use.price === "number" ? use.price : undefined, reason: String(use.reason ?? "").slice(0, 240) });
  } catch {
    return NextResponse.json({ error: "AI timed out" }, { status: 504 });
  } finally {
    clearTimeout(timer);
  }
}
