import { cache } from "react";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Profile, Role } from "@/lib/types";

/** Landing page for each role. */
export function homeFor(role: Role): "/yonetim" | "/gorevim" {
  return role === "admin" ? "/yonetim" : "/gorevim";
}

export type SessionState =
  | { status: "signed-out" }
  | { status: "inactive" }
  | { status: "no-profile" }
  | { status: "ok"; profile: Profile };

/**
 * Works out who the signed-in user of `supabase` is.
 * An inactive user cannot read even their own profile under RLS, so a missing row is
 * disambiguated with `is_active_user()` and, if that is false, a service-role existence check.
 */
export async function loadSessionState(supabase: SupabaseClient): Promise<SessionState> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "signed-out" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, phone, role, active, created_at")
    .eq("id", user.id)
    .maybeSingle<Profile>();
  if (profile?.active) return { status: "ok", profile };

  const { data: active } = await supabase.rpc("is_active_user");
  if (active === true) return { status: "no-profile" }; // active but unreadable: should not happen

  // Lazy import keeps the service-role module out of anything that only needs homeFor().
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { data: row } = await createAdminClient()
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  return row ? { status: "inactive" } : { status: "no-profile" };
}

const currentSessionState = cache(async (): Promise<SessionState> => {
  return loadSessionState(await createClient());
});

/** Profile of the signed-in, active user; null if there is no session or no usable profile. */
export async function getSessionProfile(): Promise<Profile | null> {
  const state = await currentSessionState();
  return state.status === "ok" ? state.profile : null;
}

/**
 * Guards a role's pages. No session -> /giris; inactive -> signs out, /giris?hata=pasif;
 * no profile -> signs out, /giris; other role -> that role's home page.
 */
export async function requireRole(role: Role): Promise<Profile> {
  const state = await currentSessionState();

  switch (state.status) {
    case "signed-out":
      redirect("/giris");
    case "inactive":
      await signOutQuietly();
      redirect("/giris?hata=pasif");
    case "no-profile":
      await signOutQuietly();
      redirect("/giris");
    case "ok":
      if (state.profile.role !== role) redirect(homeFor(state.profile.role));
      return state.profile;
  }
}

/**
 * Revokes the session on the auth server. When called during rendering the cookies
 * cannot be cleared, but the refresh token is dead, so the session ends at token expiry.
 */
async function signOutQuietly() {
  const supabase = await createClient();
  await supabase.auth.signOut().catch(() => undefined);
}
