import { randomBytes, randomInt } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Polygon } from "geojson";
import { phoneToEmail } from "@/lib/phone";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON_KEY || !SERVICE_KEY) {
  throw new Error("DB tests need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY in .env.local");
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

/** Service-role client: bypasses RLS. Test setup/cleanup only. */
export const service: SupabaseClient = createClient(URL, SERVICE_KEY, noSession);

/** A client with no signed-in user. */
export function anonClient(): SupabaseClient {
  return createClient(URL!, ANON_KEY!, noSession);
}

export type Role = "admin" | "worker";

export interface TestUser {
  id: string;
  phone: string;
  client: SupabaseClient;
}

const createdUserIds: string[] = [];

function randomPhone(): string {
  let digits = "";
  for (let i = 0; i < 9; i++) digits += randomInt(0, 10);
  return `+905${digits}`;
}

/** Creates an auth user + profile and returns an anon-key client signed in as that user. */
export async function makeUser(
  role: Role,
  opts: { fullName?: string; active?: boolean } = {},
): Promise<TestUser> {
  const phone = randomPhone();
  const email = phoneToEmail(phone);
  const password = randomBytes(12).toString("base64url");

  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  const id = data.user.id;
  createdUserIds.push(id);

  const { error: profileError } = await service.from("profiles").insert({
    id,
    full_name: opts.fullName ?? `Test ${role}`,
    phone,
    role,
    active: opts.active ?? true,
  });
  if (profileError) throw new Error(`profile insert failed: ${profileError.message}`);

  const client = anonClient();
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`signIn failed: ${signInError.message}`);

  return { id, phone, client };
}

/** Sets profiles.active for a user (service role). */
export async function setActive(userId: string, active: boolean): Promise<void> {
  const { error } = await service.from("profiles").update({ active }).eq("id", userId);
  if (error) throw new Error(`setActive failed: ${error.message}`);
}

/** Saves a zone as the given admin and returns its id. */
export async function saveZone(admin: TestUser, name: string, geojson: Polygon = SQUARE): Promise<string> {
  const { data, error } = await admin.client.rpc("save_zone", {
    p_id: null,
    p_name: name,
    p_color: "#e11d48",
    p_note: null,
    p_geojson: geojson,
  });
  if (error) throw new Error(`save_zone failed: ${error.message}`);
  return data as string;
}

/** Removes every row and auth user created through these helpers. */
export async function cleanup(): Promise<void> {
  const ids = createdUserIds.splice(0);
  if (ids.length === 0) return;
  const list = `(${ids.join(",")})`;
  await service.from("assignments").delete().or(`worker_id.in.${list},assigned_by.in.${list}`);
  const { data: zones } = await service.from("zones").select("id").in("created_by", ids);
  const zoneIds = (zones ?? []).map((z) => z.id as string);
  if (zoneIds.length) {
    await service.from("assignments").delete().in("zone_id", zoneIds);
    await service.from("zones").delete().in("id", zoneIds);
  }
  await service.from("profiles").delete().in("id", ids);
  for (const id of ids) await service.auth.admin.deleteUser(id);
}

/** A ~1 km square in central Ankara. GeoJSON order: [lng, lat]. */
export const SQUARE: Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [32.85, 39.93],
      [32.86, 39.93],
      [32.86, 39.94],
      [32.85, 39.94],
      [32.85, 39.93],
    ],
  ],
};

/** Self-intersecting "bow tie" polygon: invalid per ST_IsValid. */
export const BOWTIE: Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [32.85, 39.93],
      [32.86, 39.94],
      [32.86, 39.93],
      [32.85, 39.94],
      [32.85, 39.93],
    ],
  ],
};
