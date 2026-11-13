"use client";

import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent } from "maplibre-gl";
import { useEffect, useRef } from "react";
import type { Zone } from "@/lib/types";

export const ZONE_SOURCE_ID = "zones";
export const ZONE_LAYER_IDS = { fill: "zones-fill", line: "zones-line", label: "zones-label" } as const;

type Props = {
  map: MapLibreMap;
  zones: Zone[];
  selectedId: string | null;
  /** A zone not drawn here (terra-draw is showing it while it is being edited). */
  hiddenId?: string | null;
  /** Called when a polygon is clicked; null disables clicks (e.g. while drawing). */
  onZoneClick: ((id: string) => void) | null;
  /** Assigned people per zone; their names are drawn on the map under the zone name. */
  peopleByZone?: Map<string, { name: string }[]>;
};

const MAX_LABEL_NAMES = 8;

/** Text drawn under the zone name: one assigned person per line, capped so big zones stay readable. */
export function peopleLabel(names: string[]): string {
  if (names.length === 0) return "";
  const shown = names.slice(0, MAX_LABEL_NAMES);
  const rest = names.length - shown.length;
  const lines = rest > 0 ? [...shown, `+${rest} kişi`] : shown;
  return lines.map((line) => `\n${line}`).join("");
}

function toFeatureCollection(
  zones: Zone[],
  selectedId: string | null,
  hiddenId: string | null,
  peopleByZone?: Map<string, { name: string }[]>,
) {
  return {
    type: "FeatureCollection" as const,
    features: zones
      .filter((z) => z.id !== hiddenId)
      .map((z) => ({
        type: "Feature" as const,
        geometry: z.geojson,
        properties: {
          id: z.id,
          name: z.name,
          color: z.color,
          selected: z.id === selectedId,
          people: peopleLabel((peopleByZone?.get(z.id) ?? []).map((p) => p.name)),
        },
      })),
  };
}

/** Adds the zone source and layers if they are missing (idempotent; safe after a style reload). */
export function ensureZoneLayers(map: MapLibreMap) {
  if (!map.getSource(ZONE_SOURCE_ID)) {
    map.addSource(ZONE_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  }
  if (!map.getLayer(ZONE_LAYER_IDS.fill)) {
    map.addLayer({
      id: ZONE_LAYER_IDS.fill,
      type: "fill",
      source: ZONE_SOURCE_ID,
      paint: {
        "fill-color": ["get", "color"],
        "fill-opacity": ["case", ["get", "selected"], 0.45, 0.25],
      },
    });
  }
  if (!map.getLayer(ZONE_LAYER_IDS.line)) {
    map.addLayer({
      id: ZONE_LAYER_IDS.line,
      type: "line",
      source: ZONE_SOURCE_ID,
      paint: {
        "line-color": ["get", "color"],
        "line-width": ["case", ["get", "selected"], 4, 2],
      },
    });
  }
  if (!map.getLayer(ZONE_LAYER_IDS.label)) {
    // No `glyphs` URL in the style: MapLibre renders text with local fonts, so no font server.
    map.addLayer({
      id: ZONE_LAYER_IDS.label,
      type: "symbol",
      source: ZONE_SOURCE_ID,
      layout: {
        // Zone name small on top, assigned people's names larger below it.
        "text-field": [
          "format",
          ["get", "name"],
          { "font-scale": 0.85 },
          ["coalesce", ["get", "people"], ""],
          { "font-scale": 1.1 },
        ],
        "text-font": ["Arial", "Helvetica", "sans-serif"],
        "text-size": 13,
        "text-max-width": 14,
        "text-allow-overlap": true,
      },
      paint: {
        "text-color": "#18181b",
        "text-halo-color": "#ffffff",
        "text-halo-width": 2,
      },
    });
  }
}

/** Draws the active zones on the map. Renders nothing itself. */
export function ZoneLayer({ map, zones, selectedId, hiddenId = null, onZoneClick, peopleByZone }: Props) {
  const clickRef = useRef(onZoneClick);
  useEffect(() => {
    clickRef.current = onZoneClick;
  });

  useEffect(() => {
    ensureZoneLayers(map);

    const onClick = (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id;
      if (typeof id === "string") clickRef.current?.(id);
    };
    const onEnter = () => {
      if (clickRef.current) map.getCanvas().style.cursor = "pointer";
    };
    const onLeave = () => {
      map.getCanvas().style.cursor = "";
    };
    map.on("click", ZONE_LAYER_IDS.fill, onClick);
    map.on("mouseenter", ZONE_LAYER_IDS.fill, onEnter);
    map.on("mouseleave", ZONE_LAYER_IDS.fill, onLeave);
    return () => {
      map.off("click", ZONE_LAYER_IDS.fill, onClick);
      map.off("mouseenter", ZONE_LAYER_IDS.fill, onEnter);
      map.off("mouseleave", ZONE_LAYER_IDS.fill, onLeave);
    };
  }, [map]);

  useEffect(() => {
    ensureZoneLayers(map);
    map
      .getSource<GeoJSONSource>(ZONE_SOURCE_ID)
      ?.setData(toFeatureCollection(zones, selectedId, hiddenId, peopleByZone));
  }, [map, zones, selectedId, hiddenId, peopleByZone]);

  return null;
}
