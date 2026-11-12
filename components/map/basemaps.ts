import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";

export type BasemapId = "satellite" | "streets";

export const BASEMAP_IDS: readonly BasemapId[] = ["satellite", "streets"];

export const BASEMAP_LABELS: Record<BasemapId, string> = {
  satellite: "Uydu",
  streets: "Sokak",
};

/** Ankara city centre, [lng, lat]. */
export const ANKARA_CENTER: [number, number] = [32.8597, 39.9334];
export const ANKARA_ZOOM = 11;

const ESRI_IMAGERY =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

const SATELLITE_URL = process.env.NEXT_PUBLIC_SATELLITE_TILE_URL || ESRI_IMAGERY;
const SATELLITE_ATTRIBUTION = process.env.NEXT_PUBLIC_SATELLITE_TILE_URL
  ? "Uydu görüntüsü: yapılandırılmış sağlayıcı"
  : "Uydu: © Esri, Maxar, Earthstar Geographics ve GIS kullanıcı topluluğu";

/** Raster layer id of a basemap; the source has the same id. */
export const basemapLayerId = (id: BasemapId) => `basemap-${id}`;

/**
 * A raster style that holds both basemaps; only `id` is visible.
 *
 * Both are in one style so switching is a layer-visibility change (see `showBasemap`), not a
 * `setStyle`, which would drop the zone layers and terra-draw's in-progress drawing.
 */
export function basemapStyle(id: BasemapId): StyleSpecification {
  return {
    version: 8,
    sources: {
      [basemapLayerId("satellite")]: {
        type: "raster",
        tiles: [SATELLITE_URL],
        tileSize: 256,
        maxzoom: 19,
        attribution: SATELLITE_ATTRIBUTION,
      },
      [basemapLayerId("streets")]: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> katkıcıları',
      },
    },
    layers: BASEMAP_IDS.map((b) => ({
      id: basemapLayerId(b),
      type: "raster" as const,
      source: basemapLayerId(b),
      layout: { visibility: b === id ? ("visible" as const) : ("none" as const) },
    })),
  };
}

/** Makes `id` the only visible basemap layer. Overlay layers are untouched. */
export function showBasemap(map: MapLibreMap, id: BasemapId) {
  for (const b of BASEMAP_IDS) {
    map.setLayoutProperty(basemapLayerId(b), "visibility", b === id ? "visible" : "none");
  }
}

export const BASEMAP_STORAGE_KEY = "saha.basemap";

export function isBasemapId(value: unknown): value is BasemapId {
  return value === "satellite" || value === "streets";
}
