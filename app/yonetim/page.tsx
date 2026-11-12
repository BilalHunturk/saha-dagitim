import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Assignment, Profile, Zone } from "@/lib/types";
import { AdminBoard } from "./AdminBoard";

export default async function AdminHomePage() {
  await requireRole("admin");
  const supabase = await createClient();

  const [zones, people, assignments] = await Promise.all([
    supabase
      .from("zones_geojson")
      .select("id, name, color, note, geojson, active_count")
      .order("name")
      .overrideTypes<Zone[], { merge: false }>(),
    supabase
      .from("profiles")
      .select("id, full_name, phone, role, active, created_at")
      .eq("role", "worker")
      .order("full_name")
      .overrideTypes<Profile[], { merge: false }>(),
    supabase
      .from("assignments")
      .select("id, zone_id, worker_id, started_at, ended_at")
      .is("ended_at", null)
      .overrideTypes<Assignment[], { merge: false }>(),
  ]);

  const error = zones.error ?? people.error ?? assignments.error;
  if (error) throw new Error(`Harita verisi yüklenemedi: ${error.message}`);

  return <AdminBoard zones={zones.data ?? []} people={people.data ?? []} assignments={assignments.data ?? []} />;
}
