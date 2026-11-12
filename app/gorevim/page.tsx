import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Zone } from "@/lib/types";
import { NoAssignments } from "./RefreshControls";
import { WorkerMap } from "./WorkerMap";

export const metadata: Metadata = { title: "Görevim · Saha Dağıtım" };

/** When this render read the data (shown as "Son güncelleme"). */
function readTime(): string {
  return new Date().toISOString();
}

/**
 * The signed-in worker's zones. The layout also checks the role; checking here too (cached, no
 * extra query) keeps an admin session from running the query before the layout redirects.
 * The client re-renders this page in place (router.refresh) to pick up assignment changes.
 */
export default async function WorkerHomePage() {
  await requireRole("worker");
  const supabase = await createClient();
  // RLS returns only the active, non-archived zones this worker is assigned to.
  const { data, error } = await supabase
    .from("zones_geojson")
    .select("id, name, color, note, geojson, active_count")
    .order("name")
    .overrideTypes<Zone[], { merge: false }>();
  if (error) throw new Error(`Görevler yüklenemedi: ${error.message}`);
  const fetchedAt = readTime();

  const zones = data ?? [];
  if (zones.length === 0) return <NoAssignments fetchedAt={fetchedAt} />;

  return <WorkerMap zones={zones} fetchedAt={fetchedAt} />;
}
