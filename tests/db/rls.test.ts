import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { phoneToEmail } from "@/lib/phone";
import {
  anonClient,
  cleanup,
  makeUser,
  randomPhone,
  saveZone,
  setActive,
  SQUARE,
  trackUser,
  type TestUser,
} from "./helpers";

let admin: TestUser;
let w1: TestUser;
let w2: TestUser;
let zoneA: string; // w1 assigned
let zoneB: string; // w2 assigned

beforeAll(async () => {
  admin = await makeUser("admin");
  w1 = await makeUser("worker");
  w2 = await makeUser("worker");
  zoneA = await saveZone(admin, "RLS A");
  zoneB = await saveZone(admin, "RLS B");
  for (const [w, z] of [
    [w1, zoneA],
    [w2, zoneB],
  ] as const) {
    const { error } = await admin.client.rpc("assign_worker", { p_worker: w.id, p_zone: z });
    if (error) throw new Error(error.message);
  }
});

afterAll(cleanup);

describe("RLS: worker", () => {
  it("sees only its own profile", async () => {
    const { data, error } = await w1.client.from("profiles").select("id");
    expect(error).toBeNull();
    expect(data).toEqual([{ id: w1.id }]);
  });

  it("does not see another worker's assignment", async () => {
    const { data, error } = await w1.client.from("assignments").select("worker_id, zone_id");
    expect(error).toBeNull();
    expect(data).toEqual([{ worker_id: w1.id, zone_id: zoneA }]);
  });

  it("does not see a zone it is not assigned to", async () => {
    const zones = await w1.client.from("zones").select("id").eq("id", zoneB);
    expect(zones.error).toBeNull();
    expect(zones.data).toEqual([]);
    const view = await w1.client.from("zones_geojson").select("id").eq("id", zoneB);
    expect(view.error).toBeNull();
    expect(view.data).toEqual([]);
  });

  it("sees its assigned zone in zones_geojson", async () => {
    const { data, error } = await w1.client.from("zones_geojson").select("id, name, geojson");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].id).toBe(zoneA);
    expect(data![0].geojson.coordinates).toEqual(SQUARE.coordinates);
  });

  it("cannot insert into zones directly", async () => {
    const { error } = await w1.client.from("zones").insert({
      name: "hack",
      color: "#000000",
      geom: "SRID=4326;POLYGON((32.85 39.93,32.86 39.93,32.86 39.94,32.85 39.93))",
    });
    expect(error).not.toBeNull();
  });

  it("cannot write assignments or profiles directly", async () => {
    const ins = await w1.client.from("assignments").insert({ zone_id: zoneB, worker_id: w1.id, assigned_by: w1.id });
    expect(ins.error).not.toBeNull();

    // Updates on invisible/unwritable rows affect nothing; verify nothing changed.
    await w1.client.from("profiles").update({ role: "admin" }).eq("id", w1.id);
    await w1.client.from("assignments").update({ ended_at: new Date().toISOString() }).eq("zone_id", zoneA);
    const check = await admin.client.from("profiles").select("role").eq("id", w1.id).single();
    expect(check.data?.role).toBe("worker");
    const asg = await admin.client
      .from("assignments")
      .select("ended_at")
      .eq("worker_id", w1.id)
      .eq("zone_id", zoneA)
      .single();
    expect(asg.data?.ended_at).toBeNull();
  });

  it("cannot call write functions", async () => {
    const assign = await w1.client.rpc("assign_worker", { p_worker: w1.id, p_zone: zoneB });
    expect(assign.error).not.toBeNull();
    expect(assign.error!.message).toContain("Yetkisiz");
    const save = await w1.client.rpc("save_zone", {
      p_id: null,
      p_name: "hack",
      p_color: "#000000",
      p_note: null,
      p_geojson: SQUARE,
    });
    expect(save.error?.message).toContain("Yetkisiz");
    const archive = await w1.client.rpc("archive_zone", { p_id: zoneA });
    expect(archive.error?.message).toContain("Yetkisiz");
  });

  it("is_admin() is false for a worker and true for an admin", async () => {
    expect((await w1.client.rpc("is_admin")).data).toBe(false);
    expect((await admin.client.rpc("is_admin")).data).toBe(true);
  });
});

describe("RLS: deactivated worker", () => {
  it("sees nothing after active=false, even with a live session", async () => {
    const w3 = await makeUser("worker");
    const zone = await saveZone(admin, "RLS C");
    await admin.client.rpc("assign_worker", { p_worker: w3.id, p_zone: zone });

    const before = await w3.client.from("assignments").select("id");
    expect(before.data).toHaveLength(1);

    await setActive(w3.id, false);

    for (const table of ["assignments", "zones", "zones_geojson", "profiles"]) {
      const { data, error } = await w3.client.from(table).select("id");
      expect(error, table).toBeNull();
      expect(data, table).toEqual([]);
    }
    expect((await w3.client.rpc("is_active_user")).data).toBe(false);
  });

  it("deactivated admin loses admin rights", async () => {
    const a2 = await makeUser("admin");
    await setActive(a2.id, false);
    expect((await a2.client.rpc("is_admin")).data).toBe(false);
    const { error } = await a2.client.rpc("save_zone", {
      p_id: null,
      p_name: "x",
      p_color: "#000000",
      p_note: null,
      p_geojson: SQUARE,
    });
    expect(error?.message).toContain("Yetkisiz");
  });
});

describe("RLS: signed-out client", () => {
  it("sees 0 rows everywhere", async () => {
    const anon = anonClient();
    for (const table of ["profiles", "zones", "assignments", "zones_geojson"]) {
      const { data } = await anon.from(table).select("id");
      expect(data ?? [], table).toEqual([]);
    }
  });

  it("cannot call write functions", async () => {
    const anon = anonClient();
    const { error } = await anon.rpc("assign_worker", { p_worker: w1.id, p_zone: zoneB });
    expect(error).not.toBeNull();
  });

  it("cannot sign up with the public anon key (only the service-role admin API creates users)", async () => {
    const anon = anonClient();
    const email = phoneToEmail(randomPhone());
    const { data, error } = await anon.auth.signUp({ email, password: randomBytes(12).toString("base64url") });
    if (data.user) trackUser(data.user.id); // so a failing run still cleans up
    expect(error?.code).toBe("signup_disabled");
    expect(data.user).toBeNull();
    expect(data.session).toBeNull();
  });
});

describe("RLS: admin", () => {
  it("sees all test profiles, zones and assignments", async () => {
    const profiles = await admin.client.from("profiles").select("id").in("id", [admin.id, w1.id, w2.id]);
    expect(profiles.data).toHaveLength(3);
    const zones = await admin.client.from("zones_geojson").select("id").in("id", [zoneA, zoneB]);
    expect(zones.data).toHaveLength(2);
    const asg = await admin.client.from("assignments").select("id").in("worker_id", [w1.id, w2.id]);
    expect(asg.data).toHaveLength(2);
  });
});
