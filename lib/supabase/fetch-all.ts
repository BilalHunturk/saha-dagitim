/**
 * PostgREST returns at most `max_rows` rows per request (1000 here and on hosted Supabase), and
 * says nothing when it cuts a result short. Must not be larger than the server's `max_rows`:
 * a page shorter than this is taken as the last one.
 */
export const PAGE_SIZE = 1000;

type Page<T, E> = { data: T[] | null; error: E | null };

/**
 * Reads every row by asking for consecutive ranges until a page comes back short.
 *
 * `fetchPage(from, to)` must build a fresh query (a query builder is used once) with
 * `.range(from, to)` and an `order` on a unique key, so the pages neither overlap nor skip rows.
 * On the first error, it returns that error and no rows.
 */
export async function fetchAll<T, E>(
  fetchPage: (from: number, to: number) => PromiseLike<Page<T, E>>,
  pageSize: number = PAGE_SIZE,
): Promise<{ data: T[]; error: E | null }> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) return { data: [], error };
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) return { data: all, error: null };
  }
}
