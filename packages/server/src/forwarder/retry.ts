import PQueue from 'p-queue';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { getRuleById, getLogById, updateDeliveryLog, getRetryableLogs } from '../db/queries.js';
import { deliverOnce } from './forwarder.js';

/**
 * Backoff schedule in ms, indexed by the attempt that just FAILED (1-based):
 * after attempt 1 → 10s, 2 → 60s, 3 → 300s, 4 → 900s. When attempts reach
 * max_attempts the delivery is marked failed instead of rescheduling.
 */
const RETRY_SCHEDULE_MS = [10_000, 60_000, 300_000, 900_000];

function backoffFor(attemptJustFailed: number): number {
  const idx = Math.min(attemptJustFailed - 1, RETRY_SCHEDULE_MS.length - 1);
  return RETRY_SCHEDULE_MS[idx];
}

interface QueuedItem {
  logId: number;
  payloadString: string;
  timestampUnix: number;
  /** ms epoch when the email was received (for processing_time_ms). */
  receivedAtMs: number;
}

/**
 * In-process retry queue. Holds each in-flight delivery's serialized payload in
 * memory (keyed by log id) so retries re-send the exact signed bytes. Payloads
 * are intentionally not persisted to keep the DB small; the tradeoff is handled
 * in `recoverPendingRetries`.
 */
class RetryQueue {
  private queue: PQueue;
  private payloads = new Map<number, QueuedItem>();
  private timers = new Set<NodeJS.Timeout>();
  private shuttingDown = false;

  constructor() {
    this.queue = new PQueue({ concurrency: config.forwarder.concurrency });
  }

  enqueue(item: QueuedItem): void {
    if (this.shuttingDown) return;
    this.payloads.set(item.logId, item);
    void this.queue.add(() => this.attempt(item.logId));
  }

  private scheduleRetry(logId: number, delayMs: number): void {
    if (this.shuttingDown) return;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.shuttingDown) return;
      void this.queue.add(() => this.attempt(logId));
    }, delayMs);
    timer.unref?.();
    this.timers.add(timer);
  }

  private async attempt(logId: number): Promise<void> {
    const item = this.payloads.get(logId);
    if (!item) {
      logger.error({ logId }, 'retry attempt with no cached payload; dropping');
      return;
    }

    const log = await getLogById(logId);
    if (!log) {
      this.payloads.delete(logId);
      return;
    }

    const rule = await getRuleById(log.rule_id);
    if (!rule) {
      await updateDeliveryLog(logId, {
        status: 'failed',
        last_attempt_at: new Date().toISOString(),
        error_message: 'Rule was deleted before delivery completed',
      });
      this.payloads.delete(logId);
      return;
    }

    const attemptNumber = log.attempts + 1;
    const result = await deliverOnce(rule, item.payloadString, item.timestampUnix);
    const nowIso = new Date().toISOString();

    if (result.ok) {
      await updateDeliveryLog(logId, {
        status: 'delivered',
        attempts: attemptNumber,
        last_attempt_at: nowIso,
        delivered_at: nowIso,
        next_retry_at: null,
        response_code: result.responseCode ?? 0,
        response_body: result.responseBody,
        error_message: null,
        processing_time_ms: Date.now() - item.receivedAtMs,
      });
      this.payloads.delete(logId);
      logger.info(
        { logId, ruleId: rule.id, attempt: attemptNumber, status: result.responseCode },
        'webhook delivered'
      );
      return;
    }

    if (attemptNumber >= log.max_attempts) {
      await updateDeliveryLog(logId, {
        status: 'failed',
        attempts: attemptNumber,
        last_attempt_at: nowIso,
        next_retry_at: null,
        response_code: result.responseCode,
        response_body: result.responseBody,
        error_message: result.errorMessage,
      });
      this.payloads.delete(logId);
      logger.error(
        { logId, ruleId: rule.id, attempts: attemptNumber },
        'webhook delivery failed permanently'
      );
      return;
    }

    const delay = backoffFor(attemptNumber);
    await updateDeliveryLog(logId, {
      status: 'retrying',
      attempts: attemptNumber,
      last_attempt_at: nowIso,
      next_retry_at: new Date(Date.now() + delay).toISOString(),
      response_code: result.responseCode,
      response_body: result.responseBody,
      error_message: result.errorMessage,
    });
    logger.warn(
      { logId, ruleId: rule.id, attempt: attemptNumber, retryInMs: delay },
      'webhook delivery failed; scheduling retry'
    );
    this.scheduleRetry(logId, delay);
  }

  /**
   * Manual retry of a log entry. Requires the payload to still be cached (i.e.
   * delivery was attempted this process lifetime). Returns false otherwise.
   */
  retryNow(logId: number): boolean {
    if (!this.payloads.has(logId)) return false;
    void this.queue.add(() => this.attempt(logId));
    return true;
  }

  /**
   * Startup crash recovery. Rows left in 'retrying'/'pending' from a previous
   * process cannot be re-sent — their email payloads are not persisted — so we
   * mark them failed with a clear reason instead of leaving them stuck.
   */
  async recoverPendingRetries(): Promise<void> {
    const pending = await getRetryableLogs();
    if (pending.length === 0) return;

    let requeued = 0;
    for (const row of pending) {
      if (this.payloads.has(row.id)) {
        void this.queue.add(() => this.attempt(row.id));
        requeued++;
        continue;
      }
      await updateDeliveryLog(row.id, {
        status: 'failed',
        last_attempt_at: new Date().toISOString(),
        error_message:
          'Delivery interrupted by server restart; original payload not retained. The email is still in the mailbox and can be reprocessed.',
      });
    }

    logger.warn(
      { total: pending.length, reQueued: requeued, markedFailed: pending.length - requeued },
      'processed interrupted deliveries on startup'
    );
  }

  size(): number {
    return this.queue.size + this.queue.pending;
  }

  stats(): { pending: number; processing: number } {
    return { pending: this.queue.size, processing: this.queue.pending };
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    await this.queue.onIdle();
    logger.info('retry queue drained');
  }
}

export const retryQueue = new RetryQueue();
export type { RetryQueue, QueuedItem };
