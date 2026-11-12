"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import {
  createWorkerCore,
  resetWorkerPasswordCore,
  setWorkerActiveCore,
  updateWorkerCore,
  type ActionResult,
} from "@/lib/people";
import { createAdminClient } from "@/lib/supabase/admin";

// Every action re-checks the caller: server actions are public endpoints.
// Inputs arrive from the network, so they are coerced instead of trusted.

const str = (value: unknown) => (typeof value === "string" ? value : "");

function done(result: ActionResult): ActionResult {
  // The map screen shows the same people and counts, so refresh the whole /yonetim tree.
  if (result.ok) revalidatePath("/yonetim", "layout");
  return result;
}

export async function createWorker(input: { fullName: string; phone: string }): Promise<ActionResult> {
  await requireRole("admin");
  return done(await createWorkerCore(createAdminClient(), str(input?.fullName), str(input?.phone)));
}

export async function updateWorker(input: { id: string; fullName: string; phone: string }): Promise<ActionResult> {
  await requireRole("admin");
  return done(
    await updateWorkerCore(createAdminClient(), str(input?.id), str(input?.fullName), str(input?.phone)),
  );
}

export async function setWorkerActive(input: { id: string; active: boolean }): Promise<ActionResult> {
  await requireRole("admin");
  return done(await setWorkerActiveCore(createAdminClient(), str(input?.id), input?.active === true));
}

export async function resetWorkerPassword(input: { id: string }): Promise<ActionResult> {
  await requireRole("admin");
  return done(await resetWorkerPasswordCore(createAdminClient(), str(input?.id)));
}
