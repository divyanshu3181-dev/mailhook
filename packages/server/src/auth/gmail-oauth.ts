import { google } from 'googleapis';
import { config, isGoogleConfigured } from '../config.js';
import { logger } from '../logger.js';

const GMAIL_SCOPE = 'https://mail.google.com/';
const REDIRECT_PATH = '/api/oauth/google/callback';

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  /** ISO 8601 expiry. */
  expiresAt: string;
}

function redirectUri(): string {
  return `${config.api.baseUrl.replace(/\/$/, '')}${REDIRECT_PATH}`;
}

function makeClient() {
  if (!isGoogleConfigured()) {
    throw new Error('Google OAuth is not configured (GOOGLE_CLIENT_ID/SECRET missing)');
  }
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    redirectUri()
  );
}

/** Builds the Google consent URL. `state` should be a CSRF token. */
export function buildAuthUrl(state: string): string {
  const client = makeClient();
  return client.generateAuthUrl({
    access_type: 'offline', // returns a refresh_token
    prompt: 'consent', // forces refresh_token even on re-auth
    scope: [GMAIL_SCOPE],
    state,
  });
}

function expiryIso(expiryDate: number | null | undefined): string {
  // googleapis returns expiry_date as ms epoch; fall back to +1h.
  const ms = expiryDate ?? Date.now() + 3600_000;
  return new Date(ms).toISOString();
}

/** Exchanges an authorization code for tokens. */
export async function exchangeCode(code: string): Promise<OAuthTokens> {
  const client = makeClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token) {
    throw new Error('Google did not return an access token');
  }
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresAt: expiryIso(tokens.expiry_date),
  };
}

/** Fetches the authenticated user's primary email address. */
export async function fetchEmailAddress(accessToken: string): Promise<string> {
  const client = makeClient();
  client.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: 'v1', auth: client });
  const profile = await gmail.users.getProfile({ userId: 'me' });
  const email = profile.data.emailAddress;
  if (!email) throw new Error('Could not read email address from Gmail profile');
  return email.toLowerCase();
}

/** Refreshes an access token using a stored refresh token. */
export async function refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
  const client = makeClient();
  client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await client.refreshAccessToken();
  if (!credentials.access_token) {
    throw new Error('Google refresh did not return an access token');
  }
  logger.debug('refreshed Google access token');
  return {
    accessToken: credentials.access_token,
    // Google usually omits refresh_token on refresh; caller keeps the old one.
    refreshToken: credentials.refresh_token ?? null,
    expiresAt: expiryIso(credentials.expiry_date),
  };
}

export const gmailImap = { host: 'imap.gmail.com', port: 993, secure: true };
