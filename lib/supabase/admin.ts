import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. Bypasses RLS: server-only, and only after the
 * caller's rights have been checked. The key must never be exposed to the browser.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured");

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
