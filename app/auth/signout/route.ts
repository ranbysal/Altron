import { NextResponse, type NextRequest } from "next/server";
import { supabaseReady } from "@/lib/supabase/env";
import { serverClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  if (supabaseReady()) {
    const supabase = await serverClient();
    await supabase.auth.signOut();
  }
  return NextResponse.redirect(new URL("/login?why=out", req.nextUrl.origin), { status: 303 });
}
