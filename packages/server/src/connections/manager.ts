import { logger } from '../logger.js';
import { config } from '../config.js';
import {
  getAccountById,
  getActiveAccounts,
  getRulesByAccount,
  updateAccount,
  createDeliveryLog,
  deliveryExists,
  type Account,
} from '../db/queries.js';
import { ImapClient, type IncomingMessage } from './imap-client.js';
import { reconnectDelay, shouldGiveUp } from './reconnect.js';
import { parseEmail } from '../email/parser.js';
import { matchingRules } from '../email/filter.js';
import { buildPayload } from '../forwarder/forwarder.js';
import { retryQueue } from '../forwarder/retry.js';

interface ManagedConnection {
  client: ImapClient | null;
  account: Account;
  reconnectTimer: NodeJS.Timeout | null;
  stopping: boolean;
}

/**
 * Owns every live IMAP connection. Spawns one `ImapClient` per active account,
 * wires incoming messages through parse → rule match → webhook enqueue, and
 * handles reconnection with backoff plus DB status bookkeeping.
 */
class ConnectionManager {
  private connections = new Map<string, ManagedConnection>();
  private shuttingDown = false;

  /** Starts connections for all active accounts (called on boot). */
  async start(): Promise<void> {
    const accounts = await getActiveAccounts();
    logger.info({ count: accounts.length }, 'connection manager starting');
    for (const account of accounts) {
      // Fire connections concurrently; failures self-schedule a retry.
      void this.spawn(account.id);
    }
  }

  /** Persists a connection-state change, swallowing DB errors (best effort). */
  private async setState(
    accountId: string,
    updates: Parameters<typeof updateAccount>[1]
  ): Promise<void> {
    try {
      await updateAccount(accountId, updates);
    } catch (err) {
      logger.error(
        { accountId, err: (err as Error).message },
        'failed to persist connection state'
      );
    }
  }

  private buildEvents(accountId: string) {
    return {
      onMessage: (msg: IncomingMessage) => this.handleMessage(accountId, msg),
      onConnected: () => this.onConnected(accountId),
      onClose: () => this.onDrop(accountId, new Error('connection closed')),
      onError: (err: Error) => {
        // Errors often precede a close; record but let close/backoff drive reconnect.
        void this.setState(accountId, {
          connection_status: 'error',
          last_error: err.message,
        });
      },
    };
  }

  /** Creates and connects a client for an account id. */
  private async spawn(accountId: string): Promise<void> {
    if (this.shuttingDown) return;

    const account = await getAccountById(accountId);
    if (!account || !account.is_active) return;

    let managed = this.connections.get(accountId);
    if (!managed) {
      managed = { client: null, account, reconnectTimer: null, stopping: false };
      this.connections.set(accountId, managed);
    }
    managed.account = account;
    managed.stopping = false;

    await this.setState(accountId, { connection_status: 'connecting' });

    const folder = account.watch_folder || 'INBOX';
    const client = new ImapClient(account, folder, this.buildEvents(accountId));
    managed.client = client;

    try {
      await client.connect();
    } catch (err) {
      logger.error(
        { accountId, err: (err as Error).message },
        'imap connect failed'
      );
      this.onDrop(accountId, err as Error);
    }
  }

  private onConnected(accountId: string): void {
    void this.setState(accountId, {
      connection_status: 'connected',
      last_error: null,
      last_connected_at: new Date().toISOString(),
      consecutive_failures: 0,
    });
    logger.info({ accountId }, 'account connected');
  }

  /** Handles an unexpected drop/connect-failure: schedule a backoff reconnect. */
  private onDrop(accountId: string, err: Error): void {
    if (this.shuttingDown) return;
    const managed = this.connections.get(accountId);
    if (!managed || managed.stopping) return;

    // DB read + subsequent scheduling is async; run it and swallow failures.
    void this.onDropAsync(accountId, err, managed);
  }

  private async onDropAsync(
    accountId: string,
    err: Error,
    managed: ManagedConnection
  ): Promise<void> {
    const account = await getAccountById(accountId);
    if (!account || !account.is_active) return;
    if (managed.stopping || this.shuttingDown) return;

    const failures = account.consecutive_failures + 1;

    if (shouldGiveUp(failures)) {
      await this.setState(accountId, {
        is_active: false,
        connection_status: 'error',
        last_error: `Gave up after ${failures} consecutive connection failures: ${err.message}`,
        consecutive_failures: failures,
      });
      logger.error(
        { accountId, failures },
        'account deactivated after too many reconnect failures'
      );
      this.connections.delete(accountId);
      return;
    }

    await this.setState(accountId, {
      connection_status: 'error',
      last_error: err.message,
      consecutive_failures: failures,
    });

    const delay = reconnectDelay(failures);
    logger.warn({ accountId, failures, delayMs: delay }, 'scheduling imap reconnect');

    if (managed.reconnectTimer) clearTimeout(managed.reconnectTimer);
    const timer = setTimeout(() => {
      managed.reconnectTimer = null;
      void this.spawn(accountId);
    }, delay);
    timer.unref?.();
    managed.reconnectTimer = timer;
  }

  /** Parse → match rules → enqueue a webhook delivery per matching rule. */
  private async handleMessage(accountId: string, msg: IncomingMessage): Promise<void> {
    const receivedAtMs = Date.now();
    const account = await getAccountById(accountId);
    if (!account) return;

    const rules = await getRulesByAccount(accountId);
    if (rules.length === 0) return;

    let email;
    try {
      email = await parseEmail(msg.source);
    } catch (err) {
      logger.error(
        { accountId, uid: msg.uid, err: (err as Error).message },
        'failed to parse email'
      );
      return;
    }

    const matched = matchingRules(email, rules);
    if (matched.length === 0) {
      logger.debug({ accountId, uid: msg.uid, subject: email.subject }, 'no rule matched');
      return;
    }

    for (const rule of matched) {
      // De-dup: reconnect/restart sweeps re-see UNSEEN mail, so skip any
      // message this rule already produced a delivery for.
      if (await deliveryExists(rule.id, email.messageId)) {
        logger.debug(
          { accountId, ruleId: rule.id, messageId: email.messageId },
          'skipping already-delivered message'
        );
        continue;
      }

      const nowIso = new Date().toISOString();
      const timestampUnix = Math.floor(Date.now() / 1000);
      const payload = buildPayload(email, account, rule, nowIso);
      const payloadString = JSON.stringify(payload);

      const log = await createDeliveryLog({
        rule_id: rule.id,
        account_id: account.id,
        email_uid: String(msg.uid),
        message_id: email.messageId,
        from_address: email.from?.address ?? 'unknown',
        to_address: email.to[0]?.address ?? null,
        subject: email.subject,
        max_attempts: config.forwarder.maxRetryAttempts,
        payload_size: Buffer.byteLength(payloadString, 'utf8'),
      });

      logger.info(
        { accountId, ruleId: rule.id, logId: log.id, uid: msg.uid, subject: email.subject },
        'email matched rule; enqueuing delivery'
      );

      retryQueue.enqueue({
        logId: log.id,
        payloadString,
        timestampUnix,
        receivedAtMs,
      });
    }
  }

  // ---- Public control surface (used by the API) ----

  async addAccount(accountId: string): Promise<void> {
    await this.spawn(accountId);
  }

  async removeAccount(accountId: string): Promise<void> {
    const managed = this.connections.get(accountId);
    if (!managed) return;
    managed.stopping = true;
    if (managed.reconnectTimer) clearTimeout(managed.reconnectTimer);
    if (managed.client) await managed.client.disconnect();
    this.connections.delete(accountId);
    logger.info({ accountId }, 'account connection removed');
  }

  async reconnect(accountId: string): Promise<void> {
    await this.removeAccount(accountId);
    // Reset failure counter so a manual reconnect starts fresh.
    await this.setState(accountId, {
      connection_status: 'connecting',
      consecutive_failures: 0,
      last_error: null,
    });
    await this.spawn(accountId);
  }

  getStatus(accountId: string): { connected: boolean } {
    const managed = this.connections.get(accountId);
    return { connected: Boolean(managed?.client?.isConnected()) };
  }

  getStats(): { connected: number; connecting: number; total: number } {
    let connected = 0;
    for (const managed of this.connections.values()) {
      if (managed.client?.isConnected()) connected++;
    }
    return {
      connected,
      connecting: this.connections.size - connected,
      total: this.connections.size,
    };
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    logger.info({ count: this.connections.size }, 'closing all imap connections');
    const tasks: Promise<void>[] = [];
    for (const [accountId, managed] of this.connections) {
      managed.stopping = true;
      if (managed.reconnectTimer) clearTimeout(managed.reconnectTimer);
      if (managed.client) tasks.push(managed.client.disconnect().catch(() => undefined));
      void accountId;
    }
    await Promise.all(tasks);
    this.connections.clear();
    logger.info('all imap connections closed');
  }
}

export const connectionManager = new ConnectionManager();
export type { ConnectionManager };
