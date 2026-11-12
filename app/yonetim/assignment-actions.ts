"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Server actions are public endpoints: re-check the caller and validate every id.
// The SQL functions (assign_worker / unassign_worker / move_worker) are the real authority.

type Result = { ok: true } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

const WORKER_MISSING = "Kişi bulunamadı ya da pasif";
const ZONE_MISSING = "Bölge bulunamadı ya da arşivlenmiş";
const NOT_IN_ZONE = "Kişi bu bölgede değil";
const FAILED = "Atama kaydedilemedi, tekrar deneyin";

/** Turkish messages raised by the SQL functions; anything else becomes a generic error. */
const KNOWN_ERRORS = new Set(["Yetkisiz", WORKER_MISSING, ZONE_MISSING, NOT_IN_ZONE]);

/** Errors that mean this board is stale (changed on another tab or device). */
const STALE_ERRORS = new Set([WORKER_MISSING, ZONE_MISSING, NOT_IN_ZONE]);

async function call(fn: string, args: Record<string, string>): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) {
    const message = error.message ?? "";
    // Re-read the page so the stale card / chip is replaced by the current state.
    if (STALE_ERRORS.has(message)) revalidatePath("/yonetim");
    if (KNOWN_ERRORS.has(message)) return { ok: false, error: message };
    console.error(`${fn} failed:`, message);
    return { ok: false, error: FAILED };
  }
  revalidatePath("/yonetim");
  return { ok: true };
}

export async function assignWorker(workerId: string, zoneId: string): Promise<Result> {
  await requireRole("admin");
  if (!isUuid(workerId)) return { ok: false, error: WORKER_MISSING };
  if (!isUuid(zoneId)) return { ok: false, error: ZONE_MISSING };
  return call("assign_worker", { p_worker: workerId, p_zone: zoneId });
}

export async function unassignWorker(workerId: string, zoneId: string): Promise<Result> {
  await requireRole("admin");
  if (!isUuid(workerId)) return { ok: false, error: WORKER_MISSING };
  if (!isUuid(zoneId)) return { ok: false, error: ZONE_MISSING };
  return call("unassign_worker", { p_worker: workerId, p_zone: zoneId });
}

export async function moveWorker(workerId: string, fromZoneId: string, toZoneId: string): Promise<Result> {
  await requireRole("admin");
  if (!isUuid(workerId)) return { ok: false, error: WORKER_MISSING };
  if (!isUuid(fromZoneId) || !isUuid(toZoneId)) return { ok: false, error: ZONE_MISSING };
  return call("move_worker", { p_worker: workerId, p_from: fromZoneId, p_to: toZoneId });
}
