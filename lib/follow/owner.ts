import { supabaseReady } from "@/lib/supabase/env";
import { roleOf, serverClient } from "@/lib/supabase/server";

/** Only the owner reaches the follow routes: they spend his AI credit and post to his Discord. */
export async function isOwner(): Promise<boolean> {
  if (process.env.ALTRON_AUTH_OFF === "1" && process.env.VERCEL !== "1") return true;
  if (!supabaseReady()) return false;
  const supabase = await serverClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  return (await roleOf(supabase, user.id)) === "owner";
}
