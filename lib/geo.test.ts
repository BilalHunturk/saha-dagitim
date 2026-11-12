import { describe, expect, it } from "vitest";
import { polygonsBounds, validatePolygon } from "./geo";

const square = (x: number, y: number, size = 0.01): GeoJSON.Polygon => ({
  type: "Polygon",
  coordinates: [
    [
      [x, y],
      [x + size, y],
      [x + size, y + size],
      [x, y + size],
      [x, y],
    ],
  ],
});

describe("validatePolygon", () => {
  it("accepts a valid closed square", () => {
    const poly = square(32.85, 39.93);
    const result = validatePolygon(poly);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.polygon).toEqual(poly);
  });

  it("rejects a non-Polygon type", () => {
    expect(validatePolygon({ type: "Point", coordinates: [32.85, 39.93] }).ok).toBe(false);
  });

  it("rejects a ring with only 3 positions", () => {
    const poly = {
      type: "Polygon",
      coordinates: [
        [
          [32.85, 39.93],
          [32.86, 39.93],
          [32.85, 39.93],
        ],
      ],
    };
    expect(validatePolygon(poly).ok).toBe(false);
  });

  it("rejects an unclosed ring", () => {
    const poly = {
      type: "Polygon",
      coordinates: [
        [
          [32.85, 39.93],
          [32.86, 39.93],
          [32.86, 39.94],
          [32.85, 39.94],
        ],
      ],
    };
    expect(validatePolygon(poly).ok).toBe(false);
  });

  it("rejects a polygon with a hole (2 rings)", () => {
    const outer = square(32.8, 39.9, 0.1).coordinates[0];
    const hole = square(32.82, 39.92, 0.01).coordinates[0];
    expect(validatePolygon({ type: "Polygon", coordinates: [outer, hole] }).ok).toBe(false);
  });

  it("rejects latitude 95", () => {
    const poly = {
      type: "Polygon",
      coordinates: [
        [
          [32.85, 95],
          [32.86, 95],
          [32.86, 39.94],
          [32.85, 39.94],
          [32.85, 95],
        ],
      ],
    };
    expect(validatePolygon(poly).ok).toBe(false);
  });

  it("returns an error message when invalid", () => {
    const result = validatePolygon(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeTypeOf("string");
  });
});

describe("polygonsBounds", () => {
  it("returns the combined [[west,south],[east,north]] of two squares", () => {
    const a = square(32.8, 39.9, 0.01);
    const b = square(32.9, 39.95, 0.02);
    const bounds = polygonsBounds([a, b]);
    expect(bounds).not.toBeNull();
    const [[w, s], [e, n]] = bounds!;
    expect(w).toBeCloseTo(32.8);
    expect(s).toBeCloseTo(39.9);
    expect(e).toBeCloseTo(32.92);
    expect(n).toBeCloseTo(39.97);
  });

  it("returns null for an empty list", () => {
    expect(polygonsBounds([])).toBeNull();
  });
});
