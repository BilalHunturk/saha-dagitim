import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BOWTIE, cleanup, makeUser, service, SQUARE, type TestUser } from "./helpers";

let admin: TestUser;

beforeAll(async () => {
  admin = await makeUser("admin");
});

afterAll(cleanup);

function save(p: { id?: string | null; name: string; color?: string; note?: string | null; geojson?: unknown }) {
  return admin.client.rpc("save_zone", {
    p_id: p.id ?? null,
    p_name: p.name,
    p_color: p.color ?? "#e11d48",
    p_note: p.note ?? null,
    p_geojson: p.geojson ?? SQUARE,
  });
}

describe("save_zone", () => {
  it("inserts when p_id is null and the view returns matching coordinates", async () => {
    const { data: id, error } = await save({ name: "A" });
    expect(error).toBeNull();
    expect(typeof id).toBe("string");

    const { data: row, error: viewError } = await admin.client
      .from("zones_geojson")
      .select("id, name, color, note, geojson, active_count")
      .eq("id", id)
      .single();
    expect(viewError).toBeNull();
    expect(row).toMatchObject({ id, name: "A", color: "#e11d48", note: null, active_count: 0 });
    expect(row!.geojson.type).toBe("Polygon");
    expect(row!.geojson.coordinates).toEqual(SQUARE.coordinates);

    const { data: zone } = await service.from("zones").select("created_by").eq("id", id).single();
    expect(zone!.created_by).toBe(admin.id);
  });

  it("updates name (and other fields) when called with the same id", async () => {
    const { data: id } = await save({ name: "Eski" });
    const { data: same, error } = await save({ id, name: "Yeni", color: "#2563eb", note: "not" });
    expect(error).toBeNull();
    expect(same).toBe(id);
    const { data: row } = await admin.client.from("zones_geojson").select("name, color, note").eq("id", id).single();
    expect(row).toEqual({ name: "Yeni", color: "#2563eb", note: "not" });
  });

  it("rejects a self-intersecting (bow tie) polygon", async () => {
    const { error } = await save({ name: "Papyon", geojson: BOWTIE });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("Geçersiz bölge şekli");
  });

  it("rejects a non-Polygon geometry", async () => {
    const { error } = await save({ name: "Nokta", geojson: { type: "Point", coordinates: [32.85, 39.93] } });
    expect(error?.message).toContain("Geçersiz bölge şekli");
    const multi = await save({
      name: "Çoklu",
      geojson: { type: "MultiPolygon", coordinates: [SQUARE.coordinates] },
    });
    expect(multi.error?.message).toContain("Geçersiz bölge şekli");
  });

  it("rejects an empty or blank name", async () => {
    for (const name of ["", "   "]) {
      const { error } = await save({ name });
      expect(error?.message).toContain("Bölge adı gerekli");
    }
  });

  it("errors when updating an id that does not exist", async () => {
    const { error } = await save({ id: "00000000-0000-0000-0000-000000000000", name: "Yok" });
    expect(error).not.toBeNull();
  });

  it("creates with a client-supplied id, and a retried create does not duplicate the zone", async () => {
    const id = randomUUID();
    const create = (name: string) =>
      admin.client.rpc("save_zone", {
        p_id: id,
        p_name: name,
        p_color: "#e11d48",
        p_note: null,
        p_geojson: SQUARE,
        p_create: true,
      });

    const first = await create("Tekrar");
    expect(first.error).toBeNull();
    expect(first.data).toBe(id);
    // The response was lost and the admin pressed Kaydet again (maybe after changing the name).
    const retry = await create("Tekrar 2");
    expect(retry.error).toBeNull();
    expect(retry.data).toBe(id);

    const { data: rows } = await service.from("zones").select("id, name, created_by").eq("id", id);
    expect(rows).toEqual([{ id, name: "Tekrar 2", created_by: admin.id }]);
  });

  it("does not revive an archived zone through a retried create", async () => {
    const id = randomUUID();
    const args = { p_id: id, p_name: "Arşiv", p_color: "#e11d48", p_note: null, p_geojson: SQUARE, p_create: true };
    expect((await admin.client.rpc("save_zone", args)).error).toBeNull();
    expect((await admin.client.rpc("archive_zone", { p_id: id })).error).toBeNull();
    const retry = await admin.client.rpc("save_zone", args);
    expect(retry.error?.message).toBe("Bölge bulunamadı");
    const { data: zone } = await service.from("zones").select("archived_at").eq("id", id).single();
    expect(zone!.archived_at).not.toBeNull();
  });
});

describe("archive_zone", () => {
  it("removes the zone from the view and closes its active assignments", async () => {
    const worker = await makeUser("worker");
    const { data: id } = await save({ name: "Arşivlenecek" });
    const assign = await admin.client.rpc("assign_worker", { p_worker: worker.id, p_zone: id });
    expect(assign.error).toBeNull();

    // Worker sees it before archiving.
    expect((await worker.client.from("zones_geojson").select("id")).data).toEqual([{ id }]);

    const { error } = await admin.client.rpc("archive_zone", { p_id: id });
    expect(error).toBeNull();

    const view = await admin.client.from("zones_geojson").select("id").eq("id", id);
    expect(view.data).toEqual([]);

    const { data: rows } = await admin.client.from("assignments").select("ended_at").eq("zone_id", id);
    expect(rows).toHaveLength(1);
    expect(rows![0].ended_at).not.toBeNull();

    const { data: zone } = await admin.client.from("zones").select("archived_at").eq("id", id).single();
    expect(zone!.archived_at).not.toBeNull();

    // Worker no longer sees anything.
    expect((await worker.client.from("zones_geojson").select("id")).data).toEqual([]);
    expect((await worker.client.from("assignments").select("id")).data).toEqual([]);
  });

  it("cannot assign to an archived zone or edit it", async () => {
    const worker = await makeUser("worker");
    const { data: id } = await save({ name: "Arşivli" });
    await admin.client.rpc("archive_zone", { p_id: id });
    const { error } = await admin.client.rpc("assign_worker", { p_worker: worker.id, p_zone: id });
    expect(error).not.toBeNull();
    const edit = await save({ id, name: "Arşivli 2" });
    expect(edit.error).not.toBeNull();
  });
});
