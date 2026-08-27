import { logger } from '../logger.js';
import { getAccountById, updateAccount, type Account } from '../db/queries.js';
import { decrypt, encrypt } from './encryption.js';
import * as gmail from './gmail-oauth.js';
import * as outlook from './outlook-oauth.js';

/** Skew (ms) before actual expiry at which we proactively refresh. */
const REFRESH_SKEW_MS = 60_000;

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return true;
  const expMs = Date.parse(expiresAt);
  if (Number.isNaN(expMs)) return true;
  return Date.now() >= expMs - REFRESH_SKEW_MS;
}

/**
 * Returns a currently-valid decrypted access token for an OAuth account,
 * refreshing and persisting new tokens if the stored one is expired/near expiry.
 * Throws if the account is not OAuth-based or has no usable credentials.
 */
export async function getValidAccessToken(account: Account): Promise<string> {
  if (account.provider !== 'gmail' && account.provider !== 'outlook') {
    throw new Error(`Account ${account.id} is not an OAuth account`);
  }
  if (!account.oauth_access_token_enc) {
    throw new Error(`Account ${account.id} has no stored OAuth access token`);
  }

  if (!isExpired(account.oauth_expires_at)) {
    return decrypt(account.oauth_access_token_enc);
  }

  if (!account.oauth_refresh_token_enc) {
    throw new Error(`Account ${account.id} access token expired and no refresh token stored`);
  }
  const refreshCredential = decrypt(account.oauth_refresh_token_enc);

  logger.info({ accountId: account.id, provider: account.provider }, 'refreshing OAuth token');

  const refreshed =
    account.provider === 'gmail'
      ? await gmail.refreshAccessToken(refreshCredential)
      : await outlook.refreshAccessToken(refreshCredential, account.email_address);

  await updateAccount(account.id, {
    oauth_access_token_enc: encrypt(refreshed.accessToken),
    // Providers often omit a new refresh token; keep the existing one then.
    ...(refreshed.refreshToken
      ? { oauth_refresh_token_enc: encrypt(refreshed.refreshToken) }
      : {}),
    oauth_expires_at: refreshed.expiresAt,
  });

  return refreshed.accessToken;
}

/** Force-refreshes tokens for an account id (used by the API refresh endpoint). */
export async function forceRefresh(accountId: string): Promise<void> {
  const account = await getAccountById(accountId);
  if (!account) throw new Error('Account not found');
  if (account.provider !== 'gmail' && account.provider !== 'outlook') {
    throw new Error('Account is not an OAuth account');
  }
  if (!account.oauth_refresh_token_enc) {
    throw new Error('No refresh token stored for this account');
  }
  const refreshCredential = decrypt(account.oauth_refresh_token_enc);
  const refreshed =
    account.provider === 'gmail'
      ? await gmail.refreshAccessToken(refreshCredential)
      : await outlook.refreshAccessToken(refreshCredential, account.email_address);

  await updateAccount(account.id, {
    oauth_access_token_enc: encrypt(refreshed.accessToken),
    ...(refreshed.refreshToken
      ? { oauth_refresh_token_enc: encrypt(refreshed.refreshToken) }
      : {}),
    oauth_expires_at: refreshed.expiresAt,
  });
}
