import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { HOME, safeNext, supabaseReady } from "@/lib/supabase/env";
import { roleOf, serverClient } from "@/lib/supabase/server";

/** Where the sign-in email's link lands: start the session, then go where this person belongs. */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const fail = (why: string) => NextResponse.redirect(new URL(`/login?why=${why}`, url.origin));
  if (!supabaseReady()) return fail("setup");

  const supabase = await serverClient();
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const { error } = code ? await supabase.auth.exchangeCodeForSession(code) : tokenHash && type ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type }) : { error: new Error("no code") };
  if (error) return fail("link");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("link");
  const role = (await roleOf(supabase, user.id)) ?? "member";
  const next = safeNext(url.searchParams.get("next"));
  // the owner's pages only for the owner, whatever the link asked for
  const dest = next && (!next.startsWith("/owner") || role === "owner") ? next : HOME[role];
  return NextResponse.redirect(new URL(dest, url.origin));
}
