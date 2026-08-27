import { randomBytes } from 'node:crypto';
import { getDb } from './database.js';

// ---------------------------------------------------------------------------
// Types (Postgres: booleans are real booleans, timestamps are ISO strings)
// ---------------------------------------------------------------------------

export type Provider = 'gmail' | 'outlook' | 'yahoo' | 'custom';
export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error';
export type DeliveryStatus = 'pending' | 'delivered' | 'failed' | 'retrying';

export interface Account {
  id: string;
  name: string;
  provider: Provider;
  email_address: string;
  oauth_access_token_enc: string | null;
  oauth_refresh_token_enc: string | null;
  oauth_expires_at: string | null;
  imap_host: string | null;
  imap_port: number | null;
  imap_user: string | null;
  imap_pass_enc: string | null;
  imap_tls: boolean;
  watch_folder: string;
  connection_status: ConnectionStatus;
  last_error: string | null;
  last_connected_at: string | null;
  consecutive_failures: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
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
  processing_time_ms: number | null;
  delivered_at: string | null;
  created_at: string;
}

export function generateSecret(): string {
  return randomBytes(32).toString('hex');
}

const NO_ROWS = 'PGRST116'; // Supabase: .single() found no rows

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export async function getAllAccounts(): Promise<Account[]> {
  const { data, error } = await getDb()
    .from('accounts')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Account[];
}

export async function getActiveAccounts(): Promise<Account[]> {
  const { data, error } = await getDb()
    .from('accounts')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Account[];
}

export async function getAccountById(id: string): Promise<Account | null> {
  const { data, error } = await getDb().from('accounts').select('*').eq('id', id).single();
  if (error && error.code !== NO_ROWS) throw error;
  return (data as Account) ?? null;
}

export async function getAccountByEmail(email: string): Promise<Account | null> {
  const { data, error } = await getDb()
    .from('accounts')
    .select('*')
    .eq('email_address', email.toLowerCase().trim())
    .single();
  if (error && error.code !== NO_ROWS) throw error;
  return (data as Account) ?? null;
}

export interface CreateAccountInput {
  name: string;
  provider: Provider;
  email_address: string;
  oauth_access_token_enc?: string | null;
  oauth_refresh_token_enc?: string | null;
  oauth_expires_at?: string | null;
  imap_host?: string | null;
  imap_port?: number | null;
  imap_user?: string | null;
  imap_pass_enc?: string | null;
  imap_tls?: boolean;
  watch_folder?: string;
  is_active?: boolean;
}

export async function createAccount(account: CreateAccountInput): Promise<Account> {
  const row = {
    ...account,
    email_address: account.email_address.toLowerCase().trim(),
    imap_port: account.imap_port ?? 993,
    imap_tls: account.imap_tls ?? true,
    watch_folder: account.watch_folder ?? 'INBOX',
    is_active: account.is_active ?? true,
  };
  const { data, error } = await getDb().from('accounts').insert(row).select().single();
  if (error) throw error;
  return data as Account;
}

export interface UpdateAccountInput {
  name?: string;
  connection_status?: ConnectionStatus;
  last_error?: string | null;
  last_connected_at?: string | null;
  consecutive_failures?: number;
  is_active?: boolean;
  watch_folder?: string;
  oauth_access_token_enc?: string | null;
  oauth_refresh_token_enc?: string | null;
  oauth_expires_at?: string | null;
}

export async function updateAccount(
  id: string,
  updates: UpdateAccountInput
): Promise<Account> {
  const { data, error } = await getDb()
    .from('accounts')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as Account;
}

export async function deleteAccount(id: string): Promise<void> {
  const { error } = await getDb().from('accounts').delete().eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** Active rules for an account — used by the filter engine on each new email. */
export async function getRulesByAccount(accountId: string): Promise<Rule[]> {
  const { data, error } = await getDb()
    .from('rules')
    .select('*')
    .eq('account_id', accountId)
    .eq('is_active', true);
  if (error) throw error;
  return (data ?? []) as Rule[];
}

export async function getAllRules(accountId?: string): Promise<Rule[]> {
  let query = getDb().from('rules').select('*').order('created_at', { ascending: false });
  if (accountId) query = query.eq('account_id', accountId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Rule[];
}

export async function getRuleById(id: string): Promise<Rule | null> {
  const { data, error } = await getDb().from('rules').select('*').eq('id', id).single();
  if (error && error.code !== NO_ROWS) throw error;
  return (data as Rule) ?? null;
}

export interface CreateRuleInput {
  account_id: string;
  name: string;
  webhook_url: string;
  secret?: string;
  filter_from?: string | null;
  filter_to?: string | null;
  filter_subject?: string | null;
  filter_has_attachment?: boolean | null;
  filter_label?: string | null;
  filter_unseen_only?: boolean;
  is_active?: boolean;
}

export async function createRule(rule: CreateRuleInput): Promise<Rule> {
  const row = {
    ...rule,
    webhook_url: rule.webhook_url.trim(),
    secret: rule.secret ?? generateSecret(),
    filter_unseen_only: rule.filter_unseen_only ?? true,
    is_active: rule.is_active ?? true,
  };
  const { data, error } = await getDb().from('rules').insert(row).select().single();
  if (error) throw error;
  return data as Rule;
}

export interface UpdateRuleInput {
  name?: string;
  webhook_url?: string;
  secret?: string;
  filter_from?: string | null;
  filter_to?: string | null;
  filter_subject?: string | null;
  filter_has_attachment?: boolean | null;
  filter_label?: string | null;
  filter_unseen_only?: boolean;
  is_active?: boolean;
}

export async function updateRule(id: string, updates: UpdateRuleInput): Promise<Rule> {
  const { data, error } = await getDb()
    .from('rules')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as Rule;
}

export async function deleteRule(id: string): Promise<void> {
  const { error } = await getDb().from('rules').delete().eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Delivery log
// ---------------------------------------------------------------------------

export interface CreateDeliveryLogInput {
  rule_id: string;
  account_id: string;
  email_uid?: string | null;
  message_id?: string | null;
  from_address: string;
  to_address?: string | null;
  subject?: string;
  status?: DeliveryStatus;
  max_attempts?: number;
  payload_size?: number;
}

export async function createDeliveryLog(log: CreateDeliveryLogInput): Promise<DeliveryLog> {
  const { data, error } = await getDb().from('delivery_log').insert(log).select().single();
  if (error) throw error;
  return data as DeliveryLog;
}

export interface UpdateDeliveryLogInput {
  status?: DeliveryStatus;
  attempts?: number;
  last_attempt_at?: string;
  next_retry_at?: string | null;
  response_code?: number | null;
  response_body?: string | null;
  error_message?: string | null;
  delivered_at?: string | null;
  processing_time_ms?: number | null;
}

export async function updateDeliveryLog(
  id: number | string,
  updates: UpdateDeliveryLogInput
): Promise<void> {
  const { error } = await getDb().from('delivery_log').update(updates).eq('id', id);
  if (error) throw error;
}

export async function getLogById(id: number | string): Promise<DeliveryLog | null> {
  const { data, error } = await getDb().from('delivery_log').select('*').eq('id', id).single();
  if (error && error.code !== NO_ROWS) throw error;
  return (data as DeliveryLog) ?? null;
}

/**
 * True if a delivery for this (rule, message_id) already exists in any state.
 * Used to de-duplicate: reconnect/restart sweeps re-see the same UNSEEN mail,
 * and this prevents a second webhook for a message a rule already handled.
 * Messages with no Message-ID header are treated as never-seen (returns false).
 */
export async function deliveryExists(
  ruleId: string,
  messageId: string | null
): Promise<boolean> {
  if (!messageId) return false;
  const { data, error } = await getDb()
    .from('delivery_log')
    .select('id')
    .eq('rule_id', ruleId)
    .eq('message_id', messageId)
    .limit(1);
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export interface LogFilters {
  status?: DeliveryStatus;
  account_id?: string;
  rule_id?: string;
  from_date?: string;
  to_date?: string;
  page?: number;
  limit?: number;
}

export async function getLogs(
  filters: LogFilters
): Promise<{ data: DeliveryLog[]; total: number; page: number; limit: number }> {
  const page = filters.page || 1;
  const limit = filters.limit || 50;
  const offset = (page - 1) * limit;

  let query = getDb()
    .from('delivery_log')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.account_id) query = query.eq('account_id', filters.account_id);
  if (filters.rule_id) query = query.eq('rule_id', filters.rule_id);
  if (filters.from_date) query = query.gte('created_at', filters.from_date);
  if (filters.to_date) query = query.lte('created_at', filters.to_date);

  const { data, error, count } = await query;
  if (error) throw error;
  return { data: (data ?? []) as DeliveryLog[], total: count ?? 0, page, limit };
}

/**
 * Logs left unfinished by a previous process (crash recovery on startup).
 * Includes both `pending` rows (enqueued but never attempted before the crash)
 * and `retrying` rows (mid-backoff). Their in-memory payloads are gone, so
 * recovery marks any it cannot re-send as failed rather than leaving them stuck.
 */
export async function getRetryableLogs(): Promise<DeliveryLog[]> {
  const { data, error } = await getDb()
    .from('delivery_log')
    .select('*')
    .in('status', ['pending', 'retrying']);
  if (error) throw error;
  return (data ?? []) as DeliveryLog[];
}

export async function purgeOldLogs(days: number): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const { error, count } = await getDb()
    .from('delivery_log')
    .delete({ count: 'exact' })
    .lt('created_at', cutoff.toISOString());
  if (error) throw error;
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

function startOfToday(): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today.toISOString();
}

export async function getDeliveriesToday(): Promise<number> {
  const { count, error } = await getDb()
    .from('delivery_log')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'delivered')
    .gte('created_at', startOfToday());
  if (error) throw error;
  return count ?? 0;
}

export async function getFailedToday(): Promise<number> {
  const { count, error } = await getDb()
    .from('delivery_log')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'failed')
    .gte('created_at', startOfToday());
  if (error) throw error;
  return count ?? 0;
}

export async function getSuccessRate7d(): Promise<number> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const since = sevenDaysAgo.toISOString();

  const { count: total, error: err1 } = await getDb()
    .from('delivery_log')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', since)
    .in('status', ['delivered', 'failed']);
  if (err1) throw err1;
  if (!total || total === 0) return 100;

  const { count: delivered, error: err2 } = await getDb()
    .from('delivery_log')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'delivered')
    .gte('created_at', since);
  if (err2) throw err2;

  return Math.round(((delivered ?? 0) / total) * 1000) / 10;
}

export async function getAvgProcessingTime7d(): Promise<number> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const { data, error } = await getDb()
    .from('delivery_log')
    .select('processing_time_ms')
    .eq('status', 'delivered')
    .not('processing_time_ms', 'is', null)
    .gte('created_at', sevenDaysAgo.toISOString());
  if (error) throw error;
  const rows = (data ?? []) as { processing_time_ms: number | null }[];
  if (rows.length === 0) return 0;
  const sum = rows.reduce((acc, r) => acc + (r.processing_time_ms ?? 0), 0);
  return Math.round(sum / rows.length);
}

export interface AccountStats {
  total: number;
  connected: number;
  errored: number;
}

export async function getAccountStats(): Promise<AccountStats> {
  const { data, error } = await getDb().from('accounts').select('connection_status');
  if (error) throw error;
  const rows = (data ?? []) as { connection_status: ConnectionStatus }[];
  return {
    total: rows.length,
    connected: rows.filter((a) => a.connection_status === 'connected').length,
    errored: rows.filter((a) => a.connection_status === 'error').length,
  };
}

export async function getTotalRules(): Promise<number> {
  const { count, error } = await getDb()
    .from('rules')
    .select('*', { count: 'exact', head: true });
  if (error) throw error;
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Aggregates for UI list views
// ---------------------------------------------------------------------------

export async function countRulesForAccount(accountId: string): Promise<number> {
  const { count, error } = await getDb()
    .from('rules')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', accountId);
  if (error) throw error;
  return count ?? 0;
}

/** Deliveries per rule within the last N hours. */
export async function getRuleDeliveryCounts(hours: number): Promise<Map<string, number>> {
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const { data, error } = await getDb()
    .from('delivery_log')
    .select('rule_id')
    .gte('created_at', since);
  if (error) throw error;
  const map = new Map<string, number>();
  for (const row of (data ?? []) as { rule_id: string }[]) {
    map.set(row.rule_id, (map.get(row.rule_id) ?? 0) + 1);
  }
  return map;
}

/** Most recent delivery timestamp per account. */
export async function getAccountLastDelivery(): Promise<Map<string, string>> {
  const { data, error } = await getDb()
    .from('delivery_log')
    .select('account_id, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const map = new Map<string, string>();
  for (const row of (data ?? []) as { account_id: string; created_at: string }[]) {
    if (!map.has(row.account_id)) map.set(row.account_id, row.created_at);
  }
  return map;
}
