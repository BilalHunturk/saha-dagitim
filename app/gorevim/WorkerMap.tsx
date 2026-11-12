"use client";

import type { GeolocateControl, Map as MapLibreMap } from "maplibre-gl";
import { useCallback, useEffect, useRef, useState } from "react";
import { ZoneLayer } from "@/app/yonetim/ZoneLayer";
import { BaseMap } from "@/components/map/BaseMap";
import { BasemapToggle, useStoredBasemap } from "@/components/map/BasemapToggle";
import { polygonsBounds } from "@/lib/geo";
import type { Zone } from "@/lib/types";
import { zonesKey } from "@/lib/worker-refresh";
import { LastUpdated, RefreshButton } from "./RefreshControls";
import { useWorkerRefresh } from "./useWorkerRefresh";

const FIT = { padding: 48, maxZoom: 17 } as const;

/**
 * The worker's assigned zones on a full-height map, with a scrollable list underneath.
 * "Konumumu göster" uses MapLibre's GeolocateControl: the position only drives the dot on this
 * screen and is never sent anywhere.
 *
 * The data is re-read in place (useWorkerRefresh). A refresh that brings the same zones leaves
 * the map view, basemap and selection alone; one that adds, removes or reshapes zones refits.
 */
export function WorkerMap({ zones, fetchedAt }: { zones: Zone[]; fetchedAt: string }) {
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [basemap, setBasemap] = useStoredBasemap();
  const [chosenId, setSelectedId] = useState<string | null>(null);
  // A selected zone that was withdrawn on refresh is simply no longer selected.
  const selectedId = chosenId !== null && zones.some((z) => z.id === chosenId) ? chosenId : null;
  const { refresh, pending, offline } = useWorkerRefresh();
  const key = zonesKey(zones);
  const fittedKey = useRef<string | null>(null);
  const [geoReady, setGeoReady] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const geoRef = useRef<GeolocateControl | null>(null);
  const zonesRef = useRef(zones);
  const mounted = useRef(true);

  useEffect(() => {
    zonesRef.current = zones;
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      geoRef.current = null;
    };
  }, []);

  const fitAll = useCallback((m: MapLibreMap, animate: boolean) => {
    const bounds = polygonsBounds(zonesRef.current.map((z) => z.geojson));
    if (bounds) m.fitBounds(bounds, { ...FIT, animate });
  }, []);

  // Refit only when the set of zones or a shape changed (not on every refresh).
  useEffect(() => {
    if (!map) return;
    if (fittedKey.current !== null && fittedKey.current !== key) fitAll(map, true);
    fittedKey.current = key;
  }, [map, key, fitAll]);

  const handleReady = useCallback(
    (m: MapLibreMap) => {
      setMap(m);
      fitAll(m, false);

      import("maplibre-gl").then(({ GeolocateControl }) => {
        if (!mounted.current) return;
        const control = new GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: true,
        });
        control.on("trackuserlocationstart", () => setTracking(true));
        control.on("trackuserlocationend", () => setTracking(false));
        control.on("geolocate", () => setGeoError(null));
        control.on("error", (e) => {
          if (e.code === 1) {
            // PERMISSION_DENIED: MapLibre stops watching.
            setTracking(false);
            setGeoError("Konum izni verilmedi");
          } else {
            setGeoError("Konum alınamadı");
          }
        });
        m.addControl(control, "top-right");
        geoRef.current = control;
        setGeoReady(true);
      });
    },
    [fitAll],
  );

  function showLocation() {
    if (!("geolocation" in navigator)) {
      setGeoError("Bu cihazda konum kullanılamıyor");
      return;
    }
    setGeoError(null);
    geoRef.current?.trigger();
  }

  function focusZone(zone: Zone) {
    setSelectedId(zone.id);
    const bounds = polygonsBounds([zone.geojson]);
    if (map && bounds) map.fitBounds(bounds, FIT);
  }

  const onZoneClick = useCallback((id: string) => {
    setSelectedId(id);
    document.querySelector(`[data-zone-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
  }, []);

  return (
    <div className="flex flex-1 flex-col">
      <BaseMap
        basemap={basemap}
        onReady={handleReady}
        // MapLibre's own buttons enlarged to 44px; its geolocate button is replaced by ours.
        // `!` because maplibre-gl.css is unlayered and so beats Tailwind's utilities layer.
        className="min-h-64 flex-1 [&_.maplibregl-ctrl-group:has(.maplibregl-ctrl-geolocate)]:hidden! [&_.maplibregl-ctrl-group_button]:size-11!"
      >
        {map && <ZoneLayer map={map} zones={zones} selectedId={selectedId} onZoneClick={onZoneClick} />}
        {/* Top left, so nothing covers the attribution at the bottom (expanded on phones). */}
        <div className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-5rem)] flex-col items-start gap-2">
          <BasemapToggle value={basemap} onChange={setBasemap} className="[&_button]:min-h-11 [&_button]:px-4" />
          <button
            type="button"
            onClick={showLocation}
            disabled={!geoReady}
            aria-pressed={tracking}
            className={`min-h-11 rounded-lg px-4 text-sm font-semibold shadow-md ring-1 ring-black/10 disabled:opacity-60 ${
              tracking ? "bg-blue-600 text-white" : "bg-white text-zinc-900"
            }`}
          >
            Konumumu göster
          </button>
          {geoError && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 shadow-md">
              {geoError}
            </p>
          )}
        </div>
      </BaseMap>

      <section aria-label="Bölgelerim" className="max-h-[40dvh] overflow-y-auto border-t border-zinc-200 bg-white">
        <div className="sticky top-0 flex items-center gap-1 border-b border-zinc-100 bg-white pr-2 pl-4">
          <div className="min-w-0 py-1">
            <h2 className="text-sm font-semibold text-zinc-800">Bölgelerim ({zones.length})</h2>
            <LastUpdated fetchedAt={fetchedAt} offline={offline} />
          </div>
          <div className="ml-auto flex shrink-0 items-center">
            <RefreshButton onClick={refresh} pending={pending} />
            <button
              type="button"
              onClick={() => {
                setSelectedId(null);
                if (map) fitAll(map, true);
              }}
              className="min-h-11 px-2 text-sm font-medium text-blue-700"
            >
              Tümünü göster
            </button>
          </div>
        </div>
        <ul className="divide-y divide-zinc-100">
          {zones.map((zone) => (
            <li key={zone.id}>
              <button
                type="button"
                data-zone-id={zone.id}
                aria-current={zone.id === selectedId ? "true" : undefined}
                onClick={() => focusZone(zone)}
                className={`flex min-h-11 w-full items-start gap-3 px-4 py-3 text-left ${
                  zone.id === selectedId ? "bg-zinc-100" : "active:bg-zinc-50"
                }`}
              >
                <span
                  aria-hidden="true"
                  className="mt-1 size-3.5 shrink-0 rounded-sm ring-1 ring-black/10"
                  style={{ backgroundColor: zone.color }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-medium text-zinc-900">{zone.name}</span>
                  {zone.note && (
                    <span className="block whitespace-pre-line break-words text-sm text-zinc-600">{zone.note}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
