import { describe, expect, it } from "vitest";
import { applyAssignmentOp, resolveDrop, zonesOfWorker } from "./assignments";
import type { Assignment } from "./types";

const W1 = "11111111-1111-4111-8111-111111111111";
const W2 = "22222222-2222-4222-8222-222222222222";
const ZA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ZB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ZC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

let n = 0;
function a(worker_id: string, zone_id: string, ended_at: string | null = null): Assignment {
  n += 1;
  return { id: `row-${n}`, worker_id, zone_id, started_at: "2026-11-12T08:00:00Z", ended_at };
}

describe("zonesOfWorker", () => {
  it("returns only the zones of active (ended_at === null) assignments", () => {
    const list = [a(W1, ZA), a(W1, ZB, "2026-11-12T09:00:00Z"), a(W2, ZC), a(W1, ZC)];
    expect(zonesOfWorker(list, W1)).toEqual([ZA, ZC]);
  });

  it("returns an empty list for a worker without assignments", () => {
    expect(zonesOfWorker([a(W2, ZA)], W1)).toEqual([]);
  });
});

describe("resolveDrop from the people list (fromZoneId null)", () => {
  it("is a noop when the worker is already in the target zone", () => {
    expect(resolveDrop([a(W1, ZA)], { workerId: W1, fromZoneId: null }, ZA)).toEqual({ kind: "noop" });
  });

  it("assigns when the worker has no assignment", () => {
    const ended = a(W1, ZB, "2026-11-12T09:00:00Z");
    expect(resolveDrop([ended, a(W2, ZA)], { workerId: W1, fromZoneId: null }, ZA)).toEqual({
      kind: "assign",
      workerId: W1,
      zoneId: ZA,
    });
  });

  it("asks when the worker is assigned elsewhere", () => {
    expect(resolveDrop([a(W1, ZA), a(W1, ZB)], { workerId: W1, fromZoneId: null }, ZC)).toEqual({
      kind: "ask",
      workerId: W1,
      zoneId: ZC,
      currentZoneIds: [ZA, ZB],
    });
  });
});

describe("resolveDrop from a chip (fromZoneId set)", () => {
  it("is a noop when dropped on its own zone", () => {
    expect(resolveDrop([a(W1, ZA)], { workerId: W1, fromZoneId: ZA }, ZA)).toEqual({ kind: "noop" });
  });

  it("is a noop when the worker is already in the target zone", () => {
    expect(resolveDrop([a(W1, ZA), a(W1, ZB)], { workerId: W1, fromZoneId: ZA }, ZB)).toEqual({ kind: "noop" });
  });

  it("moves otherwise", () => {
    expect(resolveDrop([a(W1, ZA)], { workerId: W1, fromZoneId: ZA }, ZB)).toEqual({
      kind: "move",
      workerId: W1,
      fromZoneId: ZA,
      toZoneId: ZB,
    });
  });
});

describe("applyAssignmentOp (optimistic update)", () => {
  it("assign adds one active row, and does not duplicate an existing one", () => {
    const base = [a(W2, ZA)];
    const added = applyAssignmentOp(base, { kind: "assign", workerId: W1, zoneId: ZA });
    expect(zonesOfWorker(added, W1)).toEqual([ZA]);
    expect(applyAssignmentOp(added, { kind: "assign", workerId: W1, zoneId: ZA })).toHaveLength(2);
  });

  it("unassign removes the active row", () => {
    const next = applyAssignmentOp([a(W1, ZA), a(W1, ZB)], { kind: "unassign", workerId: W1, zoneId: ZA });
    expect(zonesOfWorker(next, W1)).toEqual([ZB]);
  });

  it("move replaces the source zone with the target", () => {
    const next = applyAssignmentOp([a(W1, ZA)], { kind: "move", workerId: W1, fromZoneId: ZA, toZoneId: ZC });
    expect(zonesOfWorker(next, W1)).toEqual([ZC]);
  });

  it("does not mutate its input", () => {
    const base = [a(W1, ZA)];
    applyAssignmentOp(base, { kind: "unassign", workerId: W1, zoneId: ZA });
    expect(base).toHaveLength(1);
  });
});
