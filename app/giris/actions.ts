"use server";

import { redirect } from "next/navigation";
import { homeFor, loadSessionState, signOutThisDevice } from "@/lib/auth";
import { LOGIN_MESSAGES } from "@/lib/login";
import { createClient } from "@/lib/supabase/server";

/**
 * Second half of the login. The password sign-in runs in the browser (so the auth server
 * sees the user's own IP); this action then reads the new cookie session and sends the user
 * to their home page. A transient error keeps the session and asks the user to retry.
 */
export async function completeLogin(): Promise<{ error?: string }> {
  const state = await loadSessionState(await createClient());

  switch (state.status) {
    case "ok":
      redirect(homeFor(state.profile.role));
    case "inactive":
      await signOutThisDevice();
      return { error: LOGIN_MESSAGES.INACTIVE };
    case "no-profile":
      await signOutThisDevice();
      return { error: LOGIN_MESSAGES.WRONG_CREDENTIALS };
    case "signed-out":
    case "error":
      return { error: LOGIN_MESSAGES.CONNECTION };
  }
}

export async function logout(): Promise<void> {
  await signOutThisDevice();
  redirect("/giris");
}
