import type { Assignment } from "./types";

/** Pure assignment rules shared by drag-and-drop, the "Bölgeye ata" picker and optimistic updates. */

/** Zone ids the worker is currently assigned to (only rows with `ended_at === null`), in list order. */
export function zonesOfWorker(assignments: Assignment[], workerId: string): string[] {
  const zones: string[] = [];
  for (const a of assignments) {
    if (a.worker_id === workerId && a.ended_at === null && !zones.includes(a.zone_id)) zones.push(a.zone_id);
  }
  return zones;
}

export type DropIntent =
  | { kind: "noop" }
  | { kind: "assign"; workerId: string; zoneId: string }
  /** Already assigned elsewhere: ask "Buraya da ekle" or "Taşı". */
  | { kind: "ask"; workerId: string; zoneId: string; currentZoneIds: string[] }
  | { kind: "move"; workerId: string; fromZoneId: string; toZoneId: string };

/**
 * What dropping a worker on a zone means.
 * - From the people list (`fromZoneId` null): already in the target → noop; no assignment → assign;
 *   assigned elsewhere → ask.
 * - From a chip (`fromZoneId` set): same zone → noop; already in the target → noop; otherwise move.
 */
export function resolveDrop(
  assignments: Assignment[],
  drag: { workerId: string; fromZoneId: string | null },
  toZoneId: string,
): DropIntent {
  const current = zonesOfWorker(assignments, drag.workerId);
  if (current.includes(toZoneId)) return { kind: "noop" };
  if (drag.fromZoneId === null) {
    if (current.length === 0) return { kind: "assign", workerId: drag.workerId, zoneId: toZoneId };
    return { kind: "ask", workerId: drag.workerId, zoneId: toZoneId, currentZoneIds: current };
  }
  if (drag.fromZoneId === toZoneId) return { kind: "noop" };
  return { kind: "move", workerId: drag.workerId, fromZoneId: drag.fromZoneId, toZoneId };
}

/** A change sent to the server, applied locally first (optimistic update). */
export type AssignmentOp =
  | { kind: "assign"; workerId: string; zoneId: string }
  | { kind: "unassign"; workerId: string; zoneId: string }
  | { kind: "move"; workerId: string; fromZoneId: string; toZoneId: string };

const isActive = (a: Assignment, workerId: string, zoneId: string) =>
  a.worker_id === workerId && a.zone_id === zoneId && a.ended_at === null;

function withAssigned(list: Assignment[], workerId: string, zoneId: string): Assignment[] {
  if (list.some((a) => isActive(a, workerId, zoneId))) return list;
  return [
    ...list,
    {
      id: `pending:${workerId}:${zoneId}`,
      worker_id: workerId,
      zone_id: zoneId,
      started_at: new Date().toISOString(),
      ended_at: null,
    },
  ];
}

/** The active assignment list after `op`. Ended rows are dropped rather than kept (the list is active-only). */
export function applyAssignmentOp(assignments: Assignment[], op: AssignmentOp): Assignment[] {
  switch (op.kind) {
    case "assign":
      return withAssigned(assignments, op.workerId, op.zoneId);
    case "unassign":
      return assignments.filter((a) => !isActive(a, op.workerId, op.zoneId));
    case "move":
      return withAssigned(
        assignments.filter((a) => !isActive(a, op.workerId, op.fromZoneId)),
        op.workerId,
        op.toZoneId,
      );
  }
}
