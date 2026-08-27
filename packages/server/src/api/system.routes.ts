import type { FastifyInstance } from 'fastify';
import { config, isGoogleConfigured, isMicrosoftConfigured } from '../config.js';
import {
  getAccountStats,
  getTotalRules,
  getDeliveriesToday,
  getFailedToday,
  getSuccessRate7d,
  getAvgProcessingTime7d,
} from '../db/queries.js';
import { connectionManager } from '../connections/manager.js';
import { retryQueue } from '../forwarder/retry.js';
import { isEncryptionKeyPersistent } from '../auth/encryption.js';

const startTime = Date.now();

export async function registerSystemRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => {
    const connStats = connectionManager.getStats();
    return {
      status: 'ok',
      version: config.version,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      accounts: {
        total: connStats.total,
        connected: connStats.connected,
        error: connStats.total - connStats.connected,
      },
      queue: retryQueue.stats(),
    };
  });

  app.get('/stats', async () => {
    const [accounts, totalRules, deliveriesToday, failedToday, successRate, avgMs] =
      await Promise.all([
        getAccountStats(),
        getTotalRules(),
        getDeliveriesToday(),
        getFailedToday(),
        getSuccessRate7d(),
        getAvgProcessingTime7d(),
      ]);
    return {
      total_accounts: accounts.total,
      active_connections: accounts.connected,
      errored_connections: accounts.errored,
      total_rules: totalRules,
      deliveries_today: deliveriesToday,
      failed_today: failedToday,
      success_rate_7d: successRate,
      avg_processing_time_ms: avgMs,
    };
  });

  app.get('/settings', async () => ({
    version: config.version,
    node_version: process.version,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    encryption_key_persistent: isEncryptionKeyPersistent(),
    providers: {
      google: isGoogleConfigured(),
      microsoft: isMicrosoftConfigured(),
    },
    base_url: config.api.baseUrl,
  }));
}
