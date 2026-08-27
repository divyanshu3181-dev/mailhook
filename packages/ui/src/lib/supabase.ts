import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// These are injected at build time by Vite. The anon key is a public,
// browser-safe key (NOT the service_role key) — it only permits what Supabase
// Auth + RLS allow, which here is just sign-in.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * The browser Supabase client, or null if the app was built without the
 * VITE_SUPABASE_* env vars. Callers must handle the null case and show a
 * configuration error rather than crashing.
 */
export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true },
      })
    : null;

export const isSupabaseConfigured = Boolean(url && anonKey);

/** Returns the current session's access token (JWT), or '' if signed out. */
export async function getAccessToken(): Promise<string> {
  if (!supabase) return '';
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? '';
}
