"use client";

import { create } from "zustand";
import { browserClient } from "@/lib/supabase/client";
import { supabaseReady, type Role } from "@/lib/supabase/env";

/*
 * Who is signed in on this page: their name, picture and role, from their own profile. Rooms
 * speak as this person, and the nav shows their face. With sign-in switched off for local
 * design work, the page's side stands in (the owner's pages are the owner, the rest Yazan).
 */

export type Me = { ready: boolean; id: string | null; name: string; role: Role | null; avatar: string | null };

export const useMe = create<Me>(() => ({ ready: false, id: null, name: "", role: null, avatar: null }));

let started = false;
export function startMe(side: "trader" | "owner") {
  if (typeof window === "undefined") return;
  if (!supabaseReady()) {
    // local design work, no sign-in: the side is the person
    useMe.setState(side === "owner" ? { ready: true, id: "local-owner", name: "Owner", role: "owner", avatar: null } : { ready: true, id: "local-trader", name: "Yazan", role: "trader", avatar: null });
    return;
  }
  if (started) return;
  started = true;
  void (async () => {
    try {
      const sb = browserClient();
      const {
        data: { user },
      } = await sb.auth.getUser();
      if (!user) return useMe.setState({ ready: true });
      const { data } = await sb.from("profiles").select("display_name, avatar_url, role").eq("id", user.id).maybeSingle();
      const meta = (user.user_metadata ?? {}) as { full_name?: string; name?: string; avatar_url?: string; picture?: string };
      const name = (data?.display_name as string | null) || meta.full_name || meta.name || (user.email ?? "").split("@")[0] || "Member";
      useMe.setState({ ready: true, id: user.id, name, role: (data?.role as Role | undefined) ?? "member", avatar: (data?.avatar_url as string | null) || meta.avatar_url || meta.picture || null });
    } catch {
      useMe.setState({ ready: true });
    }
  })();
}

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";
