import { ImapFlow, type FetchMessageObject } from 'imapflow';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { decrypt } from '../auth/encryption.js';
import { getValidAccessToken } from '../auth/tokens.js';
import type { Account } from '../db/queries.js';

export interface IncomingMessage {
  uid: number;
  source: Buffer;
}

export type MessageHandler = (msg: IncomingMessage) => Promise<void>;

export interface ImapClientEvents {
  onMessage: MessageHandler;
  onConnected: () => void;
  /** Called when the connection drops unexpectedly (not on intentional close). */
  onClose: (err?: Error) => void;
  onError: (err: Error) => void;
}

/**
 * Wraps a single imapflow connection for one account. Opens the watch folder,
 * lets imapflow maintain IDLE, and fetches new messages as they arrive via the
 * `exists` event. Tracks the highest processed UID so reconnects and duplicate
 * `exists` events never re-fire webhooks for already-seen mail.
 */
export class ImapClient {
  private client: ImapFlow | null = null;
  private lock: Awaited<ReturnType<ImapFlow['getMailboxLock']>> | null = null;
  private lastUid = 0;
  private closedIntentionally = false;
  private processing = false;
  private keepaliveTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly account: Account,
    private readonly folder: string,
    private readonly events: ImapClientEvents
  ) {}

  /** Builds imapflow auth config, refreshing OAuth tokens if needed. */
  private async buildAuth(): Promise<{ host: string; port: number; secure: boolean; auth: Record<string, string> }> {
    const { account } = this;

    if (account.provider === 'gmail' || account.provider === 'outlook') {
      const accessToken = await getValidAccessToken(account);
      const host =
        account.imap_host ??
        (account.provider === 'gmail' ? 'imap.gmail.com' : 'outlook.office365.com');
      return {
        host,
        port: account.imap_port ?? 993,
        secure: true,
        auth: { user: account.email_address, accessToken },
      };
    }

    // Custom / Yahoo etc. — password auth.
    if (!account.imap_host || !account.imap_user || !account.imap_pass_enc) {
      throw new Error(`Account ${account.id} is missing IMAP credentials`);
    }
    return {
      host: account.imap_host,
      port: account.imap_port ?? 993,
      secure: account.imap_tls,
      auth: {
        user: account.imap_user,
        pass: decrypt(account.imap_pass_enc),
      },
    };
  }

  async connect(): Promise<void> {
    this.closedIntentionally = false;
    const authConfig = await this.buildAuth();

    const client = new ImapFlow({
      host: authConfig.host,
      port: authConfig.port,
      secure: authConfig.secure,
      auth: authConfig.auth as never,
      logger: false,
      // Keep TLS strict by default.
      emitLogs: false,
    });
    this.client = client;

    client.on('error', (err: Error) => {
      logger.error({ accountId: this.account.id, err: err.message }, 'imap error');
      this.events.onError(err);
    });

    client.on('close', () => {
      if (this.closedIntentionally) return;
      logger.warn({ accountId: this.account.id }, 'imap connection closed unexpectedly');
      this.events.onClose();
    });

    client.on('exists', (data: { path: string; count: number; prevCount: number }) => {
      // Fires instantly during IDLE when new mail arrives.
      void this.handleExists(data);
    });

    await client.connect();

    // Acquire a persistent lock on the watch folder — required to keep IDLE.
    this.lock = await client.getMailboxLock(this.folder);

    logger.info(
      { accountId: this.account.id, folder: this.folder },
      'imap connected; IDLE active'
    );
    this.events.onConnected();

    // Proactively verify the socket stays alive so a silently half-dead
    // connection is detected within one keepalive interval instead of never.
    this.startKeepalive();

    // Sweep any UNSEEN mail already sitting in the folder. This catches mail
    // that arrived while we were disconnected (Gmail cycles IDLE ~every 29min)
    // or while the process was down — cases the `exists` event alone misses.
    // Delivery de-dup is enforced downstream by message-id, so re-seeing a
    // message across reconnects never double-fires a webhook.
    await this.sweepUnseen();
  }

  /** Fetches every UNSEEN message and dispatches ones newer than lastUid. */
  private async sweepUnseen(): Promise<void> {
    if (!this.client) return;
    if (this.processing) return;
    this.processing = true;
    try {
      const uids = await this.client.search({ seen: false }, { uid: true });
      if (!uids || uids.length === 0) return;
      for await (const message of this.client.fetch(
        uids,
        { uid: true, source: true },
        { uid: true }
      )) {
        const msg = message as FetchMessageObject;
        if (typeof msg.uid !== 'number' || !msg.source) continue;
        this.lastUid = Math.max(this.lastUid, msg.uid);
        try {
          await this.events.onMessage({ uid: msg.uid, source: msg.source });
        } catch (err) {
          logger.error(
            { accountId: this.account.id, uid: msg.uid, err: (err as Error).message },
            'error handling swept message'
          );
        }
      }
    } catch (err) {
      logger.error(
        { accountId: this.account.id, err: (err as Error).message },
        'error sweeping unseen mail on connect'
      );
    } finally {
      this.processing = false;
    }
  }

  /** Periodic NOOP so a dead socket surfaces as an error → triggers reconnect. */
  private startKeepalive(): void {
    this.stopKeepalive();
    const interval = config.imap.keepaliveInterval;
    if (interval <= 0) return;
    const timer = setInterval(() => {
      const client = this.client;
      if (!client || !client.usable) return;
      client.noop().catch((err: Error) => {
        logger.warn(
          { accountId: this.account.id, err: err.message },
          'imap keepalive NOOP failed; connection likely dead'
        );
        // A failed NOOP means the socket is gone; force a close so the manager
        // schedules a reconnect rather than waiting on a stuck IDLE.
        if (!this.closedIntentionally) this.events.onClose();
      });
    }, interval);
    timer.unref?.();
    this.keepaliveTimer = timer;
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  /**
   * Fetches and dispatches any messages with UID greater than the last one we
   * processed. Serialized via `processing` so overlapping `exists` events (or a
   * burst of arrivals) don't double-process.
   */
  private async handleExists(data: { path: string; count: number; prevCount: number }): Promise<void> {
    if (!this.client) return;
    if (this.processing) return;
    this.processing = true;

    try {
      const range = `${this.lastUid + 1}:*`;
      for await (const message of this.client.fetch(
        range,
        { uid: true, source: true },
        { uid: true }
      )) {
        const msg = message as FetchMessageObject;
        // `${lastUid+1}:*` can echo the last message when no newer UID exists;
        // guard strictly on UID to avoid reprocessing.
        if (typeof msg.uid !== 'number' || msg.uid <= this.lastUid) continue;
        if (!msg.source) {
          this.lastUid = Math.max(this.lastUid, msg.uid);
          continue;
        }

        this.lastUid = Math.max(this.lastUid, msg.uid);
        try {
          await this.events.onMessage({ uid: msg.uid, source: msg.source });
        } catch (err) {
          logger.error(
            { accountId: this.account.id, uid: msg.uid, err: (err as Error).message },
            'error handling incoming message'
          );
        }
      }
    } catch (err) {
      logger.error(
        { accountId: this.account.id, err: (err as Error).message },
        'error fetching new messages'
      );
    } finally {
      this.processing = false;
      void data;
    }
  }

  /** Gracefully closes the connection. Marks the close as intentional. */
  async disconnect(): Promise<void> {
    this.closedIntentionally = true;
    this.stopKeepalive();
    try {
      if (this.lock) {
        this.lock.release();
        this.lock = null;
      }
    } catch {
      /* ignore */
    }
    try {
      if (this.client) {
        await this.client.logout();
      }
    } catch {
      try {
        this.client?.close();
      } catch {
        /* ignore */
      }
    } finally {
      this.client = null;
    }
  }

  isConnected(): boolean {
    return Boolean(this.client && this.client.usable);
  }
}

export const IDLE_TIMEOUT = config.imap.idleTimeout;

export interface TestConnectionParams {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  folder?: string;
}

export interface TestConnectionResult {
  ok: boolean;
  error?: string;
}

/**
 * Verifies IMAP credentials by connecting, opening the folder, and logging out.
 * Never throws — returns `{ ok, error }` so the API can report cleanly.
 */
export async function testImapConnection(
  params: TestConnectionParams
): Promise<TestConnectionResult> {
  const client = new ImapFlow({
    host: params.host,
    port: params.port,
    secure: params.secure,
    auth: { user: params.user, pass: params.pass },
    logger: false,
    emitLogs: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock(params.folder ?? 'INBOX');
    lock.release();
    await client.logout();
    return { ok: true };
  } catch (err) {
    try {
      client.close();
    } catch {
      /* ignore */
    }
    return { ok: false, error: (err as Error).message };
  }
}
