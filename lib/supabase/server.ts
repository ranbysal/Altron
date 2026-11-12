import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_KEY, SUPABASE_URL, type Role } from "./env";

/** A client for route handlers and server components, reading and refreshing the session cookies. */
export async function serverClient() {
  const jar = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => jar.set(name, value, options));
        } catch {
          /* called from a server component: the proxy refreshes the session instead */
        }
      },
    },
  });
}

export async function roleOf(supabase: Awaited<ReturnType<typeof serverClient>>, id: string): Promise<Role | null> {
  const { data } = await supabase.from("profiles").select("role, revoked_at").eq("id", id).maybeSingle();
  if (!data || data.revoked_at) return null;
  return (data.role as Role | undefined) ?? null;
}
