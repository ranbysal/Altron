/** The project's public address and key. Both are safe in the browser; row level security guards the data. */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const supabaseReady = () => !!SUPABASE_URL && !!SUPABASE_KEY;

export type Role = "member" | "trader" | "owner";

/** Where each role lands after signing in. */
export const HOME: Record<Role, string> = { owner: "/owner", trader: "/trader", member: "/community" };

/** Only paths on this site, never another origin. */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  return next;
}
