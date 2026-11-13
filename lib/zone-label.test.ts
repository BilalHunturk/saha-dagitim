import { describe, expect, it } from "vitest";
import { peopleLabel } from "@/app/yonetim/ZoneLayer";

describe("peopleLabel", () => {
  it("is empty when nobody is assigned", () => {
    expect(peopleLabel([])).toBe("");
  });
  it("puts each person on their own line under the zone name", () => {
    expect(peopleLabel(["Ayşe Yılmaz", "Emre Öztürk"])).toBe("\nAyşe Yılmaz\nEmre Öztürk");
  });
  it("caps the list at 8 names and counts the rest", () => {
    const names = Array.from({ length: 11 }, (_, i) => `Kişi ${i + 1}`);
    const label = peopleLabel(names);
    expect(label.split("\n").filter(Boolean)).toHaveLength(9);
    expect(label.endsWith("\n+3 kişi")).toBe(true);
  });
});
