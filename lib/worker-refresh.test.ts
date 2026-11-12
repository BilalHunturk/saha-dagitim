import { describe, expect, it } from "vitest";
import { formatClock, shouldAutoRefresh, zonesKey } from "./worker-refresh";

const square = (x: number): GeoJSON.Polygon => ({
  type: "Polygon",
  coordinates: [
    [
      [x, 39],
      [x + 1, 39],
      [x + 1, 40],
      [x, 40],
      [x, 39],
    ],
  ],
});
const zone = (id: string, x = 32, name = "A") => ({ id, name, color: "#e11d48", note: null, geojson: square(x), active_count: 1 });

describe("zonesKey", () => {
  it("is equal for a refetched copy of the same zones (new arrays and objects)", () => {
    expect(zonesKey([zone("a"), zone("b", 33)])).toBe(zonesKey([zone("a"), zone("b", 33)]));
  });

  it("ignores name, colour, note and count changes (no refit needed)", () => {
    const renamed = { ...zone("a"), name: "B", color: "#000000", note: "x", active_count: 3 };
    expect(zonesKey([renamed])).toBe(
      zonesKey([zone("a")]),
    );
  });

  it("changes when a zone is added, removed or reshaped", () => {
    const base = zonesKey([zone("a"), zone("b", 33)]);
    expect(zonesKey([zone("a")])).not.toBe(base);
    expect(zonesKey([zone("a"), zone("b", 33), zone("c", 34)])).not.toBe(base);
    expect(zonesKey([zone("a"), zone("b", 35)])).not.toBe(base);
  });
});

describe("formatClock", () => {
  it("shows HH:MM in Turkey time, whatever the server or phone time zone", () => {
    expect(formatClock("2026-11-12T07:05:00.000Z")).toBe("10:05");
    expect(formatClock("2026-11-12T21:59:30.000Z")).toBe("00:59");
  });
});

describe("shouldAutoRefresh", () => {
  it("refreshes when visible, online and not right after the previous refresh", () => {
    expect(shouldAutoRefresh({ visible: true, online: true, now: 10_000, lastAt: null })).toBe(true);
    expect(shouldAutoRefresh({ visible: true, online: true, now: 10_000, lastAt: 6_000 })).toBe(true);
  });

  it("skips hidden pages, offline devices and bursts (focus + visibilitychange fire together)", () => {
    expect(shouldAutoRefresh({ visible: false, online: true, now: 10_000, lastAt: null })).toBe(false);
    expect(shouldAutoRefresh({ visible: true, online: false, now: 10_000, lastAt: null })).toBe(false);
    expect(shouldAutoRefresh({ visible: true, online: true, now: 10_000, lastAt: 9_000 })).toBe(false);
  });
});
