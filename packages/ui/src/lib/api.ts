import type {
  Account,
  Rule,
  DeliveryLog,
  Stats,
  HealthInfo,
  SettingsInfo,
  Pagination,
} from './types';

const KEY_STORAGE = 'mailhook_api_key';

export function getApiKey(): string {
  return localStorage.getItem(KEY_STORAGE) ?? '';
}

export function setApiKey(key: string): void {
  localStorage.setItem(KEY_STORAGE, key);
}

export function clearApiKey(): void {
  localStorage.removeItem(KEY_STORAGE);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${getApiKey()}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`/api${path}`, { ...init, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message = (data && data.error) || res.statusText;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

// ---- Accounts ----

export const accountsApi = {
  list: () => request<{ data: Account[] }>('/accounts').then((r) => r.data),
  get: (id: string) => request<Account>(`/accounts/${id}`),
  createCustom: (body: Record<string, unknown>) =>
    request<Account>('/accounts/custom', { method: 'POST', body: JSON.stringify(body) }),
  test: (body: Record<string, unknown>) =>
    request<{ ok: boolean; error?: string }>('/accounts/test', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  update: (id: string, body: Record<string, unknown>) =>
    request<Account>(`/accounts/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  remove: (id: string) =>
    request<{ deleted: boolean }>(`/accounts/${id}`, { method: 'DELETE' }),
  reconnect: (id: string) =>
    request<{ reconnecting: boolean }>(`/accounts/${id}/reconnect`, { method: 'POST' }),
};

// ---- OAuth ----

export const oauthApi = {
  googleUrl: () => request<{ url: string }>('/oauth/google/url'),
  microsoftUrl: () => request<{ url: string }>('/oauth/microsoft/url'),
  refresh: (id: string) =>
    request<{ refreshed: boolean }>(`/oauth/${id}/refresh`, { method: 'POST' }),
};

// ---- Rules ----

export const rulesApi = {
  list: (accountId?: string) =>
    request<{ data: Rule[] }>(
      `/rules${accountId ? `?account_id=${encodeURIComponent(accountId)}` : ''}`
    ).then((r) => r.data),
  get: (id: string) => request<Rule>(`/rules/${id}`),
  create: (body: Record<string, unknown>) =>
    request<Rule>('/rules', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: Record<string, unknown>) =>
    request<Rule>(`/rules/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  remove: (id: string) => request<{ deleted: boolean }>(`/rules/${id}`, { method: 'DELETE' }),
  regenerateSecret: (id: string) =>
    request<{ id: string; secret: string }>(`/rules/${id}/regenerate-secret`, {
      method: 'POST',
    }),
  test: (id: string) =>
    request<{
      ok: boolean;
      response_code: number | null;
      response_body: string | null;
      error_message: string | null;
    }>(`/rules/${id}/test`, { method: 'POST' }),
};

// ---- Logs ----

export interface LogFilters {
  page?: number;
  limit?: number;
  status?: string;
  account_id?: string;
  rule_id?: string;
  from?: string;
  to?: string;
}

export const logsApi = {
  list: (filters: LogFilters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== '') params.set(k, String(v));
    });
    const qs = params.toString();
    return request<{ data: DeliveryLog[]; pagination: Pagination }>(
      `/logs${qs ? `?${qs}` : ''}`
    );
  },
  get: (id: number) => request<DeliveryLog>(`/logs/${id}`),
  retry: (id: number) =>
    request<{ retrying: boolean }>(`/logs/${id}/retry`, { method: 'POST' }),
  purge: (days: number) =>
    request<{ purged: number; older_than_days: number }>(`/logs/purge?days=${days}`, {
      method: 'DELETE',
    }),
};

// ---- System ----

export const systemApi = {
  health: () => request<HealthInfo>('/health'),
  stats: () => request<Stats>('/stats'),
  settings: () => request<SettingsInfo>('/settings'),
};

// ---- Display helpers ----

/**
 * Formats an ISO 8601 timestamp for display. Tolerates both Postgres-style
 * ("2026-08-27T10:30:00.000Z") and legacy SQLite-style ("2026-08-27 10:30:00",
 * interpreted as UTC) inputs. Returns "—" for null/undefined/unparseable.
 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const normalized = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

/** Relative time like "2m ago" / "3h ago". Returns "—" for null/unparseable. */
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const normalized = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return '—';
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diffSec < 60) return `${Math.max(diffSec, 0)}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

/** Truncates a UUID for compact display: "550e8400-…". Returns "—" if empty. */
export function truncateId(id: string | null | undefined, len = 8): string {
  if (!id) return '—';
  if (id.length <= len) return id;
  return id.slice(0, len) + '…';
}
