import { describe, expect, it } from "vitest";
import { formatPhone, normalizePhone, phoneToEmail } from "./phone";

describe("normalizePhone", () => {
  it.each([
    "0532 123 45 67",
    "532-123-4567",
    "+90 532 123 45 67",
    "905321234567",
  ])("normalizes %j to E.164", (input) => {
    expect(normalizePhone(input)).toBe("+905321234567");
  });

  it.each(["0312 123 45 67", "53212345", "", "abc"])(
    "rejects %j",
    (input) => {
      expect(normalizePhone(input)).toBeNull();
    },
  );
});

describe("phoneToEmail", () => {
  it("builds the synthetic email", () => {
    expect(phoneToEmail("+905321234567")).toBe("905321234567@saha.local");
  });
});

describe("formatPhone", () => {
  it("formats E.164 for display", () => {
    expect(formatPhone("+905321234567")).toBe("0532 123 45 67");
  });
});
