"use client";

import { useActionState } from "react";
import { login } from "./actions";

export function LoginForm({ initialError }: { initialError?: string }) {
  const [state, formAction, pending] = useActionState(login, { error: initialError });

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
