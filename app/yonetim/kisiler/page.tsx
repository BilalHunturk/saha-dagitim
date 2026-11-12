import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AddPersonForm } from "./AddPersonForm";
import { PeopleTable, type WorkerRow } from "./PeopleTable";

export const metadata = { title: "Kişiler · Saha Dağıtım" };

export default async function PeoplePage() {
  await requireRole("admin");
  const supabase = await createClient();

  // Admin RLS: all profiles and assignments are readable. Admin rows are not listed.
  const [{ data: profiles, error }, { data: assignments }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, phone, active")
      .eq("role", "worker")
      .order("full_name"),
    supabase.from("assignments").select("worker_id").is("ended_at", null),
  ]);
  if (error) throw new Error("Kişiler yüklenemedi");

  const zoneCounts = new Map<string, number>();
  for (const a of assignments ?? []) {
    zoneCounts.set(a.worker_id, (zoneCounts.get(a.worker_id) ?? 0) + 1);
  }

  const workers: WorkerRow[] = (profiles ?? [])
    .map((p) => ({
      id: p.id as string,
      fullName: p.full_name as string,
      phone: p.phone as string,
      active: p.active as boolean,
      zoneCount: zoneCounts.get(p.id) ?? 0,
    }))
    // Active people first; the query already sorted by name.
    .sort((a, b) => Number(b.active) - Number(a.active));

  const activeCount = workers.filter((w) => w.active).length;

  // Explicit light surface: the root body follows the OS dark scheme, this UI does not.
  return (
    <div className="flex-1 bg-zinc-50">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-semibold text-zinc-900">Kişiler</h1>
          <p className="text-sm text-zinc-600">
            {workers.length} kişi · {activeCount} aktif
          </p>
        </div>
        <AddPersonForm />
        <PeopleTable workers={workers} />
      </main>
    </div>
  );
}
