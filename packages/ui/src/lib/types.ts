export type Provider = 'gmail' | 'outlook' | 'yahoo' | 'custom';
export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error';
export type DeliveryStatus = 'pending' | 'delivered' | 'failed' | 'retrying';

export interface Account {
  id: string;
  name: string;
  provider: Provider;
  email_address: string;
  imap_host: string | null;
  imap_port: number | null;
  imap_user: string | null;
  imap_tls: boolean;
  watch_folder: string;
  connection_status: ConnectionStatus;
  last_error: string | null;
  last_connected_at: string | null;
  consecutive_failures: number;
  is_active: boolean;
  credentials_configured: boolean;
  oauth_expires_at: string | null;
  created_at: string;
  updated_at: string;
  rule_count?: number;
  last_delivery_at?: string | null;
  live_status?: { connected: boolean };
}

export interface Rule {
  id: string;
  account_id: string;
  name: string;
  webhook_url: string;
  secret: string;
  filter_from: string | null;
  filter_to: string | null;
  filter_subject: string | null;
  filter_has_attachment: boolean | null;
  filter_label: string | null;
  filter_unseen_only: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deliveries_24h?: number;
}

export interface DeliveryLog {
  id: number;
  rule_id: string;
  account_id: string;
  email_uid: string | null;
  message_id: string | null;
  from_address: string;
  to_address: string | null;
  subject: string;
  status: DeliveryStatus;
  attempts: number;
  max_attempts: number;
  last_attempt_at: string | null;
  next_retry_at: string | null;
  response_code: number | null;
  response_body: string | null;
  error_message: string | null;
  payload_size: number | null;
  delivered_at: string | null;
  processing_time_ms: number | null;
  created_at: string;
}

export interface Stats {
  total_accounts: number;
  active_connections: number;
  errored_connections: number;
  total_rules: number;
  deliveries_today: number;
  failed_today: number;
  success_rate_7d: number;
  avg_processing_time_ms: number | null;
}

export interface HealthInfo {
  status: string;
  version: string;
  uptime: number;
  accounts: { total: number; connected: number; error: number };
  queue: { pending: number; processing: number };
}

export interface SettingsInfo {
  version: string;
  node_version: string;
  uptime: number;
  encryption_key_persistent: boolean;
  providers: { google: boolean; microsoft: boolean };
  base_url: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

/** Shape returned by the raw Supabase-backed list endpoints. */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}
