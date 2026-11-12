import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import type { Zone } from "@/lib/types";
import { WorkerMap } from "./WorkerMap";

export const metadata: Metadata = { title: "Görevim · Saha Dağıtım" };

/** The signed-in worker's zones. The layout has already checked the role (requireRole). */
export default async function WorkerHomePage() {
  const supabase = await createClient();
  // RLS returns only the active, non-archived zones this worker is assigned to.
  const { data, error } = await supabase
    .from("zones_geojson")
    .select("id, name, color, note, geojson, active_count")
    .order("name")
    .overrideTypes<Zone[], { merge: false }>();
  if (error) throw new Error(`Görevler yüklenemedi: ${error.message}`);

  const zones = data ?? [];
  if (zones.length === 0) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <p className="max-w-xs text-center text-base text-zinc-700">
          Henüz görev atanmadı. Yöneticinizle iletişime geçin.
        </p>
      </main>
    );
  }

  return <WorkerMap zones={zones} />;
}
