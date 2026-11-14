import { admin } from "./persist";

/*
 * Who's asking. Browsers send their Supabase access token; the worker checks it with Supabase
 * and reads the role from `profiles`, the same table the site's own pages trust.
 */

export type Role = "member" | "trader" | "owner";
export type Who = { id: string; role: Role };

const OFF = process.env.WORKER_AUTH_OFF === "1" && process.env.RAILWAY_ENVIRONMENT === undefined;
const cache = new Map<string, { who: Who | null; until: number }>();

export async function whoIs(token: string | null | undefined): Promise<Who | null> {
  if (OFF) return { id: "local", role: "owner" };
  if (!token) return null;
  const hit = cache.get(token);
  if (hit && hit.until > Date.now()) return hit.who;
  const a = admin();
  if (!a) return null;
  let who: Who | null = null;
  try {
    const { data } = await a.auth.getUser(token);
    const user = data.user;
    if (user) {
      const { data: p } = await a.from("profiles").select("role, revoked_at").eq("id", user.id).maybeSingle();
      if (p && !p.revoked_at && ["member", "trader", "owner"].includes(p.role)) who = { id: user.id, role: p.role as Role };
    }
  } catch {
    who = null;
  }
  // a refused token is re-checked sooner than an accepted one
  cache.set(token, { who, until: Date.now() + (who ? 5 * 60_000 : 20_000) });
  if (cache.size > 500) for (const [k, v] of cache) if (v.until < Date.now()) cache.delete(k);
  return who;
}

export const canTrade = (who: Who | null, seat: "trader" | "owner") => !!who && (seat === "owner" ? who.role === "owner" : who.role === "trader" || who.role === "owner");
export const canSee = (who: Who | null, seat: "trader" | "owner") => !!who && (seat === "owner" ? who.role === "owner" : true);
