import {
  ConfidentialClientApplication,
  type Configuration,
  type AuthorizationUrlRequest,
  type AuthorizationCodeRequest,
} from '@azure/msal-node';
import { config, isMicrosoftConfigured } from '../config.js';
import { logger } from '../logger.js';
import type { OAuthTokens } from './gmail-oauth.js';

const REDIRECT_PATH = '/api/oauth/microsoft/callback';
const SCOPES = [
  'https://outlook.office365.com/IMAP.AccessAsUser.All',
  'offline_access',
  'openid',
  'email',
];
const AUTHORITY = 'https://login.microsoftonline.com/common';

function redirectUri(): string {
  return `${config.api.baseUrl.replace(/\/$/, '')}${REDIRECT_PATH}`;
}

let cachedApp: ConfidentialClientApplication | null = null;

function getApp(): ConfidentialClientApplication {
  if (cachedApp) return cachedApp;
  if (!isMicrosoftConfigured()) {
    throw new Error('Microsoft OAuth is not configured (MICROSOFT_CLIENT_ID/SECRET missing)');
  }
  const msalConfig: Configuration = {
    auth: {
      clientId: config.microsoft.clientId as string,
      clientSecret: config.microsoft.clientSecret as string,
      authority: AUTHORITY,
    },
  };
  cachedApp = new ConfidentialClientApplication(msalConfig);
  return cachedApp;
}

export async function buildAuthUrl(state: string): Promise<string> {
  const req: AuthorizationUrlRequest = {
    scopes: SCOPES,
    redirectUri: redirectUri(),
    state,
    prompt: 'select_account',
  };
  return getApp().getAuthCodeUrl(req);
}

function expiryIso(expiresOn: Date | null): string {
  return (expiresOn ?? new Date(Date.now() + 3600_000)).toISOString();
}

export interface OutlookAuthResult extends OAuthTokens {
  email: string;
}

/** Exchanges an authorization code for tokens and extracts the email. */
export async function exchangeCode(code: string): Promise<OutlookAuthResult> {
  const req: AuthorizationCodeRequest = {
    code,
    scopes: SCOPES,
    redirectUri: redirectUri(),
  };
  const result = await getApp().acquireTokenByCode(req);
  if (!result?.accessToken) {
    throw new Error('Microsoft did not return an access token');
  }

  const email =
    (result.account?.username as string | undefined) ??
    (result.idTokenClaims as { email?: string; preferred_username?: string } | undefined)
      ?.email ??
    (result.idTokenClaims as { preferred_username?: string } | undefined)?.preferred_username;

  if (!email) throw new Error('Could not determine email address from Microsoft token');

  // MSAL manages refresh tokens in its token cache. Serialize the cache so we
  // can re-hydrate it later for silent refresh.
  const refreshToken = getApp().getTokenCache().serialize();

  return {
    accessToken: result.accessToken,
    refreshToken,
    expiresAt: expiryIso(result.expiresOn),
    email: email.toLowerCase(),
  };
}

/**
 * Silent token refresh. We stored the serialized MSAL token cache as the
 * "refresh token"; re-hydrate it and acquire a token silently for the account.
 */
export async function refreshAccessToken(
  serializedCache: string,
  email: string
): Promise<OAuthTokens> {
  const app = getApp();
  app.getTokenCache().deserialize(serializedCache);

  const accounts = await app.getTokenCache().getAllAccounts();
  const account =
    accounts.find((a) => a.username.toLowerCase() === email.toLowerCase()) ?? accounts[0];
  if (!account) {
    throw new Error('No cached Microsoft account available for silent refresh');
  }

  const result = await app.acquireTokenSilent({ account, scopes: SCOPES });
  if (!result?.accessToken) {
    throw new Error('Microsoft silent refresh did not return an access token');
  }
  logger.debug('refreshed Microsoft access token');

  return {
    accessToken: result.accessToken,
    refreshToken: app.getTokenCache().serialize(),
    expiresAt: expiryIso(result.expiresOn),
  };
}

export const outlookImap = { host: 'outlook.office365.com', port: 993, secure: true };
