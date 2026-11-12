import { redirect } from "next/navigation";
import { afterEach, describe, expect, it, vi } from "vitest";
import { callAction } from "./call-action";
import { LOGIN_MESSAGES } from "./login";

afterEach(() => vi.restoreAllMocks());

describe("callAction", () => {
  it("returns the action's own result, success or failure", async () => {
    expect(await callAction(async () => ({ ok: true as const, id: "x" }))).toEqual({ ok: true, id: "x" });
    expect(await callAction(async () => ({ ok: false as const, error: "Bölge bulunamadı" }))).toEqual({
      ok: false,
      error: "Bölge bulunamadı",
    });
  });

  it("maps a rejection (network drop) to the connection message and calls onRejected", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onRejected = vi.fn();
    const result = await callAction(() => Promise.reject(new TypeError("Failed to fetch")), onRejected);
    expect(result).toEqual({ ok: false, error: LOGIN_MESSAGES.CONNECTION });
    expect(onRejected).toHaveBeenCalledTimes(1);
  });

  it("rethrows a Next redirect (e.g. requireRole inside the action) instead of swallowing it", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onRejected = vi.fn();
    const run = callAction(async () => {
      redirect("/giris?hata=pasif");
    }, onRejected);
    await expect(run).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
    expect(onRejected).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  });
});
