import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshIfReachable } from "./safe-refresh";

afterEach(() => vi.unstubAllGlobals());

describe("refreshIfReachable", () => {
  it("refreshes when the server answers", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const router = { refresh: vi.fn() };
    expect(await refreshIfReachable(router)).toBe(true);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/manifest.webmanifest", { method: "HEAD", cache: "no-store" });
  });

  it("does not refresh (no full-page fallback) when the network is down or the server errors", async () => {
    const router = { refresh: vi.fn() };
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    expect(await refreshIfReachable(router)).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 502 })));
    expect(await refreshIfReachable(router)).toBe(false);
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
