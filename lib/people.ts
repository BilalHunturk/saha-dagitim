import type { SupabaseClient } from "@supabase/supabase-js";
import { generatePassword } from "@/lib/password";
import { normalizePhone, phoneToEmail } from "@/lib/phone";

/**
 * Worker management core. Every function takes a service-role client and assumes the
 * caller has already been checked to be an admin (see app/yonetim/kisiler/actions.ts).
 * Admin accounts are never touched: each operation only acts on `role = 'worker'` rows.
 */

export type ActionResult = { ok: true; password?: string } | { ok: false; error: string };

export const NAME_REQUIRED = "Ad soyad gerekli";
export const INVALID_PHONE = "Telefon numarası geçersiz";
export const DUPLICATE_PHONE = "Bu telefon numarası zaten kayıtlı";
export const NOT_FOUND = "Kişi bulunamadı";
export const FAILED = "İşlem tamamlanamadı, tekrar deneyin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fail = (error: string): ActionResult => ({ ok: false, error });

type Validated = { ok: true; fullName: string; phone: string } | { ok: false; error: string };

function validate(fullName: string, phone: string): Validated {
  const name = fullName.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, error: NAME_REQUIRED };
  const e164 = normalizePhone(phone);
  if (!e164) return { ok: false, error: INVALID_PHONE };
  return { ok: true, fullName: name, phone: e164 };
}

/** True if some profile other than `exceptId` already uses the phone. */
async function phoneTaken(admin: SupabaseClient, phone: string, exceptId?: string): Promise<boolean> {
  let query = admin.from("profiles").select("id").eq("phone", phone);
  if (exceptId) query = query.neq("id", exceptId);
  const { data, error } = await query.limit(1);
  if (error) throw new Error(error.message);
  return data.length > 0;
}

/** The worker's current profile, or null if the id is not a worker. */
async function findWorker(admin: SupabaseClient, id: string) {
  if (!UUID.test(id)) return null;
  const { data, error } = await admin
    .from("profiles")
    .select("id, phone, active")
    .eq("id", id)
    .eq("role", "worker")
    .maybeSingle<{ id: string; phone: string; active: boolean }>();
  if (error) throw new Error(error.message);
  return data;
}

const isUniqueViolation = (error: { code?: string } | null) => error?.code === "23505";
const isEmailTaken = (error: { code?: string } | null) =>
  error?.code === "email_exists" || error?.code === "user_already_exists";

/**
 * Creates an auth user + worker profile and returns the generated password.
 * If the profile cannot be written, the auth user just created is deleted again.
 */
export async function createWorkerCore(
  admin: SupabaseClient,
  fullName: string,
  phone: string,
): Promise<ActionResult> {
  const input = validate(fullName, phone);
  if (!input.ok) return fail(input.error);

  if (await phoneTaken(admin, input.phone)) return fail(DUPLICATE_PHONE);

  const password = generatePassword();
  const { data, error } = await admin.auth.admin.createUser({
    email: phoneToEmail(input.phone),
    password,
    email_confirm: true,
  });
  if (error || !data.user) return fail(isEmailTaken(error) ? DUPLICATE_PHONE : FAILED);

  const { error: profileError } = await admin.from("profiles").insert({
    id: data.user.id,
    full_name: input.fullName,
    phone: input.phone,
    role: "worker",
    active: true,
  });
  if (profileError) {
    // Do not leave a half-created account behind.
    await admin.auth.admin.deleteUser(data.user.id);
    return fail(isUniqueViolation(profileError) ? DUPLICATE_PHONE : FAILED);
  }

  return { ok: true, password };
}

/** Updates a worker's name and phone. A phone change also moves the sign-in email. */
export async function updateWorkerCore(
  admin: SupabaseClient,
  id: string,
  fullName: string,
  phone: string,
): Promise<ActionResult> {
  const input = validate(fullName, phone);
  if (!input.ok) return fail(input.error);

  const worker = await findWorker(admin, id);
  if (!worker) return fail(NOT_FOUND);

  const phoneChanged = worker.phone !== input.phone;
  if (phoneChanged) {
    if (await phoneTaken(admin, input.phone, id)) return fail(DUPLICATE_PHONE);
    const { error } = await admin.auth.admin.updateUserById(id, {
      email: phoneToEmail(input.phone),
      email_confirm: true,
    });
    if (error) return fail(isEmailTaken(error) ? DUPLICATE_PHONE : FAILED);
  }

  const { error } = await admin
    .from("profiles")
    .update({ full_name: input.fullName, phone: input.phone })
    .eq("id", id);
  if (error) {
    if (phoneChanged) {
      // Put the sign-in email back so the account still matches its profile phone.
      await admin.auth.admin.updateUserById(id, { email: phoneToEmail(worker.phone), email_confirm: true });
    }
    return fail(isUniqueViolation(error) ? DUPLICATE_PHONE : FAILED);
  }

  return { ok: true };
}

/**
 * Activates or deactivates a worker. Deactivating also ends all of the worker's active
 * assignments; reactivating does not bring them back.
 */
export async function setWorkerActiveCore(
  admin: SupabaseClient,
  id: string,
  active: boolean,
): Promise<ActionResult> {
  const worker = await findWorker(admin, id);
  if (!worker) return fail(NOT_FOUND);

  // Deactivate first: assign_worker refuses inactive workers, so no new assignment can
  // appear after the ones below are closed.
  const { error } = await admin.from("profiles").update({ active }).eq("id", id);
  if (error) return fail(FAILED);

  if (!active) {
    const { error: endError } = await admin
      .from("assignments")
      .update({ ended_at: new Date().toISOString() })
      .eq("worker_id", id)
      .is("ended_at", null);
    if (endError) return fail(FAILED);
  }

  return { ok: true };
}

/** Sets a newly generated password for a worker and returns it. */
export async function resetWorkerPasswordCore(admin: SupabaseClient, id: string): Promise<ActionResult> {
  const worker = await findWorker(admin, id);
  if (!worker) return fail(NOT_FOUND);

  const password = generatePassword();
  const { error } = await admin.auth.admin.updateUserById(id, { password });
  if (error) return fail(FAILED);

  return { ok: true, password };
}
