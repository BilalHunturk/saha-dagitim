import { describe, expect, it } from "vitest";
import { generatePassword } from "./password";

describe("generatePassword", () => {
  it("is 8 characters long", () => {
    expect(generatePassword()).toHaveLength(8);
  });

  it("uses only the unambiguous alphabet", () => {
    for (let i = 0; i < 50; i++) {
      expect(generatePassword()).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/);
    }
  });

  it("produces 50 distinct passwords in 50 calls", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generatePassword()));
    expect(seen.size).toBe(50);
  });
});
