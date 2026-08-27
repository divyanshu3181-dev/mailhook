import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { logger } from '../logger.js';

let supabase: SupabaseClient | null = null;

/**
 * Creates the Supabase client using the service-role key (backend service —
 * bypasses RLS). Schema migrations are managed in Supabase, not by the app.
 */
export function initDatabase(): SupabaseClient {
  supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'public' },
  });
  logger.info('Supabase client initialized');
  return supabase;
}

export function getDb(): SupabaseClient {
  if (!supabase) {
    throw new Error('Database not initialized — call initDatabase() first');
  }
  return supabase;
}

/** No-op for API symmetry with the previous SQLite layer. */
export function closeDb(): void {
  supabase = null;
}
