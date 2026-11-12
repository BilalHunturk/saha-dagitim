"use client";

import { useActionState } from "react";
import { LOGIN_MESSAGES, parseLoginForm, signInErrorMessage } from "@/lib/login";
import { createClient } from "@/lib/supabase/client";
import { completeLogin } from "./actions";

type LoginState = { error?: string };

/**
 * Signs in from the browser, so the auth server rate-limits by the user's own IP rather
 * than the app server's. The browser client stores the session in cookies; completeLogin
 * then checks the profile on the server and redirects by role.
 */
async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = parseLoginForm(
    String(formData.get("phone") ?? ""),
    String(formData.get("password") ?? ""),
  );
  if ("error" in parsed) return parsed;

  try {
    const { error } = await createClient().auth.signInWithPassword(parsed);
    if (error) return { error: signInErrorMessage(error) };
  } catch {
    return { error: LOGIN_MESSAGES.CONNECTION };
  }

  return completeLogin();
}

export function LoginForm({ initialError }: { initialError?: string }) {
  const [state, formAction, pending] = useActionState(signIn, { error: initialError });

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-zinc-700">Telefon</span>
        <input
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="0532 123 45 67"
          required
          className="h-12 rounded-lg border border-zinc-300 bg-white px-3 text-base text-zinc-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-zinc-700">Şifre</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-12 rounded-lg border border-zinc-300 bg-white px-3 text-base text-zinc-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
        />
      </label>

      {state.error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="h-12 rounded-lg bg-blue-600 text-base font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
      >
        {pending ? "Giriş yapılıyor…" : "Giriş yap"}
      </button>
    </form>
  );
}
