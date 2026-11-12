"use client";

import { formatClock } from "@/lib/worker-refresh";
import { useWorkerRefresh } from "./useWorkerRefresh";

/** "Son güncelleme: HH:MM" (when the server read the data shown), plus "Bağlantı yok" if the last try failed. */
export function LastUpdated({ fetchedAt, offline }: { fetchedAt: string; offline: boolean }) {
  return (
    <p className="text-xs text-zinc-500">
      Son güncelleme: <time dateTime={fetchedAt}>{formatClock(fetchedAt)}</time>
      {offline && <span className="font-medium text-amber-700"> · Bağlantı yok</span>}
    </p>
  );
}

export function RefreshButton({ onClick, pending }: { onClick: () => void; pending: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="min-h-11 min-w-11 px-2 text-sm font-medium text-blue-700 disabled:opacity-60"
    >
      {pending ? "Yenileniyor…" : "Yenile"}
    </button>
  );
}

/** The no-assignment screen; it refreshes too, so a new assignment shows up by itself. */
export function NoAssignments({ fetchedAt }: { fetchedAt: string }) {
  const { refresh, pending, offline } = useWorkerRefresh();
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="max-w-xs text-base text-zinc-700">Henüz görev atanmadı. Yöneticinizle iletişime geçin.</p>
      <LastUpdated fetchedAt={fetchedAt} offline={offline} />
      <RefreshButton onClick={refresh} pending={pending} />
    </main>
  );
}
