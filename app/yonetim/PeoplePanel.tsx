"use client";

import { useDraggable } from "@dnd-kit/core";
import { memo, useDeferredValue, useMemo, useState } from "react";
import type { Assignment, Profile, Zone } from "@/lib/types";
import type { DragData } from "./dnd";

type Filter = "all" | "unassigned" | "assigned";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Tümü" },
  { id: "unassigned", label: "Atanmamış" },
  { id: "assigned", label: "Atanmış" },
];

/** Rows rendered per page; "Daha fazla göster" adds another page. Keeps 700 people fast. */
export const PAGE_SIZE = 100;

type Props = {
  people: Profile[];
  zones: Zone[];
  assignments: Assignment[];
  /** Open the "Bölgeye ata" picker for a worker (tap / click / keyboard; the non-drag path). */
  onPick: (workerId: string) => void;
};

type ZoneDot = { id: string; name: string; color: string };

const lower = (s: string) => s.toLocaleLowerCase("tr");
const digits = (s: string) => s.replace(/\D/g, "");

/** Active workers only, searchable by name or phone, filterable by assignment. Each row is draggable. */
export function PeoplePanel({ people, zones, assignments, onPick }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const deferredQuery = useDeferredValue(query);

  const zoneById = useMemo(() => new Map(zones.map((z) => [z.id, z])), [zones]);

  /** workerId → the zones they are in (active assignments to listed zones). */
  const zonesByWorker = useMemo(() => {
    const map = new Map<string, ZoneDot[]>();
    for (const a of assignments) {
      if (a.ended_at !== null) continue;
      const zone = zoneById.get(a.zone_id);
      if (!zone) continue;
      const list = map.get(a.worker_id) ?? [];
      if (!list.some((z) => z.id === zone.id)) list.push({ id: zone.id, name: zone.name, color: zone.color });
      map.set(a.worker_id, list);
    }
    return map;
  }, [assignments, zoneById]);

  const active = useMemo(() => people.filter((p) => p.active && p.role === "worker"), [people]);

  const counts = useMemo(() => {
    const assigned = active.filter((p) => zonesByWorker.has(p.id)).length;
    return { all: active.length, assigned, unassigned: active.length - assigned };
  }, [active, zonesByWorker]);

  const visible = useMemo(() => {
    const q = lower(deferredQuery.trim());
    const qDigits = digits(deferredQuery);
    return active.filter((p) => {
      const isAssigned = zonesByWorker.has(p.id);
      if (filter === "assigned" && !isAssigned) return false;
      if (filter === "unassigned" && isAssigned) return false;
      if (!q) return true;
      return lower(p.full_name).includes(q) || (qDigits.length >= 3 && digits(p.phone).includes(qDigits));
    });
  }, [active, zonesByWorker, deferredQuery, filter]);

  const shown = visible.slice(0, limit);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b border-zinc-200 p-3">
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(PAGE_SIZE);
          }}
          placeholder="Ad veya telefon ara"
          aria-label="Kişi ara"
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-900"
        />
        <div role="radiogroup" aria-label="Atama filtresi" className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={filter === f.id}
              onClick={() => {
                setFilter(f.id);
                setLimit(PAGE_SIZE);
              }}
              className={`flex-1 rounded-lg px-2 py-1 text-xs font-medium ${
                filter === f.id ? "bg-zinc-900 text-white" : "bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-100"
              }`}
            >
              {f.label} <span className="opacity-70">({counts[f.id]})</span>
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {shown.length === 0 ? (
          <p className="p-3 text-sm text-zinc-500">
            {active.length === 0 ? "Henüz aktif dağıtıcı yok. “Kişiler” sayfasından ekleyin." : "Eşleşen kişi yok."}
          </p>
        ) : (
          <ul aria-label="Kişi listesi" className="space-y-1">
            {shown.map((p) => (
              <PersonRow key={p.id} person={p} zones={zonesByWorker.get(p.id)} onPick={onPick} />
            ))}
          </ul>
        )}
        {visible.length > shown.length && (
          <button
            type="button"
            onClick={() => setLimit((l) => l + PAGE_SIZE)}
            className="mt-2 w-full rounded-lg border border-zinc-200 bg-white py-2 text-sm text-zinc-700 hover:bg-zinc-100"
          >
            Daha fazla göster ({visible.length - shown.length} kişi daha)
          </button>
        )}
      </div>
    </div>
  );
}

const EMPTY: ZoneDot[] = [];

const PersonRow = memo(function PersonRow({
  person,
  zones = EMPTY,
  onPick,
}: {
  person: Profile;
  zones?: ZoneDot[];
  onPick: (workerId: string) => void;
}) {
  const data: DragData = { workerId: person.id, fromZoneId: null, name: person.full_name };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `person:${person.id}`,
    data,
    attributes: { roleDescription: "sürüklenebilir kişi" },
  });

  return (
    <li data-person-id={person.id}>
      <button
        ref={setNodeRef}
        type="button"
        {...listeners}
        {...attributes}
        onClick={() => onPick(person.id)}
        aria-label={`${person.full_name}, ${
          zones.length ? `${zones.length} bölgede: ${zones.map((z) => z.name).join(", ")}` : "atanmadı"
        }. Bölgeye ata`}
        className={`flex w-full cursor-grab touch-manipulation select-none items-center gap-2 rounded-lg bg-white px-3 py-2 text-left ring-1 ring-zinc-200 hover:bg-zinc-50 active:cursor-grabbing ${
          isDragging ? "opacity-40" : ""
        }`}
      >
        <span className="min-w-0 flex-1 truncate text-sm text-zinc-900">{person.full_name}</span>
        {zones.length === 0 ? (
          <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500">Atanmadı</span>
        ) : (
          <span className="flex shrink-0 items-center gap-1" title={zones.map((z) => z.name).join(", ")}>
            <span className="flex -space-x-1">
              {zones.slice(0, 4).map((z) => (
                <span
                  key={z.id}
                  aria-hidden
                  className="h-2.5 w-2.5 rounded-full ring-2 ring-white"
                  style={{ backgroundColor: z.color }}
                />
              ))}
            </span>
            <span data-badge-count className="text-xs font-medium text-zinc-700">
              {zones.length}
            </span>
          </span>
        )}
      </button>
    </li>
  );
});
