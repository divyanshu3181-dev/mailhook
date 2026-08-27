-- ============================================
-- MailHook Schema for Supabase (Postgres)
-- Run this in your Supabase project (SQL editor or `supabase db push`)
-- before starting MailHook for the first time.
-- ============================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Connected email accounts
CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('gmail', 'outlook', 'yahoo', 'custom')),
  email_address TEXT NOT NULL UNIQUE,

  -- OAuth credentials (encrypted at rest by app layer)
  oauth_access_token_enc TEXT,
  oauth_refresh_token_enc TEXT,
  oauth_expires_at TIMESTAMPTZ,

  -- IMAP credentials (encrypted at rest by app layer)
  imap_host TEXT,
  imap_port INTEGER DEFAULT 993,
  imap_user TEXT,
  imap_pass_enc TEXT,

  -- IMAP settings
  imap_tls BOOLEAN NOT NULL DEFAULT TRUE,
  watch_folder TEXT NOT NULL DEFAULT 'INBOX',

  -- Connection state
  connection_status TEXT NOT NULL DEFAULT 'disconnected'
    CHECK (connection_status IN ('connected', 'disconnected', 'connecting', 'error')),
  last_error TEXT,
  last_connected_at TIMESTAMPTZ,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,

  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Rules: which emails trigger which webhooks
CREATE TABLE rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  webhook_url TEXT NOT NULL,
  secret TEXT NOT NULL,

  -- Filters (all optional — if all null, matches every email)
  filter_from TEXT,
  filter_to TEXT,
  filter_subject TEXT,
  filter_has_attachment BOOLEAN,
  filter_label TEXT,
  filter_unseen_only BOOLEAN NOT NULL DEFAULT TRUE,

  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Delivery log
CREATE TABLE delivery_log (
  id BIGSERIAL PRIMARY KEY,
  rule_id UUID NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email_uid TEXT,
  message_id TEXT,
  from_address TEXT NOT NULL,
  to_address TEXT,
  subject TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivered', 'failed', 'retrying')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 4,
  last_attempt_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ,
  response_code INTEGER,
  response_body TEXT,
  error_message TEXT,
  payload_size INTEGER,
  processing_time_ms INTEGER,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_accounts_email ON accounts(email_address);
CREATE INDEX idx_accounts_status ON accounts(connection_status);
CREATE INDEX idx_rules_account ON rules(account_id);
CREATE INDEX idx_logs_rule ON delivery_log(rule_id);
CREATE INDEX idx_logs_account ON delivery_log(account_id);
CREATE INDEX idx_logs_status ON delivery_log(status);
CREATE INDEX idx_logs_created ON delivery_log(created_at);

-- Auto-update updated_at on accounts and rules
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER accounts_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER rules_updated_at
  BEFORE UPDATE ON rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
