import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client using the service role key. Created lazily on first call, never at import,
 * so builds work without env vars. Not called anywhere yet: T002 adds the repository on top of it.
 */
let client: SupabaseClient | null = null;

export type DbClientResult = { ok: true; client: SupabaseClient } | { ok: false; error: "db_not_configured" };

export function getDbClient(): DbClientResult {
  if (client) return { ok: true, client };
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return { ok: false, error: "db_not_configured" };
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { ok: true, client };
}
