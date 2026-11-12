import { NextResponse, type NextRequest } from "next/server";
import { HOME, safeNext, supabaseReady } from "@/lib/supabase/env";
import { roleOf, serverClient } from "@/lib/supabase/server";

/** Signed in: go where this person belongs, or where they were headed if it's theirs to open. */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  if (!supabaseReady()) return NextResponse.redirect(new URL("/login?why=setup", url.origin));
  const supabase = await serverClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", url.origin));
  const role = await roleOf(supabase, user.id);
  if (!role) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?why=invite", url.origin));
  }
  const next = safeNext(url.searchParams.get("next"));
  const dest = next && !next.startsWith("/login") && (!next.startsWith("/owner") || role === "owner") ? next : HOME[role];
  return NextResponse.redirect(new URL(dest, url.origin));
}
