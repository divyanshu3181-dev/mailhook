import { config, validateConfig } from './config.js';
import { logger } from './logger.js';
import { initDatabase, closeDb } from './db/database.js';
import { purgeOldLogs } from './db/queries.js';
import { getEncryptionKey } from './auth/encryption.js';
import { startApiServer, stopApiServer } from './api/server.js';
import { connectionManager } from './connections/manager.js';
import { retryQueue } from './forwarder/retry.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SHUTDOWN_TIMEOUT_MS = 30_000;
let retentionTimer: NodeJS.Timeout | null = null;
let shuttingDown = false;

function startLogRetention(): void {
  const run = async () => {
    try {
      const removed = await purgeOldLogs(config.log.retentionDays);
      if (removed > 0) {
        logger.info({ removed, retentionDays: config.log.retentionDays }, 'purged old logs');
      }
    } catch (err) {
      logger.error({ err }, 'log retention cleanup failed');
    }
  };
  setTimeout(() => void run(), 60_000).unref?.();
  retentionTimer = setInterval(() => void run(), ONE_DAY_MS);
  retentionTimer.unref?.();
}

async function main(): Promise<void> {
  logger.info({ version: config.version }, 'starting MailHook');

  // 1. Validate required configuration (Supabase + encryption key). Fail fast.
  const problems = validateConfig();
  if (problems.length > 0) {
    for (const problem of problems) logger.fatal(problem);
    process.exit(1);
  }

  // 2. Encryption key (validated above; loads it into memory).
  getEncryptionKey();

  // 3. Supabase client (schema migrations are managed in Supabase, not here).
  initDatabase();

  // 4. HTTP API + UI first, so health checks work even if the DB is briefly slow.
  await startApiServer();

  // 5. Recover interrupted deliveries from a previous run. Non-fatal — a
  //    transient DB hiccup here must not prevent the service from starting.
  try {
    await retryQueue.recoverPendingRetries();
  } catch (err) {
    logger.error({ err }, 'crash recovery failed; continuing startup');
  }

  // 6. Establish all IMAP IDLE connections. Each account self-schedules
  //    reconnect on failure, so a slow DB here degrades rather than crashes.
  try {
    await connectionManager.start();
  } catch (err) {
    logger.error({ err }, 'connection manager start failed; continuing');
  }

  // 7. Background log retention.
  startLogRetention();

  logger.info('MailHook is up');
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down gracefully');

  // Hard cap the shutdown so a stuck connection can't hang the process.
  const forceTimer = setTimeout(() => {
    logger.error('shutdown timed out; forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceTimer.unref?.();

  try {
    // Stop new HTTP requests.
    await stopApiServer();
    // Close all IMAP connections (stops new email events).
    await connectionManager.shutdown();
    // Drain in-flight webhook deliveries.
    await retryQueue.shutdown();

    if (retentionTimer) clearInterval(retentionTimer);
    closeDb();

    clearTimeout(forceTimer);
    logger.info('shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('uncaughtException', (err) => logger.fatal({ err }, 'uncaught exception'));
process.on('unhandledRejection', (reason) => logger.error({ reason }, 'unhandled rejection'));

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
