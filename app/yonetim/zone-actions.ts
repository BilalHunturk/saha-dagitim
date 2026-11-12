"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { validatePolygon } from "@/lib/geo";
import { createClient } from "@/lib/supabase/server";

// Server actions are public endpoints: re-check the caller and coerce every input.
// The SQL functions (save_zone / archive_zone) are the real authority; they also check is_admin().

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FAILED = "Bölge kaydedilemedi, tekrar deneyin";

/** Turkish messages raised by save_zone / archive_zone; anything else becomes a generic error. */
const KNOWN_ERRORS = new Set([
  "Yetkisiz",
  "Bölge adı gerekli",
  "Geçersiz renk",
  "Geçersiz bölge şekli",
  "Bölge bulunamadı",
]);

const str = (value: unknown) => (typeof value === "string" ? value : "");

function dbError(error: { message?: string }, fallback: string) {
  const message = error.message ?? "";
  if (!KNOWN_ERRORS.has(message)) console.error("zone action failed:", message);
  return { ok: false as const, error: KNOWN_ERRORS.has(message) ? message : fallback };
}

export async function saveZone(input: {
  id: string | null;
  name: string;
  color: string;
  note: string | null;
  geojson: GeoJSON.Polygon;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await requireRole("admin");

  const id = input?.id ?? null;
  if (id !== null && !UUID.test(str(id))) return { ok: false, error: "Bölge bulunamadı" };
  const name = str(input?.name).trim();
  if (!name) return { ok: false, error: "Bölge adı gerekli" };
  const color = str(input?.color);
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return { ok: false, error: "Geçersiz renk" };
  const note = str(input?.note).trim() || null;
  const polygon = validatePolygon(input?.geojson);
  if (!polygon.ok) return { ok: false, error: polygon.error };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_zone", {
    p_id: id,
    p_name: name,
    p_color: color,
    p_note: note,
    p_geojson: polygon.polygon,
  });
  if (error) return dbError(error, FAILED);

  revalidatePath("/yonetim");
  return { ok: true, id: data as string };
}

export async function archiveZone(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireRole("admin");
  if (!UUID.test(str(id))) return { ok: false, error: "Bölge bulunamadı" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("archive_zone", { p_id: id });
  if (error) return dbError(error, "Bölge arşivlenemedi, tekrar deneyin");

  revalidatePath("/yonetim");
  return { ok: true };
}
