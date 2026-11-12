"use client";

import { unstable_rethrow } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { createWorker } from "./actions";

export const inputClass =
  "h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 text-base text-zinc-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20";
export const primaryButtonClass =
  "h-11 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60";
export const UNEXPECTED_ERROR = "İşlem tamamlanamadı, tekrar deneyin";

export function AddPersonForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; password: string } | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const fullName = String(data.get("fullName") ?? "");
    const phone = String(data.get("phone") ?? "");

    setError(null);
    setCreated(null);
    startTransition(async () => {
      try {
        const result = await createWorker({ fullName, phone });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        form.reset();
        setCreated({ name: fullName.trim(), password: result.password ?? "" });
      } catch (e) {
        unstable_rethrow(e); // a redirect from requireRole (signed out, deactivated) navigates
        setError(UNEXPECTED_ERROR);
      }
    });
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-base font-semibold text-zinc-900">Kişi ekle</h2>
      <form onSubmit={onSubmit} className="flex flex-col gap-3 md:flex-row md:items-end">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-sm font-medium text-zinc-700">Ad soyad</span>
          <input name="fullName" autoComplete="off" required className={inputClass} />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-sm font-medium text-zinc-700">Telefon</span>
          <input
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="0532 123 45 67"
            required
            className={inputClass}
          />
        </label>
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? "Ekleniyor…" : "Ekle"}
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {created && (
        <div className="mt-3">
          <PasswordNotice
            title={`${created.name} eklendi. Giriş şifresi:`}
            password={created.password}
            onClose={() => setCreated(null)}
          />
        </div>
      )}
    </section>
  );
}

/** Shows a generated password once, with a copy button. */
export function PasswordNotice({
  title,
  password,
  onClose,
}: {
  title: string;
  password: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      // Clipboard API unavailable (e.g. insecure context): the password stays selectable.
      setCopied(false);
    }
  }

  return (
    <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3">
      <p className="text-sm text-zinc-800">{title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code
          data-testid="generated-password"
          className="select-all rounded-md bg-white px-3 py-2 font-mono text-lg tracking-widest text-zinc-900 ring-1 ring-zinc-300"
        >
          {password}
        </code>
        <button
          type="button"
          onClick={copy}
          className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-100"
        >
          {copied ? "Kopyalandı" : "Kopyala"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="h-10 rounded-lg px-3 text-sm font-medium text-zinc-600 hover:bg-amber-100"
        >
          Tamam
        </button>
      </div>
      <p className="mt-2 text-sm font-medium text-amber-800">
        Bu şifre tekrar gösterilmez. Kişiye şimdi iletin.
      </p>
    </div>
  );
}
