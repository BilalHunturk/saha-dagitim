import { cache } from "react";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOGIN_MESSAGES, isTransientAuthError } from "@/lib/login";
import { createClient } from "@/lib/supabase/server";
import type { Profile, Role } from "@/lib/types";

/** Landing page for each role. */
export function homeFor(role: Role): "/yonetim" | "/gorevim" {
  return role === "admin" ? "/yonetim" : "/gorevim";
}

/**
 * `error` means the answer is unknown (network, PostgREST or auth server trouble). It must
 * never be treated as "no profile" or "inactive", and must never sign the user out.
 */
export type SessionState =
  | { status: "signed-out" }
  | { status: "inactive" }
  | { status: "no-profile" }
  | { status: "error" }
  | { status: "ok"; profile: Profile };

/** Thrown by the guards when the session state is unknown; app/error.tsx offers a retry. */
export class SessionUnavailableError extends Error {
  constructor() {
    super(LOGIN_MESSAGES.CONNECTION);
    this.name = "SessionUnavailableError";
  }
}

/** Does a profile row exist for this user id? Throws when the lookup itself fails. */
export type ProfileExists = (userId: string) => Promise<boolean>;

const profileExistsViaServiceRole: ProfileExists = async (userId) => {
  // Lazy import keeps the service-role module out of anything that only needs homeFor().
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { data, error } = await createAdminClient()
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
};

/**
 * Works out who the signed-in user of `supabase` is.
 * An inactive user cannot read even their own profile under RLS, so a missing row is
 * disambiguated with `is_active_user()` and, if that is false, an existence check
 * (service role by default). Every query error yields `error`, never a guess.
 */
export async function loadSessionState(
  supabase: SupabaseClient,
  profileExists: ProfileExists = profileExistsViaServiceRole,
): Promise<SessionState> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (isTransientAuthError(userError)) return { status: "error" };
  const user = userData?.user;
  if (!user) return { status: "signed-out" };

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, phone, role, active, created_at")
    .eq("id", user.id)
    .maybeSingle<Profile>();
  if (profileError) return { status: "error" };
  if (profile?.active) return { status: "ok", profile };

  const { data: active, error: activeError } = await supabase.rpc("is_active_user");
  if (activeError || active !== false) return { status: "error" }; // true here is inconsistent

  try {
    return (await profileExists(user.id)) ? { status: "inactive" } : { status: "no-profile" };
  } catch {
    return { status: "error" };
  }
}

const currentSessionState = cache(async (): Promise<SessionState> => {
  return loadSessionState(await createClient());
});

/**
 * Profile of the signed-in, active user; null if there is no session or no usable profile.
 * Throws `SessionUnavailableError` when that cannot be determined right now.
 */
export async function getSessionProfile(): Promise<Profile | null> {
  const state = await currentSessionState();
  if (state.status === "error") throw new SessionUnavailableError();
  return state.status === "ok" ? state.profile : null;
}

/**
 * Guards a role's pages. No session -> /giris; inactive -> signs out, /giris?hata=pasif;
 * no profile -> signs out, /giris; other role -> that role's home page;
 * unknown (transient error) -> throws `SessionUnavailableError`, session kept.
 */
export async function requireRole(role: Role): Promise<Profile> {
  const state = await currentSessionState();

  switch (state.status) {
    case "signed-out":
      redirect("/giris");
    case "inactive":
      await signOutThisDevice();
      redirect("/giris?hata=pasif");
    case "no-profile":
      await signOutThisDevice();
      redirect("/giris");
    case "error":
      throw new SessionUnavailableError();
    case "ok":
      if (state.profile.role !== role) redirect(homeFor(state.profile.role));
      return state.profile;
  }
}

/**
 * Ends this device's session only (`scope: "local"`), so other devices stay signed in.
 * When called during rendering the cookies cannot be cleared, but this session's refresh
 * token is revoked, so it ends at access-token expiry.
 */
export async function signOutThisDevice(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
}
