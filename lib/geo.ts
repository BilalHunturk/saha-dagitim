/**
 * GeoJSON helpers. Coordinates are always [longitude, latitude] (SRID 4326).
 */

export type PolygonResult =
  | { ok: true; polygon: GeoJSON.Polygon }
  | { ok: false; error: string };

function fail(error: string): PolygonResult {
  return { ok: false, error };
}

/**
 * Checks that input is a single-ring GeoJSON Polygon (no holes) with a closed ring
 * of at least 4 positions and in-range coordinates. Returns a clean 2D copy.
 */
export function validatePolygon(input: unknown): PolygonResult {
  if (typeof input !== "object" || input === null) return fail("Geçersiz geometri.");
  const geom = input as { type?: unknown; coordinates?: unknown };
  if (geom.type !== "Polygon") return fail("Geometri bir çokgen olmalı.");
  if (!Array.isArray(geom.coordinates) || geom.coordinates.length !== 1) {
    return fail("Çokgen tek halkadan oluşmalı (delik olamaz).");
  }

  const ring = geom.coordinates[0];
  if (!Array.isArray(ring) || ring.length < 4) {
    return fail("Çokgen en az 3 köşeden oluşmalı.");
  }

  const positions: [number, number][] = [];
  for (const pos of ring) {
    if (!Array.isArray(pos) || pos.length < 2) return fail("Geçersiz koordinat.");
    const [lng, lat] = pos;
    if (typeof lng !== "number" || typeof lat !== "number" || !Number.isFinite(lng) || !Number.isFinite(lat)) {
      return fail("Geçersiz koordinat.");
    }
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      return fail("Koordinat aralık dışında.");
    }
    positions.push([lng, lat]);
  }

  const first = positions[0];
  const last = positions[positions.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    return fail("Çokgen halkası kapalı olmalı.");
  }

  return { ok: true, polygon: { type: "Polygon", coordinates: [positions] } };
}

/** Combined bounds of polygons as [[west, south], [east, north]], or null when empty. */
export function polygonsBounds(
  polys: GeoJSON.Polygon[],
): [[number, number], [number, number]] | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  for (const poly of polys) {
    for (const ring of poly.coordinates) {
      for (const [lng, lat] of ring) {
        if (lng < west) west = lng;
        if (lng > east) east = lng;
        if (lat < south) south = lat;
        if (lat > north) north = lat;
      }
    }
  }

  return Number.isFinite(west) ? [[west, south], [east, north]] : null;
}
