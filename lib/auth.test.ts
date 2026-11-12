import { describe, expect, it } from "vitest";
import { homeFor } from "./auth";

describe("homeFor", () => {
  it("sends admins to /yonetim", () => {
    expect(homeFor("admin")).toBe("/yonetim");
  });

  it("sends workers to /gorevim", () => {
    expect(homeFor("worker")).toBe("/gorevim");
  });
});
