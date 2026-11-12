"use client";

import type { ReactNode } from "react";
import type { Zone } from "@/lib/types";

type Props = {
  zones: Zone[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Extra content inside each zone card, below the name (assignment chips; Task 6 adds drop targets). */
  renderZoneExtra?: (zone: Zone) => ReactNode;
};

/** One card per active zone. Each card is a `<div data-zone-id>` so it can become a drop target. */
export function ZoneList({ zones, selectedId, onSelect, renderZoneExtra }: Props) {
  if (zones.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">
        Henüz bölge yok. “Yeni bölge” ile haritada çizerek başlayın.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {zones.map((zone) => (
        <li key={zone.id}>
          <div
            data-zone-id={zone.id}
            className={`rounded-lg border bg-white p-3 ${
              zone.id === selectedId ? "border-zinc-900 ring-1 ring-zinc-900" : "border-zinc-200"
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(zone.id)}
              className="flex w-full items-center gap-2 text-left"
            >
              <span
                aria-hidden
                className="h-4 w-4 shrink-0 rounded-sm ring-1 ring-black/10"
                style={{ backgroundColor: zone.color }}
              />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">{zone.name}</span>
              <span className="shrink-0 text-xs text-zinc-500">{zone.active_count} kişi</span>
            </button>
            {zone.note && <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{zone.note}</p>}
            {renderZoneExtra?.(zone)}
          </div>
        </li>
      ))}
    </ul>
  );
}
