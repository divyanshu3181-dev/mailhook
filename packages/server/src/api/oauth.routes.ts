import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { config, isGoogleConfigured, isMicrosoftConfigured } from '../config.js';
import { logger } from '../logger.js';
import { createAccount, getAccountByEmail, updateAccount, type Provider } from '../db/queries.js';
import { encrypt } from '../auth/encryption.js';
import { forceRefresh } from '../auth/tokens.js';
import * as gmail from '../auth/gmail-oauth.js';
import * as outlook from '../auth/outlook-oauth.js';
import { connectionManager } from '../connections/manager.js';
import { idParamsSchema } from './schemas.js';

/** Short-lived CSRF state store: state → { provider, expiresAt }. */
const stateStore = new Map<string, { provider: 'google' | 'microsoft'; expiresAt: number }>();
const STATE_TTL_MS = 10 * 60 * 1000;

function issueState(provider: 'google' | 'microsoft'): string {
  const state = randomBytes(24).toString('hex');
  stateStore.set(state, { provider, expiresAt: Date.now() + STATE_TTL_MS });
  return state;
}

function consumeState(state: string, provider: 'google' | 'microsoft'): boolean {
  const entry = stateStore.get(state);
  if (!entry) return false;
  stateStore.delete(state);
  if (entry.provider !== provider) return false;
  if (Date.now() > entry.expiresAt) return false;
  return true;
}

// Periodically evict expired states.
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of stateStore) {
    if (now > val.expiresAt) stateStore.delete(key);
  }
}, 60_000).unref?.();

/** Auth-protected OAuth endpoints (URL generation + forced refresh). */
export async function registerOAuthProtectedRoutes(app: FastifyInstance): Promise<void> {
  app.get('/oauth/google/url', async (_request, reply) => {
    if (!isGoogleConfigured()) {
      reply.code(400);
      return { error: 'Google OAuth is not configured on this server' };
    }
    const state = issueState('google');
    return { url: gmail.buildAuthUrl(state) };
  });

  app.get('/oauth/microsoft/url', async (_request, reply) => {
    if (!isMicrosoftConfigured()) {
      reply.code(400);
      return { error: 'Microsoft OAuth is not configured on this server' };
    }
    const state = issueState('microsoft');
    return { url: await outlook.buildAuthUrl(state) };
  });

  app.post('/oauth/:id/refresh', { schema: { params: idParamsSchema } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await forceRefresh(id);
      return { refreshed: true };
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });
}

/**
 * Public OAuth callbacks (no API key — the identity provider redirects here).
 * Registered on the base app, outside the protected scope.
 */
export async function registerOAuthCallbackRoutes(app: FastifyInstance): Promise<void> {
  const uiRedirect = (ok: boolean, message?: string): string => {
    const base = config.api.baseUrl.replace(/\/$/, '');
    const params = new URLSearchParams({ oauth: ok ? 'success' : 'error' });
    if (message) params.set('message', message);
    return `${base}/accounts?${params.toString()}`;
  };

  app.get('/api/oauth/google/callback', async (request, reply) => {
    const q = request.query as { code?: string; state?: string; error?: string };
    try {
      if (q.error) throw new Error(q.error);
      if (!q.code || !q.state) throw new Error('Missing code or state');
      if (!consumeState(q.state, 'google')) throw new Error('Invalid or expired state');

      const tokens = await gmail.exchangeCode(q.code);
      const email = await gmail.fetchEmailAddress(tokens.accessToken);

      await upsertOAuthAccount({
        provider: 'gmail',
        email,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        imapHost: gmail.gmailImap.host,
      });

      reply.redirect(uiRedirect(true));
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'google oauth callback failed');
      reply.redirect(uiRedirect(false, (err as Error).message));
    }
  });

  app.get('/api/oauth/microsoft/callback', async (request, reply) => {
    const q = request.query as { code?: string; state?: string; error?: string };
    try {
      if (q.error) throw new Error(q.error);
      if (!q.code || !q.state) throw new Error('Missing code or state');
      if (!consumeState(q.state, 'microsoft')) throw new Error('Invalid or expired state');

      const result = await outlook.exchangeCode(q.code);

      await upsertOAuthAccount({
        provider: 'outlook',
        email: result.email,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresAt: result.expiresAt,
        imapHost: outlook.outlookImap.host,
      });

      reply.redirect(uiRedirect(true));
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'microsoft oauth callback failed');
      reply.redirect(uiRedirect(false, (err as Error).message));
    }
  });
}

interface UpsertOAuthAccountInput {
  provider: Provider;
  email: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string;
  imapHost: string;
}

/** Creates a new OAuth account, or updates tokens if the email already exists. */
async function upsertOAuthAccount(input: UpsertOAuthAccountInput): Promise<void> {
  const existing = await getAccountByEmail(input.email);
  const accessEnc = encrypt(input.accessToken);
  const refreshEnc = input.refreshToken ? encrypt(input.refreshToken) : null;

  if (existing) {
    await updateAccount(existing.id, {
      oauth_access_token_enc: accessEnc,
      // A fresh OAuth grant always carries a refresh token; on re-auth we take
      // the new one when present and otherwise keep the stored one.
      ...(refreshEnc ? { oauth_refresh_token_enc: refreshEnc } : {}),
      oauth_expires_at: input.expiresAt,
      // Re-activate if the account had previously been auto-deactivated.
      is_active: true,
    });
    await connectionManager.reconnect(existing.id);
    logger.info({ accountId: existing.id, email: input.email }, 'oauth account tokens updated');
    return;
  }

  const account = await createAccount({
    name: input.email,
    provider: input.provider,
    email_address: input.email,
    oauth_access_token_enc: accessEnc,
    oauth_refresh_token_enc: refreshEnc,
    oauth_expires_at: input.expiresAt,
    imap_host: input.imapHost,
    imap_port: 993,
    imap_tls: true,
    watch_folder: 'INBOX',
    is_active: true,
  });
  await connectionManager.addAccount(account.id);
  logger.info({ accountId: account.id, email: input.email }, 'oauth account created');
}
