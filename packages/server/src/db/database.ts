import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { logger } from '../logger.js';

let supabase: SupabaseClient | null = null;

/**
 * Inert WebSocket stand-in passed as the Realtime transport. Its only job is to
 * exist so supabase-js skips its native-WebSocket lookup; it is never
 * instantiated because MailHook never opens a realtime channel.
 */
class NoopWebSocket {
  constructor(..._args: unknown[]) {
    void _args;
  }
}

/**
 * Creates the Supabase client using the service-role key (backend service —
 * bypasses RLS). Schema migrations are managed in Supabase, not by the app.
 */
export function initDatabase(): SupabaseClient {
  supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'public' },
    // MailHook only uses REST queries — never Realtime. Supabase's RealtimeClient
    // otherwise calls getWebSocketConstructor() at construction, which throws on
    // Node < 22 ("native WebSocket not found"). Passing any `transport` short-
    // circuits that lookup (see realtime-js _initializeOptions), so the client
    // constructs cleanly regardless of Node version. The stub is never used
    // because we never open a realtime channel.
    realtime: { transport: NoopWebSocket as never },
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
