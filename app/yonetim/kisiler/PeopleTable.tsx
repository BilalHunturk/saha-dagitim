"use client";

import { unstable_rethrow } from "next/navigation";
import { useMemo, useState, useTransition, type FormEvent } from "react";
import { formatPhone } from "@/lib/phone";
import type { ActionResult } from "@/lib/people";
import { inputClass, PasswordNotice, primaryButtonClass, UNEXPECTED_ERROR } from "./AddPersonForm";
import { resetWorkerPassword, setWorkerActive, updateWorker } from "./actions";

export type WorkerRow = {
  id: string;
  fullName: string;
  phone: string; // E.164
  active: boolean;
  zoneCount: number;
};

type Mode =
  | { kind: "idle" }
  | { kind: "edit"; id: string }
  | { kind: "confirm-deactivate"; id: string }
  | { kind: "confirm-reset"; id: string };

const COLUMNS = "md:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_5rem_5.5rem_minmax(0,2.4fr)]";
const smallButton =
  "h-9 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-100 disabled:opacity-60";
const dangerButton =
  "h-9 rounded-lg bg-red-600 px-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60";

/** Case- and diacritic-insensitive Turkish search key. */
function searchKey(value: string): string {
  return value
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i");
}

export function PeopleTable({ workers }: { workers: WorkerRow[] }) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [revealed, setRevealed] = useState<{ id: string; password: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const visible = useMemo(() => {
    const q = searchKey(query.trim());
    const digits = query.replace(/\D/g, "");
    if (!q) return workers;
    return workers.filter(
      (w) =>
        searchKey(w.fullName).includes(q) ||
        (digits.length > 0 && (w.phone.includes(digits) || formatPhone(w.phone).replace(/\D/g, "").includes(digits))),
    );
  }, [workers, query]);

  function run(id: string, action: () => Promise<ActionResult>, onSuccess?: (r: ActionResult & { ok: true }) => void) {
    setRowError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          setRowError({ id, message: result.error });
          return;
        }
        setMode({ kind: "idle" });
        onSuccess?.(result);
      } catch (e) {
        unstable_rethrow(e); // a redirect from requireRole (signed out, deactivated) navigates
        setRowError({ id, message: UNEXPECTED_ERROR });
      }
    });
  }

  function onEditSubmit(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const fullName = String(data.get("fullName") ?? "");
    const phone = String(data.get("phone") ?? "");
    run(id, () => updateWorker({ id, fullName, phone }));
  }

  if (workers.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-600">
        Henüz kişi eklenmedi.
      </p>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 md:max-w-sm">
        <span className="sr-only">Kişi ara</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ad veya telefonla ara"
          className={inputClass}
        />
      </label>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
        <div
          className={`hidden gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 md:grid ${COLUMNS}`}
        >
          <span>Ad soyad</span>
          <span>Telefon</span>
          <span>Durum</span>
          <span>Aktif bölge</span>
          <span className="text-right">İşlemler</span>
        </div>

        {visible.length === 0 && <p className="px-4 py-6 text-center text-sm text-zinc-600">Sonuç yok.</p>}

        <ul className="divide-y divide-zinc-200">
          {visible.map((w) => {
            const editing = mode.kind === "edit" && mode.id === w.id;
            const confirmingDeactivate = mode.kind === "confirm-deactivate" && mode.id === w.id;
            const confirmingReset = mode.kind === "confirm-reset" && mode.id === w.id;
            const error = rowError?.id === w.id ? rowError.message : null;

            return (
              <li key={w.id} data-worker-id={w.id} className={`px-4 py-3 ${w.active ? "" : "bg-zinc-50"}`}>
                {editing ? (
                  <form
                    onSubmit={(e) => onEditSubmit(e, w.id)}
                    className="flex flex-col gap-2 md:flex-row md:items-end"
                  >
                    <label className="flex flex-1 flex-col gap-1">
                      <span className="text-sm font-medium text-zinc-700">Ad soyad</span>
                      <input name="fullName" defaultValue={w.fullName} required className={inputClass} />
                    </label>
                    <label className="flex flex-1 flex-col gap-1">
                      <span className="text-sm font-medium text-zinc-700">Telefon</span>
                      <input
                        name="phone"
                        type="tel"
                        inputMode="tel"
                        defaultValue={formatPhone(w.phone)}
                        required
                        className={inputClass}
                      />
                    </label>
                    <div className="flex gap-2">
                      <button type="submit" disabled={pending} className={primaryButtonClass}>
                        {pending ? "Kaydediliyor…" : "Kaydet"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMode({ kind: "idle" });
                          setRowError(null);
                        }}
                        className="h-11 rounded-lg px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
                      >
                        Vazgeç
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className={`grid gap-x-3 gap-y-1 md:items-center ${COLUMNS}`}>
                    <span className={`font-medium ${w.active ? "text-zinc-900" : "text-zinc-500"}`}>
                      {w.fullName}
                    </span>
                    <a href={`tel:${w.phone}`} className="text-sm text-zinc-700 tabular-nums md:text-base">
                      {formatPhone(w.phone)}
                    </a>
                    <span className="flex items-center gap-2 text-sm md:block">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                          w.active ? "bg-emerald-100 text-emerald-800" : "bg-zinc-200 text-zinc-700"
                        }`}
                      >
                        {w.active ? "Aktif" : "Pasif"}
                      </span>
                      <span className="text-zinc-600 md:hidden">{w.zoneCount} aktif bölge</span>
                    </span>
                    <span className="hidden text-sm text-zinc-700 tabular-nums md:block">{w.zoneCount}</span>
                    <div className="mt-2 flex flex-wrap gap-2 md:mt-0 md:justify-end">
                      <button
                        type="button"
                        className={smallButton}
                        onClick={() => {
                          setRowError(null);
                          setMode({ kind: "edit", id: w.id });
                        }}
                      >
                        Düzenle
                      </button>
                      <button
                        type="button"
                        className={smallButton}
                        onClick={() => {
                          setRowError(null);
                          setMode({ kind: "confirm-reset", id: w.id });
                        }}
                      >
                        Şifre yenile
                      </button>
                      {w.active ? (
                        <button
                          type="button"
                          className={smallButton}
                          onClick={() => {
                            setRowError(null);
                            setMode({ kind: "confirm-deactivate", id: w.id });
                          }}
                        >
                          Pasifleştir
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={pending}
                          className={smallButton}
                          onClick={() => run(w.id, () => setWorkerActive({ id: w.id, active: true }))}
                        >
                          Aktifleştir
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {confirmingDeactivate && (
                  <Confirm
                    message={
                      w.zoneCount > 0
                        ? `Bu kişi pasifleştirilecek ve ${w.zoneCount} bölgedeki görevi kaldırılacak.`
                        : "Bu kişi pasifleştirilecek."
                    }
                    confirmLabel="Pasifleştir"
                    pending={pending}
                    onConfirm={() => run(w.id, () => setWorkerActive({ id: w.id, active: false }))}
                    onCancel={() => setMode({ kind: "idle" })}
                  />
                )}

                {confirmingReset && (
                  <Confirm
                    message="Yeni şifre üretilecek; eski şifre artık çalışmayacak."
                    confirmLabel="Şifreyi yenile"
                    pending={pending}
                    onConfirm={() =>
                      run(
                        w.id,
                        () => resetWorkerPassword({ id: w.id }),
                        (r) => setRevealed({ id: w.id, password: r.password ?? "" }),
                      )
                    }
                    onCancel={() => setMode({ kind: "idle" })}
                  />
                )}

                {revealed?.id === w.id && (
                  <div className="mt-3">
                    <PasswordNotice
                      title={`${w.fullName} için yeni şifre:`}
                      password={revealed.password}
                      onClose={() => setRevealed(null)}
                    />
                  </div>
                )}

                {error && (
                  <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function Confirm({
  message,
  confirmLabel,
  pending,
  onConfirm,
  onCancel,
}: {
  message: string;
  confirmLabel: string;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-label={confirmLabel}
      className="mt-3 flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-3 md:flex-row md:items-center"
    >
      <p className="flex-1 text-sm text-red-900">{message}</p>
      <div className="flex gap-2">
        <button type="button" disabled={pending} onClick={onConfirm} className={dangerButton}>
          {pending ? "Bekleyin…" : confirmLabel}
        </button>
        <button type="button" onClick={onCancel} className={smallButton}>
          Vazgeç
        </button>
      </div>
    </div>
  );
}
