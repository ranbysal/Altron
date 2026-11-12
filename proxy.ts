import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/*
 * Who can open what. The owner's pages (and Admin) only for the owner; Yazan's dashboard
 * and desk for the trader (and the owner); Community for anyone with access. Everyone
 * else is sent to sign in, or told this account can't open the page.
 */

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

function toLogin(req: NextRequest, reason?: string) {
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
  if (reason) url.searchParams.set("why", reason);
  return NextResponse.redirect(url);
}

export async function proxy(req: NextRequest) {
  // a switch for local design work only; never set on Vercel
  if (process.env.ALTRON_AUTH_OFF === "1" && process.env.VERCEL !== "1") return NextResponse.next();
  if (!URL_ || !KEY) return toLogin(req, "setup");

  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(URL_, KEY, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return toLogin(req);

  const { data } = await supabase.from("profiles").select("role, revoked_at").eq("id", user.id).maybeSingle();
  if (!data || data.revoked_at) return toLogin(req, "invite");
  const path = req.nextUrl.pathname;
  const role = data.role as string;
  const ok = path.startsWith("/owner") ? role === "owner" : path.startsWith("/trader") ? role === "trader" || role === "owner" : true;
  if (!ok) return toLogin(req, "owner");
  return res;
}

export const config = {
  matcher: ["/owner", "/owner/:path*", "/trader", "/trader/:path*", "/community", "/community/:path*"],
};
