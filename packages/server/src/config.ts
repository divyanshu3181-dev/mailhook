import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

// The dev script runs with cwd=packages/server (pnpm --filter cd's in), but the
// .env lives at the monorepo root. Walk up from this file until we find a .env
// so config loads regardless of which directory the process was launched from.
function findEnvPath(): string | undefined {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

loadEnv({ path: findEnvPath() });

function envStr(key: string, fallback: string): string {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
}

function envOptional(key: string): string | undefined {
  const v = process.env[key];
  return v === undefined || v === '' ? undefined : v;
}

export interface AppConfig {
  api: {
    port: number;
    host: string;
    apiKey: string;
    baseUrl: string;
  };
  supabase: {
    url: string;
    serviceRoleKey: string;
    jwtSecret?: string;
  };
  auth: {
    /** Lowercased allowlist of emails permitted to sign in. Empty = deny all. */
    allowlist: string[];
  };
  encryption: {
    key?: string; // 64 hex chars; required (see validateConfig)
  };
  google: {
    clientId?: string;
    clientSecret?: string;
  };
  microsoft: {
    clientId?: string;
    clientSecret?: string;
  };
  imap: {
    idleTimeout: number;
    maxReconnectAttempts: number;
    reconnectMaxDelay: number;
    neverGiveUp: boolean;
    keepaliveInterval: number;
  };
  forwarder: {
    webhookTimeout: number;
    maxRetryAttempts: number;
    concurrency: number;
    maxAttachmentSize: number;
  };
  log: {
    level: string;
    retentionDays: number;
  };
  version: string;
}

export const config: AppConfig = {
  api: {
    // Railway (and most PaaS) inject the bound port as PORT; honor it first,
    // then an explicit API_PORT, then the local default.
    port: envInt('PORT', envInt('API_PORT', 3000)),
    host: envStr('API_HOST', '0.0.0.0'),
    apiKey: envStr('API_KEY', 'change-me-to-a-random-string'),
    baseUrl: envStr('BASE_URL', 'http://localhost:3000'),
  },
  supabase: {
    url: envStr('SUPABASE_URL', ''),
    serviceRoleKey: envStr('SUPABASE_SERVICE_ROLE_KEY', ''),
    jwtSecret: envOptional('SUPABASE_JWT_SECRET'),
  },
  auth: {
    allowlist: envStr('AUTH_ALLOWLIST', '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  },
  encryption: {
    key: envOptional('ENCRYPTION_KEY'),
  },
  google: {
    clientId: envOptional('GOOGLE_CLIENT_ID'),
    clientSecret: envOptional('GOOGLE_CLIENT_SECRET'),
  },
  microsoft: {
    clientId: envOptional('MICROSOFT_CLIENT_ID'),
    clientSecret: envOptional('MICROSOFT_CLIENT_SECRET'),
  },
  imap: {
    idleTimeout: envInt('IMAP_IDLE_TIMEOUT', 300000),
    maxReconnectAttempts: envInt('MAX_RECONNECT_ATTEMPTS', 10),
    reconnectMaxDelay: envInt('RECONNECT_MAX_DELAY', 300000),
    // When true (default), an account keeps retrying forever with capped
    // backoff and is never auto-deactivated — it just stays in `error` between
    // attempts until the provider is reachable again. Set IMAP_NEVER_GIVE_UP=0
    // to fall back to deactivating after MAX_RECONNECT_ATTEMPTS.
    neverGiveUp: envStr('IMAP_NEVER_GIVE_UP', '1') !== '0',
    // How often (ms) to proactively verify the connection is alive with a NOOP.
    keepaliveInterval: envInt('IMAP_KEEPALIVE_INTERVAL', 60_000),
  },
  forwarder: {
    webhookTimeout: envInt('WEBHOOK_TIMEOUT', 30000),
    maxRetryAttempts: envInt('MAX_RETRY_ATTEMPTS', 4),
    concurrency: envInt('FORWARDER_CONCURRENCY', 10),
    maxAttachmentSize: envInt('MAX_ATTACHMENT_SIZE', 10485760),
  },
  log: {
    level: envStr('LOG_LEVEL', 'info'),
    retentionDays: envInt('LOG_RETENTION_DAYS', 30),
  },
  version: '1.0.0',
};

/**
 * Fails fast on missing required configuration. Called at startup before any
 * DB or crypto work. Returns the list of problems (empty = OK) so the caller
 * can log and exit.
 */
export function validateConfig(): string[] {
  const problems: string[] = [];
  if (!config.supabase.url) problems.push('SUPABASE_URL is required');
  if (!config.supabase.serviceRoleKey) {
    problems.push('SUPABASE_SERVICE_ROLE_KEY is required (use the service_role key, not anon)');
  }
  if (!config.encryption.key) {
    problems.push(
      'ENCRYPTION_KEY is required (64 hex chars). Credentials are stored in a shared database, ' +
        'so an ephemeral key is unsafe. Generate one with: ' +
        "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  } else if (!/^[0-9a-fA-F]{64}$/.test(config.encryption.key)) {
    problems.push('ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes)');
  }
  if (!config.supabase.jwtSecret) {
    problems.push(
      'SUPABASE_JWT_SECRET is required for admin authentication ' +
        '(Supabase dashboard → Settings → API → JWT Secret)'
    );
  }
  if (config.auth.allowlist.length === 0) {
    problems.push(
      'AUTH_ALLOWLIST is empty — no one could sign in. Set it to a comma-separated ' +
        'list of allowed admin emails, e.g. AUTH_ALLOWLIST=you@example.com'
    );
  }
  return problems;
}

export function isGoogleConfigured(): boolean {
  return Boolean(config.google.clientId && config.google.clientSecret);
}

export function isMicrosoftConfigured(): boolean {
  return Boolean(config.microsoft.clientId && config.microsoft.clientSecret);
}
