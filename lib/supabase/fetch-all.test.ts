import { describe, expect, it } from "vitest";
import { PAGE_SIZE, fetchAll } from "./fetch-all";

/** A fake PostgREST: returns rows[from..to] (inclusive), but never more than `cap` rows per request. */
function fakeTable(total: number, cap = 1000) {
  const rows = Array.from({ length: total }, (_, i) => ({ n: i }));
  const calls: [number, number][] = [];
  const fetchPage = async (from: number, to: number) => {
    calls.push([from, to]);
    return { data: rows.slice(from, Math.min(to + 1, from + cap)), error: null };
  };
  return { rows, calls, fetchPage };
}

describe("fetchAll", () => {
  it("returns a short table with one request", async () => {
    const t = fakeTable(8);
    const result = await fetchAll(t.fetchPage);
    expect(result).toEqual({ data: t.rows, error: null });
    expect(t.calls).toEqual([[0, 999]]);
  });

  it("pages past the 1000-row cap until a short page", async () => {
    const t = fakeTable(2050);
    const result = await fetchAll(t.fetchPage);
    expect(result.error).toBeNull();
    expect(result.data).toEqual(t.rows);
    expect(t.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("asks once more when the last page is exactly full", async () => {
    const t = fakeTable(2000);
    const result = await fetchAll(t.fetchPage);
    expect(result.data).toHaveLength(2000);
    expect(t.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("handles an empty table", async () => {
    const t = fakeTable(0);
    expect(await fetchAll(t.fetchPage)).toEqual({ data: [], error: null });
    expect(t.calls).toHaveLength(1);
  });

  it("uses the given page size", async () => {
    const t = fakeTable(5);
    const result = await fetchAll(t.fetchPage, 2);
    expect(result.data).toEqual(t.rows);
    expect(t.calls).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
  });

  it("defaults to 1000-row pages, the PostgREST max_rows of this project", () => {
    expect(PAGE_SIZE).toBe(1000);
  });

  it("stops at the first error and returns it with no rows", async () => {
    let call = 0;
    const err = { message: "boom" };
    const result = await fetchAll(async (from: number, to: number) => {
      call += 1;
      return call === 1
        ? { data: Array.from({ length: to - from + 1 }, (_, i) => ({ n: from + i })), error: null }
        : { data: null, error: err };
    });
    expect(result).toEqual({ data: [], error: err });
    expect(call).toBe(2);
  });

  it("treats null data without an error as an empty page", async () => {
    const result = await fetchAll(async () => ({ data: null, error: null }));
    expect(result).toEqual({ data: [], error: null });
  });
});
