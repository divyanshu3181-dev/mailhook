import { config } from '../config.js';

/**
 * Backoff schedule (ms) between reconnect attempts: 5s, 15s, 30s, 60s, 120s,
 * then capped at RECONNECT_MAX_DELAY (default 300s) for all further attempts.
 */
const BASE_SCHEDULE_MS = [5_000, 15_000, 30_000, 60_000, 120_000];

/** Delay before the Nth reconnect attempt (attempt is 1-based). */
export function reconnectDelay(attempt: number): number {
  const idx = attempt - 1;
  if (idx < BASE_SCHEDULE_MS.length) return BASE_SCHEDULE_MS[idx];
  return Math.min(config.imap.reconnectMaxDelay, 300_000);
}

/**
 * Whether to stop reconnecting an account. Defaults to never giving up
 * (`IMAP_NEVER_GIVE_UP`), so a transient provider/network outage never
 * permanently deactivates an account — it keeps retrying with capped backoff.
 */
export function shouldGiveUp(consecutiveFailures: number): boolean {
  if (config.imap.neverGiveUp) return false;
  return consecutiveFailures >= config.imap.maxReconnectAttempts;
}
