import { pooled, timeline } from "@/lib/watch/x";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Recent posts from the accounts the Watcher follows: /api/watch/voices?h=handle,handle */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("h") ?? "";
  const handles = [...new Set(raw.split(",").map((x) => x.trim().replace(/^@/, "")))].filter((x) => /^[A-Za-z0-9_]{1,15}$/.test(x)).slice(0, 30);
  const results = await pooled(handles, 4, timeline);
  const posts = results
    .flatMap((r) => r.posts)
    .sort((a, b) => b.at - a.at)
    .slice(0, 160);
  return Response.json(
    { at: Date.now(), accounts: results.map((r) => ({ handle: r.handle, name: r.name, ok: r.ok, why: r.why, at: r.at, n: r.posts.length })), posts },
    { headers: { "cache-control": "no-store" } },
  );
}
