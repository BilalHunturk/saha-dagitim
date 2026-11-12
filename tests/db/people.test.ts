import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createWorkerCore,
  resetWorkerPasswordCore,
  setWorkerActiveCore,
  updateWorkerCore,
} from "@/lib/people";
import { formatPhone, normalizePhone, phoneToEmail } from "@/lib/phone";
import {
  anonClient,
  cleanup,
  makeUser,
  randomPhone,
  saveZone,
  service,
  trackUser,
  type TestUser,
} from "./helpers";

let admin: TestUser;

beforeAll(async () => {
  admin = await makeUser("admin");
});

afterAll(cleanup);

/** All auth users whose email matches. */
async function authUsersWithEmail(email: string) {
  const { data, error } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(error.message);
  return data.users.filter((u) => u.email === email);
}

async function profileByPhone(phone: string) {
  const { data } = await service.from("profiles").select("id, full_name, phone, role, active").eq("phone", phone);
  return data ?? [];
}

async function signIn(phone: string, password: string) {
  return anonClient().auth.signInWithPassword({ email: phoneToEmail(phone), password });
}

/** Creates a worker through the core and registers it for cleanup. */
async function createTracked(fullName: string, phone: string) {
  const result = await createWorkerCore(service, fullName, phone);
  const rows = await profileByPhone(normalizePhone(phone) ?? phone);
  for (const r of rows) trackUser(r.id as string);
  return result;
}

describe("createWorkerCore", () => {
  it("creates a worker whose returned password signs in", async () => {
    const phone = randomPhone();
    // Typed the way a person would: national format with spaces.
    const result = await createTracked("  Ayşe Yılmaz ", formatPhone(phone));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.password).toMatch(/^[a-z2-9]{8}$/);

    const rows = await profileByPhone(phone);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ full_name: "Ayşe Yılmaz", phone, role: "worker", active: true });

    const { error } = await signIn(phone, result.password!);
    expect(error).toBeNull();
  });

  it("refuses a second worker with the same phone and leaves a single auth user", async () => {
    const phone = randomPhone();
    expect((await createTracked("Bir", phone)).ok).toBe(true);

    const again = await createTracked("İki", `0${phone.slice(3)}`);
    expect(again).toEqual({ ok: false, error: "Bu telefon numarası zaten kayıtlı" });
    expect(await authUsersWithEmail(phoneToEmail(phone))).toHaveLength(1);
    expect(await profileByPhone(phone)).toHaveLength(1);
  });

  it("rejects an invalid phone and creates nothing", async () => {
    const before = (await service.auth.admin.listUsers({ page: 1, perPage: 1000 })).data.users.length;
    expect(await createWorkerCore(service, "Sabit Hat", "0312 123 45 67")).toEqual({
      ok: false,
      error: "Telefon numarası geçersiz",
    });
    expect(await createWorkerCore(service, "Eksik", "0532 123")).toEqual({
      ok: false,
      error: "Telefon numarası geçersiz",
    });
    const after = (await service.auth.admin.listUsers({ page: 1, perPage: 1000 })).data.users.length;
    expect(after).toBe(before);
  });

  it("rejects a blank name", async () => {
    expect(await createWorkerCore(service, "   ", randomPhone())).toEqual({ ok: false, error: "Ad soyad gerekli" });
  });

  it("deletes the auth user when the profile insert fails", async () => {
    const phone = randomPhone();
    const failingProfiles = withFailingProfileInsert(service);
    const result = await createWorkerCore(failingProfiles, "Yarım Kalan", phone);
    expect(result.ok).toBe(false);
    expect(await authUsersWithEmail(phoneToEmail(phone))).toHaveLength(0);
    expect(await profileByPhone(phone)).toHaveLength(0);
  });
});

describe("updateWorkerCore", () => {
  it("changes name and phone, and the worker signs in with the new phone", async () => {
    const phone = randomPhone();
    const created = await createTracked("Eski Ad", phone);
    if (!created.ok) throw new Error(created.error);
    const [{ id }] = await profileByPhone(phone);

    const newPhone = randomPhone();
    expect(await updateWorkerCore(service, id as string, "Yeni Ad", newPhone)).toEqual({ ok: true });

    expect(await profileByPhone(phone)).toHaveLength(0);
    expect((await profileByPhone(newPhone))[0]).toMatchObject({ id, full_name: "Yeni Ad" });
    expect((await signIn(newPhone, created.password!)).error).toBeNull();
    expect((await signIn(phone, created.password!)).error).not.toBeNull();
  });

  it("refuses a phone that belongs to someone else", async () => {
    const a = await makeUser("worker");
    const b = await makeUser("worker");
    expect(await updateWorkerCore(service, b.id, "B", a.phone)).toEqual({
      ok: false,
      error: "Bu telefon numarası zaten kayıtlı",
    });
  });

  it("does not touch admins", async () => {
    const result = await updateWorkerCore(service, admin.id, "Değişti", admin.phone);
    expect(result.ok).toBe(false);
  });
});

describe("setWorkerActiveCore", () => {
  it("deactivating ends the worker's active assignments; reactivating does not restore them", async () => {
    const w = await makeUser("worker");
    const other = await makeUser("worker");
    const z1 = await saveZone(admin, "Pasif 1");
    const z2 = await saveZone(admin, "Pasif 2");
    for (const [worker, zone] of [
      [w.id, z1],
      [w.id, z2],
      [other.id, z1],
    ]) {
      const { error } = await admin.client.rpc("assign_worker", { p_worker: worker, p_zone: zone });
      if (error) throw new Error(error.message);
    }

    expect(await setWorkerActiveCore(service, w.id, false)).toEqual({ ok: true });

    const { data: profile } = await service.from("profiles").select("active").eq("id", w.id).single();
    expect(profile!.active).toBe(false);
    const { data: rows } = await service.from("assignments").select("ended_at").eq("worker_id", w.id);
    expect(rows).toHaveLength(2);
    expect(rows!.every((r) => r.ended_at !== null)).toBe(true);
    // Someone else's assignment is untouched.
    const { data: otherRows } = await service
      .from("assignments")
      .select("ended_at")
      .eq("worker_id", other.id)
      .is("ended_at", null);
    expect(otherRows).toHaveLength(1);

    expect(await setWorkerActiveCore(service, w.id, true)).toEqual({ ok: true });
    const { data: again } = await service.from("profiles").select("active").eq("id", w.id).single();
    expect(again!.active).toBe(true);
    const { data: active } = await service
      .from("assignments")
      .select("id")
      .eq("worker_id", w.id)
      .is("ended_at", null);
    expect(active).toHaveLength(0);
  });

  it("does not deactivate admins", async () => {
    expect((await setWorkerActiveCore(service, admin.id, false)).ok).toBe(false);
    const { data } = await service.from("profiles").select("active").eq("id", admin.id).single();
    expect(data!.active).toBe(true);
  });
});

describe("resetWorkerPasswordCore", () => {
  it("returns a new password that works; the old one stops working", async () => {
    const phone = randomPhone();
    const created = await createTracked("Şifre", phone);
    if (!created.ok) throw new Error(created.error);
    const [{ id }] = await profileByPhone(phone);

    const reset = await resetWorkerPasswordCore(service, id as string);
    expect(reset.ok).toBe(true);
    if (!reset.ok) return;
    expect(reset.password).toMatch(/^[a-z2-9]{8}$/);
    expect((await signIn(phone, reset.password!)).error).toBeNull();
    expect((await signIn(phone, created.password!)).error).not.toBeNull();
  });
});

/** Wraps a client so that inserts into `profiles` fail, to exercise the rollback path. */
function withFailingProfileInsert(client: SupabaseClient): SupabaseClient {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop !== "from") return Reflect.get(target, prop, receiver);
      return (table: string) => {
        const builder = target.from(table);
        if (table !== "profiles") return builder;
        return new Proxy(builder, {
          get(b, p, r) {
            if (p === "insert") {
              return () => Promise.resolve({ data: null, error: { message: "forced failure" } });
            }
            return Reflect.get(b, p, r);
          },
        });
      };
    },
  });
}
