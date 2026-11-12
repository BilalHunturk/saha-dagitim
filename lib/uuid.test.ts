import { describe, expect, it } from "vitest";
import { newUuid } from "./uuid";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newUuid", () => {
  it("returns distinct v4 UUIDs", () => {
    const a = newUuid();
    const b = newUuid();
    expect(a).toMatch(V4);
    expect(b).toMatch(V4);
    expect(a).not.toBe(b);
  });

  it("works without crypto.randomUUID (plain-http LAN address: no secure context)", () => {
    const original = globalThis.crypto.randomUUID;
    // Simulate the property being absent, as it is in an insecure context.
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      const ids = new Set(Array.from({ length: 50 }, () => newUuid()));
      expect(ids.size).toBe(50);
      for (const id of ids) expect(id).toMatch(V4);
    } finally {
      Object.defineProperty(globalThis.crypto, "randomUUID", { value: original, configurable: true });
    }
  });
});
