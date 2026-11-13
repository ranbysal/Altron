import { NextResponse } from "next/server";
import { isOwner } from "@/lib/follow/owner";

/*
 * Alerts to the owner's phone, through a Discord webhook (the Discord app pushes them). The
 * webhook stays on the server: set DISCORD_WEBHOOK_URL in Vercel. Without it, alerts are kept
 * on the Follow page only.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOOK = process.env.DISCORD_WEBHOOK_URL ?? "";
const COLOR: Record<string, number> = { stopline: 0xff2ec4, summary: 0x4da3ff, passed: 0x3ccf7f, info: 0x8a8f98 };

export async function GET() {
  if (!(await isOwner())) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  return NextResponse.json({ discord: !!HOOK });
}

export async function POST(req: Request) {
  if (!(await isOwner())) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  if (!HOOK) return NextResponse.json({ sent: false, why: "No Discord webhook set" });
  let a: { kind?: string; title?: string; lines?: string[] };
  try {
    a = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const title = String(a.title ?? "").slice(0, 240);
  if (!title) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const lines = (Array.isArray(a.lines) ? a.lines : []).map((x) => String(x).slice(0, 400)).slice(0, 10);
  const r = await fetch(HOOK, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "Altron",
      // the stop line pings; summaries arrive quietly
      content: a.kind === "stopline" ? "@here Trading stopped" : undefined,
      allowed_mentions: { parse: a.kind === "stopline" ? ["everyone"] : [] },
      embeds: [{ title, description: lines.join("\n"), color: COLOR[a.kind ?? "info"] ?? COLOR.info, timestamp: new Date().toISOString(), footer: { text: "Altron · Follow (paper)" } }],
    }),
  }).catch(() => null);
  return NextResponse.json({ sent: !!r?.ok });
}
