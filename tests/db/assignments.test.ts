import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanup, makeUser, saveZone, setActive, type TestUser } from "./helpers";

let admin: TestUser;

beforeAll(async () => {
  admin = await makeUser("admin");
});

afterAll(cleanup);

const assign = (w: string, z: string) => admin.client.rpc("assign_worker", { p_worker: w, p_zone: z });

async function activeRows(filter: { worker?: string; zone?: string }) {
  let q = admin.client.from("assignments").select("worker_id, zone_id, ended_at").is("ended_at", null);
  if (filter.worker) q = q.eq("worker_id", filter.worker);
  if (filter.zone) q = q.eq("zone_id", filter.zone);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data!;
}

async function activeCount(zone: string): Promise<number> {
  const { data } = await admin.client.from("zones_geojson").select("active_count").eq("id", zone).single();
  return data!.active_count as number;
}

describe("assign_worker", () => {
  it("is a no-op when already active (single active row, no error)", async () => {
    const w = await makeUser("worker");
    const z = await saveZone(admin, "Çift");
    expect((await assign(w.id, z)).error).toBeNull();
    expect((await assign(w.id, z)).error).toBeNull();
    expect(await activeRows({ worker: w.id, zone: z })).toHaveLength(1);
  });

  it("handles concurrent double drops with a single active row", async () => {
    const w = await makeUser("worker");
    const z = await saveZone(admin, "Eşzamanlı");
    const results = await Promise.all([assign(w.id, z), assign(w.id, z), assign(w.id, z)]);
    for (const r of results) expect(r.error).toBeNull();
    expect(await activeRows({ worker: w.id, zone: z })).toHaveLength(1);
  });

  it("allows one worker in two zones and two workers in one zone", async () => {
    const w1 = await makeUser("worker");
    const w2 = await makeUser("worker");
    const a = await saveZone(admin, "A");
    const b = await saveZone(admin, "B");
    await assign(w1.id, a);
    await assign(w1.id, b);
    await assign(w2.id, a);
    expect(await activeRows({ worker: w1.id })).toHaveLength(2);
    expect(await activeRows({ zone: a })).toHaveLength(2);
    expect(await activeCount(a)).toBe(2);
    expect(await activeCount(b)).toBe(1);
  });

  it("rejects assigning an inactive worker", async () => {
    const w = await makeUser("worker");
    await setActive(w.id, false);
    const z = await saveZone(admin, "Pasif");
    const { error } = await assign(w.id, z);
    expect(error).not.toBeNull();
    expect(await activeRows({ zone: z })).toHaveLength(0);
  });

  it("rejects assigning to a zone that does not exist", async () => {
    const w = await makeUser("worker");
    const { error } = await assign(w.id, "00000000-0000-0000-0000-000000000000");
    expect(error).not.toBeNull();
  });
});

describe("move_worker", () => {
  it("closes the old assignment (kept as history) and opens a new one", async () => {
    const w = await makeUser("worker");
    const a = await saveZone(admin, "Kaynak");
    const b = await saveZone(admin, "Hedef");
    await assign(w.id, a);

    const { error } = await admin.client.rpc("move_worker", { p_worker: w.id, p_from: a, p_to: b });
    expect(error).toBeNull();

    const { data: rows } = await admin.client
      .from("assignments")
      .select("zone_id, ended_at")
      .eq("worker_id", w.id)
      .order("started_at");
    const fromRows = rows!.filter((r) => r.zone_id === a);
    expect(fromRows).toHaveLength(1);
    expect(fromRows[0].ended_at).not.toBeNull();
    expect(await activeRows({ worker: w.id, zone: b })).toHaveLength(1);
    expect(await activeRows({ worker: w.id })).toHaveLength(1);
  });

  it("does not close the old assignment when the target is invalid", async () => {
    const w = await makeUser("worker");
    const a = await saveZone(admin, "Kalır");
    const b = await saveZone(admin, "Arşivli hedef");
    await assign(w.id, a);
    await admin.client.rpc("archive_zone", { p_id: b });
    const { error } = await admin.client.rpc("move_worker", { p_worker: w.id, p_from: a, p_to: b });
    expect(error).not.toBeNull();
    expect(await activeRows({ worker: w.id, zone: a })).toHaveLength(1);
  });

  it("refuses a stale source: a worker not in p_from is not silently added to p_to", async () => {
    // Tab 1 moved the worker A -> C; a stale tab 2 still shows them in A and drags A -> B.
    const w = await makeUser("worker");
    const a = await saveZone(admin, "Eski kaynak");
    const b = await saveZone(admin, "Bayat hedef");
    const c = await saveZone(admin, "Güncel");
    await assign(w.id, a);
    expect((await admin.client.rpc("move_worker", { p_worker: w.id, p_from: a, p_to: c })).error).toBeNull();

    const { error } = await admin.client.rpc("move_worker", { p_worker: w.id, p_from: a, p_to: b });
    expect(error?.message).toBe("Kişi bu bölgede değil");
    expect(await activeRows({ worker: w.id })).toEqual([{ worker_id: w.id, zone_id: c, ended_at: null }]);
  });

  it("is a no-op when the same move is retried (e.g. after a lost response)", async () => {
    const w = await makeUser("worker");
    const a = await saveZone(admin, "Tekrar kaynak");
    const b = await saveZone(admin, "Tekrar hedef");
    await assign(w.id, a);
    const move = () => admin.client.rpc("move_worker", { p_worker: w.id, p_from: a, p_to: b });
    expect((await move()).error).toBeNull();
    expect((await move()).error).toBeNull();
    expect(await activeRows({ worker: w.id })).toEqual([{ worker_id: w.id, zone_id: b, ended_at: null }]);
  });
});

describe("unassign_worker", () => {
  it("ends the assignment and lowers active_count", async () => {
    const w1 = await makeUser("worker");
    const w2 = await makeUser("worker");
    const z = await saveZone(admin, "Çıkar");
    await assign(w1.id, z);
    await assign(w2.id, z);
    expect(await activeCount(z)).toBe(2);

    const { error } = await admin.client.rpc("unassign_worker", { p_worker: w1.id, p_zone: z });
    expect(error).toBeNull();
    expect(await activeCount(z)).toBe(1);

    const { data } = await admin.client.from("assignments").select("ended_at").eq("worker_id", w1.id).eq("zone_id", z);
    expect(data).toHaveLength(1);
    expect(data![0].ended_at).not.toBeNull();
  });

  it("allows re-assigning after unassign (new row, history kept)", async () => {
    const w = await makeUser("worker");
    const z = await saveZone(admin, "Tekrar");
    await assign(w.id, z);
    await admin.client.rpc("unassign_worker", { p_worker: w.id, p_zone: z });
    expect((await assign(w.id, z)).error).toBeNull();
    const { data } = await admin.client.from("assignments").select("id").eq("worker_id", w.id).eq("zone_id", z);
    expect(data).toHaveLength(2);
    expect(await activeRows({ worker: w.id, zone: z })).toHaveLength(1);
  });
});
