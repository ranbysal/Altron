import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/*
 * The owner's pages open only for a signed-in owner. Everyone else is sent to sign in,
 * or told the account can't open them. Yazan's pages and Community stay open until
 * his sign-in exists.
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

  const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (data?.role !== "owner") return toLogin(req, "owner");
  return res;
}

export const config = {
  matcher: ["/owner", "/owner/:path*"],
};
