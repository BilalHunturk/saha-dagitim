"use client";

import {
  DndContext,
  DragOverlay,
  TouchSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useCallback, useMemo, useOptimistic, useRef, useState, useTransition, type ReactNode } from "react";
import { BaseMap } from "@/components/map/BaseMap";
import { BasemapToggle, useStoredBasemap } from "@/components/map/BasemapToggle";
import { applyAssignmentOp, resolveDrop, zonesOfWorker, type AssignmentOp, type DropIntent } from "@/lib/assignments";
import { polygonsBounds } from "@/lib/geo";
import { LOGIN_MESSAGES } from "@/lib/login";
import type { Assignment, Profile, Zone } from "@/lib/types";
import { AssignDialog, ZonePicker } from "./AssignDialog";
import { assignWorker, moveWorker, unassignWorker } from "./assignment-actions";
import { AssignmentChip } from "./AssignmentChip";
import {
  ANNOUNCEMENTS,
  MAP_DROP_ID,
  MOUSE_DRAG_ACTIVATION,
  MousePenSensor,
  SCREEN_READER_INSTRUCTIONS,
  TOUCH_DRAG_ACTIVATION,
  pointerPosition,
  zoneIdFromDropId,
  type DragData,
} from "./dnd";
import { PeoplePanel } from "./PeoplePanel";
import { usePeopleColumn } from "./usePeopleColumn";
import { ZoneEditor, type ZoneEditorTarget } from "./ZoneEditor";
import { ZONE_LAYER_IDS, ZoneLayer, ensureZoneLayers } from "./ZoneLayer";
import { ZoneList } from "./ZoneList";

type Props = { zones: Zone[]; people: Profile[]; assignments: Assignment[] };

/** What the editor is working on. An edit holds only the id; the zone comes from props. */
type Editor = { kind: "new" } | { kind: "edit"; zoneId: string } | null;
type Tab = "zones" | "people";
type Ask = Extract<DropIntent, { kind: "ask" }>;

export function AdminBoard({ zones, people, assignments }: Props) {
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [basemap, setBasemap] = useStoredBasemap();
  const [editor, setEditor] = useState<Editor>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [tab, setTab] = useState<Tab>("zones");
  const [peopleColumn, setPeopleColumn] = usePeopleColumn();

  // Assignments with in-flight changes applied. When a change's transition ends, React drops the
  // optimistic layer: on success the revalidated props already contain it, on failure it rolls back.
  const [optimistic, addOptimistic] = useOptimistic(assignments, applyAssignmentOp);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [pickWorkerId, setPickWorkerId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<DragData | null>(null);
  const [mapDropZoneId, setMapDropZoneId] = useState<string | null>(null);
  const zonesScrollRef = useRef<HTMLDivElement>(null);

  const editZone = editor?.kind === "edit" ? zones.find((z) => z.id === editor.zoneId) ?? null : null;
  // An archived (or otherwise vanished) zone simply drops out of edit mode.
  const target: ZoneEditorTarget | null =
    editor?.kind === "new" ? { kind: "new" } : editZone ? { kind: "edit", zone: editZone } : null;

  const nameById = useMemo(() => new Map(people.map((p) => [p.id, p.full_name])), [people]);
  const zoneById = useMemo(() => new Map(zones.map((z) => [z.id, z])), [zones]);

  /** Zones with their person count taken from the optimistic assignments. */
  const zonesView = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of optimistic) if (a.ended_at === null) counts.set(a.zone_id, (counts.get(a.zone_id) ?? 0) + 1);
    return zones.map((z) => ({ ...z, active_count: counts.get(z.id) ?? 0 }));
  }, [zones, optimistic]);

  const chipsByZone = useMemo(() => {
    const byZone = new Map<string, { id: string; name: string }[]>();
    for (const a of optimistic) {
      if (a.ended_at !== null) continue;
      const list = byZone.get(a.zone_id) ?? [];
      list.push({ id: a.worker_id, name: nameById.get(a.worker_id) ?? "Bilinmeyen kişi" });
      byZone.set(a.zone_id, list);
    }
    for (const list of byZone.values()) list.sort((x, y) => x.name.localeCompare(y.name, "tr"));
    return byZone;
  }, [optimistic, nameById]);

  // ---- Assignment changes -------------------------------------------------------------------

  const run = useCallback(
    (op: AssignmentOp) => {
      setError(null);
      startTransition(async () => {
        addOptimistic(op);
        // A rejected action (network drop, timeout, session check failed) must not reach the error
        // boundary, which would replace the whole board. It is shown like any other failure; the
        // optimistic change is dropped when the transition ends.
        let result: { ok: true } | { ok: false; error: string };
        try {
          result =
            op.kind === "assign"
              ? await assignWorker(op.workerId, op.zoneId)
              : op.kind === "unassign"
                ? await unassignWorker(op.workerId, op.zoneId)
                : await moveWorker(op.workerId, op.fromZoneId, op.toZoneId);
        } catch (e) {
          console.error("assignment action failed", e);
          result = { ok: false, error: LOGIN_MESSAGES.CONNECTION };
        }
        if (!result.ok) setError(result.error);
      });
    },
    [addOptimistic],
  );

  const handleIntent = useCallback(
    (intent: DropIntent) => {
      if (intent.kind === "assign") run(intent);
      else if (intent.kind === "move") run(intent);
      else if (intent.kind === "ask") setAsk(intent);
    },
    [run],
  );

  const dropOn = useCallback(
    (drag: DragData, zoneId: string) => handleIntent(resolveDrop(optimistic, drag, zoneId)),
    [handleIntent, optimistic],
  );

  // ---- Drag and drop ------------------------------------------------------------------------

  const sensors = useSensors(
    useSensor(MousePenSensor, { activationConstraint: MOUSE_DRAG_ACTIVATION }),
    useSensor(TouchSensor, { activationConstraint: TOUCH_DRAG_ACTIVATION }),
  );

  /**
   * Pointer-inside collisions, but a zone card only counts where the zone list is actually visible
   * (a card scrolled out of its panel still has a rect, which may lie over the map or the header).
   */
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const hits = pointerWithin(args);
    const p = args.pointerCoordinates;
    const box = zonesScrollRef.current?.getBoundingClientRect();
    return hits.filter(
      (hit) =>
        hit.id === MAP_DROP_ID ||
        (!!p && !!box && p.x >= box.left && p.x <= box.right && p.y >= box.top && p.y <= box.bottom),
    );
  }, []);

  /** The zone polygon under the pointer, if the pointer is over the map. */
  const zoneUnderPointer = useCallback(
    (e: DragMoveEvent | DragEndEvent) => {
      if (!map || e.over?.id !== MAP_DROP_ID) return null;
      const p = pointerPosition(e.activatorEvent, e.delta);
      if (!p) return null;
      const rect = map.getCanvas().getBoundingClientRect();
      const features = map.queryRenderedFeatures([p.x - rect.left, p.y - rect.top], {
        layers: [ZONE_LAYER_IDS.fill],
      });
      const id = features[0]?.properties?.id;
      return typeof id === "string" ? id : null;
    },
    [map],
  );

  const onDragStart = (e: DragStartEvent) => {
    setDragging((e.active.data.current as DragData | undefined) ?? null);
    setError(null);
  };

  const onDragMove = (e: DragMoveEvent) => {
    const id = zoneUnderPointer(e);
    setMapDropZoneId((prev) => (prev === id ? prev : id));
  };

  const onDragEnd = (e: DragEndEvent) => {
    const drag = e.active.data.current as DragData | undefined;
    const zoneId = zoneIdFromDropId(e.over?.id) ?? zoneUnderPointer(e);
    setDragging(null);
    setMapDropZoneId(null);
    if (drag && zoneId && zoneById.has(zoneId)) dropOn(drag, zoneId);
  };

  const onDragCancel = () => {
    setDragging(null);
    setMapDropZoneId(null);
  };

  // ---- Zone editing -------------------------------------------------------------------------

  const selectZone = useCallback(
    (id: string) => {
      setEditor({ kind: "edit", zoneId: id });
      setTab("zones");
      setPanelOpen(true);
      const zone = zones.find((z) => z.id === id);
      const bounds = zone && polygonsBounds([zone.geojson]);
      if (map && bounds) map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 500 });
    },
    [map, zones],
  );

  const startNew = () => {
    setEditor({ kind: "new" });
    setTab("zones");
    setPanelOpen(true);
  };

  /** Phone tabs: tapping the open tab collapses / expands the sheet; the other tab switches to it. */
  const onTab = (t: Tab) => {
    if (t === tab) setPanelOpen((o) => !o);
    else {
      setTab(t);
      setPanelOpen(true);
    }
  };

  const activePeople = useMemo(() => people.filter((p) => p.active), [people]);
  const askWorker = ask ? nameById.get(ask.workerId) ?? "Kişi" : "";
  const zoneRef = (id: string) => {
    const z = zoneById.get(id);
    return z ? { id: z.id, name: z.name, color: z.color } : null;
  };
  const pickName = pickWorkerId ? nameById.get(pickWorkerId) ?? "Kişi" : "";
  const collapsed = panelOpen ? "" : "max-md:hidden";

  return (
    <DndContext
      // A fixed id keeps dnd-kit's aria-describedby ids the same on server and client (no hydration mismatch).
      id="admin-board-dnd"
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
      accessibility={{ announcements: ANNOUNCEMENTS, screenReaderInstructions: SCREEN_READER_INSTRUCTIONS }}
    >
      <div className="relative min-h-[480px] flex-1">
        {/*
          Phone: map, tabs, then the open tab's panel (a bottom sheet).
          md: the panel column (tabs + open tab) on the left, map on the right.
          lg: zones on the left, map, people on the right; no tabs.
        */}
        <div
          className={`absolute inset-0 grid grid-cols-1 grid-rows-[minmax(0,1fr)_auto_auto] md:grid-cols-[360px_minmax(0,1fr)] md:grid-rows-[auto_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] ${
            peopleColumn === "open"
              ? "lg:grid-cols-[360px_minmax(0,1fr)_300px]"
              : peopleColumn === "closed"
                ? "lg:grid-cols-[360px_minmax(0,1fr)]"
                : "lg:grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)_300px]"
          }`}
        >
          <div
            className="row-start-2 flex border-t border-zinc-200 bg-white md:col-start-1 md:row-start-1 md:border-t-0 md:border-r lg:hidden"
            aria-label="Panel sekmeleri"
          >
            <TabButton active={tab === "zones"} open={panelOpen} onClick={() => onTab("zones")}>
              Bölgeler <span className="font-normal text-zinc-500">({zones.length})</span>
            </TabButton>
            <TabButton active={tab === "people"} open={panelOpen} onClick={() => onTab("people")}>
              Kişiler <span className="font-normal text-zinc-500">({activePeople.length})</span>
            </TabButton>
          </div>

          <aside
            aria-label="Bölgeler paneli"
            className={`row-start-3 flex max-h-[40dvh] min-h-0 flex-col border-t border-zinc-200 bg-zinc-50 md:col-start-1 md:row-start-2 md:max-h-none md:border-t-0 md:border-r lg:row-start-1 ${
              tab === "zones" ? "" : "max-lg:hidden"
            }`}
          >
            <div className="flex items-center gap-2 border-b border-zinc-200 bg-white px-4 py-2">
              <h2 className="hidden text-sm font-semibold text-zinc-900 lg:block">
                Bölgeler <span className="font-normal text-zinc-500">({zones.length})</span>
              </h2>
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

            <div ref={zonesScrollRef} className={`min-h-0 flex-1 overflow-y-auto p-4 ${collapsed}`}>
              {target && map ? (
                <ZoneEditor
                  key={target.kind === "edit" ? target.zone.id : "new"}
                  map={map}
                  target={target}
                  onClose={() => setEditor(null)}
                />
              ) : (
                <ZoneList
                  zones={zonesView}
                  selectedId={null}
                  onSelect={selectZone}
                  renderZoneExtra={(zone) => {
                    const chips = chipsByZone.get(zone.id);
                    if (!chips?.length) return null;
                    return (
                      <ul aria-label="Atanan kişiler" className="mt-2 flex flex-wrap gap-1">
                        {chips.map((p) => (
                          <AssignmentChip
                            key={p.id}
                            workerId={p.id}
                            zoneId={zone.id}
                            name={p.name}
                            onRemove={() => run({ kind: "unassign", workerId: p.id, zoneId: zone.id })}
                          />
                        ))}
                      </ul>
                    );
                  }}
                />
              )}
            </div>
          </aside>

          <aside
            id="people-column"
            aria-label="Kişiler paneli"
            className={`row-start-3 flex max-h-[40dvh] min-h-0 flex-col border-t border-zinc-200 bg-zinc-50 md:col-start-1 md:row-start-2 md:max-h-none md:border-t-0 md:border-r lg:col-start-3 lg:row-start-1 lg:border-r-0 lg:border-l ${
              tab === "people" ? "" : "max-lg:hidden"
            } ${peopleColumn === "open" ? "" : peopleColumn === "closed" ? "lg:hidden" : "lg:max-xl:hidden"}`}
          >
            {/* Hidden with CSS, not unmounted, so the search and the filter survive a collapse. */}
            <div className="hidden items-center border-b border-zinc-200 bg-white py-1.5 pr-2 pl-4 lg:flex">
              <h2 className="flex-1 text-sm font-semibold text-zinc-900">
                Kişiler <span className="font-normal text-zinc-500">({activePeople.length})</span>
              </h2>
              <button
                type="button"
                onClick={() => setPeopleColumn(false)}
                aria-controls="people-column"
                aria-expanded
                aria-label="Kişiler sütununu gizle"
                title="Haritaya yer açmak için kişiler sütununu gizle"
                className="rounded-md px-2 py-1 text-sm font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
              >
                Gizle <span aria-hidden>▸</span>
              </button>
            </div>
            <div className={`flex min-h-0 flex-1 flex-col ${collapsed}`}>
              <PeoplePanel people={people} zones={zones} assignments={optimistic} onPick={setPickWorkerId} />
            </div>
          </aside>

          <MapDropArea
            disabled={!!editor}
            className="row-start-1 md:col-start-2 md:row-span-2 md:row-start-1 lg:row-span-1"
          >
            <BaseMap basemap={basemap} onReady={setMap} onStyleReload={ensureZoneLayers} className="h-full w-full">
              <BasemapToggle value={basemap} onChange={setBasemap} className="absolute top-3 left-3 z-10" />
              {/* lg+ only: brings the collapsed people column back (left of the zoom buttons). */}
              <button
                type="button"
                onClick={() => setPeopleColumn(true)}
                aria-controls="people-column"
                aria-expanded={false}
                aria-label="Kişiler sütununu göster"
                className={`absolute top-3 right-12 z-10 items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 shadow-md ring-1 ring-black/10 hover:bg-zinc-100 ${
                  peopleColumn === "open" ? "hidden" : peopleColumn === "closed" ? "hidden lg:inline-flex" : "hidden lg:max-xl:inline-flex"
                }`}
              >
                <span aria-hidden>◂</span> Kişiler <span className="font-normal text-zinc-500">({activePeople.length})</span>
              </button>
              {map && (
                <ZoneLayer
                  map={map}
                  zones={zones}
                  selectedId={editZone?.id ?? mapDropZoneId}
                  hiddenId={editZone?.id ?? null}
                  onZoneClick={editor ? null : selectZone}
                />
              )}
            </BaseMap>

            {dragging && (
              // Swallows pointer events while dragging, so the map (and terra-draw) never sees the drop.
              <div className="absolute inset-0 z-20 flex items-start justify-center bg-black/5 p-3">
                <p className="rounded-lg bg-white/95 px-3 py-1.5 text-sm text-zinc-800 shadow">
                  {editor
                    ? "Bölge düzenlenirken haritaya bırakılamaz"
                    : mapDropZoneId
                      ? `Bırak: ${zoneById.get(mapDropZoneId)?.name ?? ""}`
                      : "Kişiyi bir bölgenin üzerine bırakın"}
                </p>
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="absolute top-14 left-1/2 z-30 flex w-[min(92%,28rem)] -translate-x-1/2 items-start gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm text-white shadow-lg"
              >
                <span className="flex-1">{error}</span>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  aria-label="Hata iletisini kapat"
                  className="rounded px-1 text-white/80 hover:text-white"
                >
                  Kapat
                </button>
              </div>
            )}
          </MapDropArea>
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className="pointer-events-none inline-flex rounded-full bg-zinc-900 px-3 py-1 text-sm font-medium whitespace-nowrap text-white shadow-lg">
            {dragging.name}
          </div>
        )}
      </DragOverlay>

      {ask &&
        (() => {
          const targetZone = zoneRef(ask.zoneId);
          const current = ask.currentZoneIds.map(zoneRef).filter((z) => z !== null);
          if (!targetZone) return null;
          return (
            <AssignDialog
              workerName={askWorker}
              target={targetZone}
              current={current}
              onAdd={() => {
                setAsk(null);
                run({ kind: "assign", workerId: ask.workerId, zoneId: ask.zoneId });
              }}
              onMove={(fromZoneId) => {
                setAsk(null);
                run({ kind: "move", workerId: ask.workerId, fromZoneId, toZoneId: ask.zoneId });
              }}
              onCancel={() => setAsk(null)}
            />
          );
        })()}

      {pickWorkerId && (
        <ZonePicker
          workerName={pickName}
          zones={zones.map((z) => ({ id: z.id, name: z.name, color: z.color }))}
          assignedZoneIds={zonesOfWorker(optimistic, pickWorkerId)}
          onPick={(zoneId) => {
            const workerId = pickWorkerId;
            setPickWorkerId(null);
            dropOn({ workerId, fromZoneId: null, name: pickName }, zoneId);
          }}
          onCancel={() => setPickWorkerId(null)}
        />
      )}
    </DndContext>
  );
}

function TabButton({
  active,
  open,
  onClick,
  children,
}: {
  active: boolean;
  open: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-expanded={active ? open : undefined}
      className={`flex flex-1 items-center justify-center gap-1 border-b-2 px-3 py-2 text-sm font-semibold ${
        active ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-800"
      }`}
    >
      {active && (
        <span aria-hidden className="text-zinc-500 md:hidden">
          {open ? "▾" : "▴"}
        </span>
      )}
      {children}
    </button>
  );
}

/** The map's wrapper, registered as one droppable; the polygon is found at drop time. */
function MapDropArea({ disabled, className, children }: { disabled: boolean; className: string; children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id: MAP_DROP_ID, disabled });
  return (
    <div ref={setNodeRef} className={`relative min-h-0 ${className}`}>
      {children}
    </div>
  );
}
