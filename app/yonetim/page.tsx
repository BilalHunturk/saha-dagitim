import { requireRole } from "@/lib/auth";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { createClient } from "@/lib/supabase/server";
import type { Assignment, Profile, Zone } from "@/lib/types";
import { AdminBoard } from "./AdminBoard";

export default async function AdminHomePage() {
  await requireRole("admin");
  const supabase = await createClient();

  // PostgREST caps each response at 1000 rows, so every list is read page by page.
  // Each order ends on the unique `id`, so the pages are stable.
  const [zones, people, assignments] = await Promise.all([
    fetchAll((from, to) =>
      supabase
        .from("zones_geojson")
        .select("id, name, color, note, geojson, active_count")
        .order("name")
        .order("id")
        .range(from, to)
        .overrideTypes<Zone[], { merge: false }>(),
    ),
    fetchAll((from, to) =>
      supabase
        .from("profiles")
        .select("id, full_name, phone, role, active, created_at")
        .eq("role", "worker")
        .order("full_name")
        .order("id")
        .range(from, to)
        .overrideTypes<Profile[], { merge: false }>(),
    ),
    fetchAll((from, to) =>
      supabase
        .from("assignments")
        .select("id, zone_id, worker_id, started_at, ended_at")
        .is("ended_at", null)
        .order("id")
        .range(from, to)
        .overrideTypes<Assignment[], { merge: false }>(),
    ),
  ]);

  const error = zones.error ?? people.error ?? assignments.error;
  if (error) throw new Error(`Harita verisi yüklenemedi: ${error.message}`);

  return <AdminBoard zones={zones.data} people={people.data} assignments={assignments.data} />;
}
