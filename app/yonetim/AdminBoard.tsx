"use client";

import type { Map as MapLibreMap } from "maplibre-gl";
import { useCallback, useMemo, useState } from "react";
import { BaseMap } from "@/components/map/BaseMap";
import { BasemapToggle, useStoredBasemap } from "@/components/map/BasemapToggle";
import { polygonsBounds } from "@/lib/geo";
import type { Assignment, Profile, Zone } from "@/lib/types";
import { ZoneEditor, type ZoneEditorTarget } from "./ZoneEditor";
import { ZoneLayer, ensureZoneLayers } from "./ZoneLayer";
import { ZoneList } from "./ZoneList";

type Props = { zones: Zone[]; people: Profile[]; assignments: Assignment[] };

/** What the editor is working on. An edit holds only the id; the zone comes from props. */
type Editor = { kind: "new" } | { kind: "edit"; zoneId: string } | null;

export function AdminBoard({ zones, people, assignments }: Props) {
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [basemap, setBasemap] = useStoredBasemap();
  const [editor, setEditor] = useState<Editor>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  const editZone = editor?.kind === "edit" ? zones.find((z) => z.id === editor.zoneId) ?? null : null;
  // An archived (or otherwise vanished) zone simply drops out of edit mode.
  const target: ZoneEditorTarget | null =
    editor?.kind === "new" ? { kind: "new" } : editZone ? { kind: "edit", zone: editZone } : null;

  const namesByZone = useMemo(() => {
    const names = new Map(people.map((p) => [p.id, p.full_name]));
    const byZone = new Map<string, { id: string; name: string }[]>();
    for (const a of assignments) {
      if (a.ended_at) continue;
      const list = byZone.get(a.zone_id) ?? [];
      list.push({ id: a.worker_id, name: names.get(a.worker_id) ?? "Bilinmeyen kişi" });
      byZone.set(a.zone_id, list);
    }
    for (const list of byZone.values()) list.sort((x, y) => x.name.localeCompare(y.name, "tr"));
    return byZone;
  }, [people, assignments]);

  const selectZone = useCallback(
    (id: string) => {
      setEditor({ kind: "edit", zoneId: id });
      setPanelOpen(true);
      const zone = zones.find((z) => z.id === id);
      const bounds = zone && polygonsBounds([zone.geojson]);
      if (map && bounds) map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 500 });
    },
    [map, zones],
  );

  const startNew = () => {
    setEditor({ kind: "new" });
    setPanelOpen(true);
  };

  return (
    <div className="relative min-h-[480px] flex-1">
      <div className="absolute inset-0 flex flex-col md:flex-row">
        <aside
          aria-label="Bölgeler paneli"
          className="order-2 flex max-h-[55%] shrink-0 flex-col border-t border-zinc-200 bg-zinc-50 md:order-1 md:max-h-none md:w-[360px] md:border-t-0 md:border-r"
        >
          <div className="flex items-center gap-2 border-b border-zinc-200 bg-white px-4 py-2">
            <button
              type="button"
              onClick={() => setPanelOpen((o) => !o)}
              aria-expanded={panelOpen}
              className="flex items-center gap-2 text-sm font-semibold text-zinc-900 md:pointer-events-none"
            >
              <span aria-hidden className="text-zinc-500 md:hidden">
                {panelOpen ? "▾" : "▴"}
              </span>
              Bölgeler <span className="font-normal text-zinc-500">({zones.length})</span>
            </button>
            {!editor && (
              <button
                type="button"
                onClick={startNew}
                disabled={!map}
                className="ml-auto rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
              >
                Yeni bölge
              </button>
            )}
          </div>

          <div className={`min-h-0 flex-1 overflow-y-auto p-4 ${panelOpen ? "" : "hidden md:block"}`}>
            {target && map ? (
              <ZoneEditor
                key={target.kind === "edit" ? target.zone.id : "new"}
                map={map}
                target={target}
                onClose={() => setEditor(null)}
              />
            ) : (
              <ZoneList
                zones={zones}
                selectedId={null}
                onSelect={selectZone}
                renderZoneExtra={(zone) => {
                  const assigned = namesByZone.get(zone.id);
                  if (!assigned?.length) return null;
                  return (
                    <ul aria-label="Atanan kişiler" className="mt-2 flex flex-wrap gap-1">
                      {assigned.map((p) => (
                        <li
                          key={p.id}
                          className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700"
                        >
                          {p.name}
                        </li>
                      ))}
                    </ul>
                  );
                }}
              />
            )}
          </div>
        </aside>

        <BaseMap
          basemap={basemap}
          onReady={setMap}
          onStyleReload={ensureZoneLayers}
          className="order-1 min-h-0 flex-1 md:order-2"
        >
          <BasemapToggle value={basemap} onChange={setBasemap} className="absolute top-3 left-3 z-10" />
          {map && (
            <ZoneLayer
              map={map}
              zones={zones}
              selectedId={editZone?.id ?? null}
              hiddenId={editZone?.id ?? null}
              onZoneClick={editor ? null : selectZone}
            />
          )}
        </BaseMap>
      </div>
    </div>
  );
}
