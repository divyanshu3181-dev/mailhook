import type { Account } from '../db/queries.js';

/**
 * Public representation of an account — encrypted credentials are never
 * returned; their presence is signalled with `credentials_configured`.
 */
export interface PublicAccount {
  id: string;
  name: string;
  provider: string;
  email_address: string;
  imap_host: string | null;
  imap_port: number | null;
  imap_user: string | null;
  imap_tls: boolean;
  watch_folder: string;
  connection_status: string;
  last_error: string | null;
  last_connected_at: string | null;
  consecutive_failures: number;
  is_active: boolean;
  credentials_configured: boolean;
  oauth_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export function publicAccount(account: Account): PublicAccount {
  const credentials_configured = Boolean(
    account.oauth_access_token_enc || account.imap_pass_enc
  );
  return {
    id: account.id,
    name: account.name,
    provider: account.provider,
    email_address: account.email_address,
    imap_host: account.imap_host,
    imap_port: account.imap_port,
    imap_user: account.imap_user,
    imap_tls: account.imap_tls,
    watch_folder: account.watch_folder,
    connection_status: account.connection_status,
    last_error: account.last_error,
    last_connected_at: account.last_connected_at,
    consecutive_failures: account.consecutive_failures,
    is_active: account.is_active,
    credentials_configured,
    oauth_expires_at: account.oauth_expires_at,
    created_at: account.created_at,
    updated_at: account.updated_at,
  };
}
