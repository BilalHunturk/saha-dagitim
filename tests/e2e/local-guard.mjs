// Shared safety check for the e2e scripts. They create rows and users and hard-delete them with
// the service role from .env.local, which is also where the README puts production keys.
// Same rule as tests/db/helpers.ts: only a local Supabase (host localhost or 127.0.0.1).

/** Exits the process unless `url` points at a local Supabase. Call before creating any client. */
export function assertLocalSupabase(url) {
  let host = null;
  try {
    host = new URL(url).hostname;
  } catch {
    // reported below
  }
  if (host === "localhost" || host === "127.0.0.1") return;
  console.error(
    host === null
      ? "e2e refused: NEXT_PUBLIC_SUPABASE_URL is missing or not a valid URL."
      : `e2e refused: NEXT_PUBLIC_SUPABASE_URL host is "${host}", expected localhost or 127.0.0.1. ` +
          "The e2e scripts only run against the local Supabase stack (npx supabase start).",
  );
  process.exit(2);
}
