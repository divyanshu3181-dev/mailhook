# MailHook

Instant email-to-webhook relay using IMAP IDLE. MailHook connects to your existing
email accounts (Gmail, Outlook, Yahoo, or any IMAP provider), watches inboxes in
real time, and POSTs matching emails as signed JSON to configured webhook URLs.

No MX records, no DNS changes, no port 25 — your email keeps working exactly as
before. MailHook just watches via IMAP and reacts (1–3s latency).

## Run locally

```bash
pnpm install
cp .env.example .env
# Edit .env — required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, API_KEY,
# ENCRYPTION_KEY (generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))").
# Optionally set GOOGLE_/MICROSOFT_ OAuth.
#
# Before first start, apply the schema to your Supabase project:
#   supabase/migrations/0001_mailhook_schema.sql  (SQL editor, or `supabase db push`)

# Terminal 1 — server (hot reload via tsx), API on :3000
pnpm --filter @mailhook/server dev

# Terminal 2 — UI (Vite dev server on :5173, proxies /api to :3000)
pnpm --filter @mailhook/ui dev
```

For a single-process run that serves the built UI from the API server:

```bash
pnpm build
pnpm start        # node packages/server/dist/index.js — UI + API on :3000
```

## Build

```bash
pnpm build          # builds UI then server
pnpm typecheck      # typecheck both packages
```

## Docker

```bash
docker compose up --build
# UI + API at http://localhost:3000. State lives in Supabase (no local volume).
# Apply supabase/migrations/0001_mailhook_schema.sql to your project first.
```

## Architecture

```
IMAP IDLE (imapflow)  →  Parser (mailparser)  →  Rule Engine  →  Forwarder  →  Webhook
   per-account            ParsedEmail            match filters    HMAC sign     n8n / any
   push, no polling                              (AND semantics)  + POST        consumer
```

- **ConnectionManager** holds one persistent IMAP IDLE connection per active
  account. New mail fires an `exists` event; the manager fetches, parses,
  matches rules, and enqueues a webhook delivery per matching rule.
- **Retry queue** (`p-queue`) delivers with exponential backoff (10s, 60s, 300s,
  900s), in-process, no Redis. On a webhook failure it schedules a retry;
  `max_attempts` reached ⇒ `failed`.
- **Supabase (Postgres)** via `@supabase/supabase-js` is the datastore, accessed
  with the service-role key (bypasses RLS). Schema is managed by Supabase
  migrations, not the app. Credentials are encrypted at rest with AES-256-GCM
  before they ever reach the database.

## Key modules (packages/server/src)

| Path | Responsibility |
| --- | --- |
| `index.ts` | Entry point — encryption key, DB, retry recovery, API, IMAP, retention |
| `config.ts` | Env parsing with defaults |
| `db/database.ts`, `db/queries.ts` | Supabase client init + all async `@supabase/supabase-js` queries |
| `auth/encryption.ts` | AES-256-GCM encrypt/decrypt; auto-generates a key if unset |
| `auth/gmail-oauth.ts`, `auth/outlook-oauth.ts` | OAuth URL, code exchange, token refresh |
| `auth/tokens.ts` | Returns a valid access token, refreshing + persisting when expired |
| `connections/imap-client.ts` | One imapflow connection: IDLE, `exists`, UID-tracked fetch, test-connect |
| `connections/manager.ts` | All connections; message → parse → filter → enqueue; reconnect/backoff |
| `connections/reconnect.ts` | Backoff schedule + give-up threshold |
| `email/parser.ts` | mailparser → normalized `ParsedEmail` (attachments capped) |
| `email/filter.ts` | Rule matching — contains / `/regex/`, AND across filters |
| `forwarder/forwarder.ts` | Build payload + single HTTP delivery |
| `forwarder/signer.ts` | `HMAC-SHA256(timestamp.body)` |
| `forwarder/retry.ts` | Retry queue, backoff, crash recovery |
| `api/*` | Fastify plugin + accounts/rules/logs/oauth/system routes, API-key auth |

UI lives in `packages/ui` (React + Vite + Tailwind); built output is served by
Fastify as static files with SPA fallback.

## Webhook signature verification

Every POST carries:

```
X-MailHook-Signature: sha256=<hex>   # HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
X-MailHook-Timestamp: <unix-seconds>
X-MailHook-Event: email.received
X-MailHook-Rule-Id: <rule-id>
```

To verify: `hmac_sha256(rule.secret, timestamp + "." + rawRequestBody) === signature`.

## Environment variables

See `.env.example` for the full annotated list. Highlights:

| Var | Default | Notes |
| --- | --- | --- |
| `API_PORT` | 3000 | HTTP (UI + API) |
| `API_KEY` | change-me | Bearer token for all `/api/*` (except OAuth callbacks) |
| `BASE_URL` | http://localhost:3000 | Used to build OAuth redirect URIs |
| `SUPABASE_URL` | — (required) | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | — (required) | Service-role key (bypasses RLS); NOT the anon key |
| `ENCRYPTION_KEY` | — (required) | 64 hex chars. Set it and never change it — stored in a shared DB. |
| `GOOGLE_CLIENT_ID/SECRET` | — | Enables the Gmail OAuth button |
| `MICROSOFT_CLIENT_ID/SECRET` | — | Enables the Outlook OAuth button |
| `MAX_RECONNECT_ATTEMPTS` | 10 | Account is deactivated after this many failures |
| `WEBHOOK_TIMEOUT` | 30000 | ms |
| `MAX_RETRY_ATTEMPTS` | 4 | |
| `FORWARDER_CONCURRENCY` | 10 | max concurrent deliveries |
| `MAX_ATTACHMENT_SIZE` | 10485760 | bytes; larger attachments send metadata only (`truncated: true`) |
| `LOG_RETENTION_DAYS` | 30 | daily auto-purge |

## Testing (custom IMAP, no OAuth needed)

```bash
# 1. Add a custom IMAP account (validated by a live test-connect).
#    For Gmail-over-IMAP use a Google App Password (2FA required).
curl -X POST http://localhost:3000/api/accounts/custom \
  -H "Authorization: Bearer your-api-key" -H "Content-Type: application/json" \
  -d '{"name":"Test","email_address":"you@gmail.com","imap_host":"imap.gmail.com",
       "imap_port":993,"imap_user":"you@gmail.com","imap_pass":"app-password","imap_tls":true}'

# 2. Create a match-all rule pointing at your webhook.
curl -X POST http://localhost:3000/api/rules \
  -H "Authorization: Bearer your-api-key" -H "Content-Type: application/json" \
  -d '{"account_id":"<id>","name":"All to webhook","webhook_url":"https://webhook.site/xxxx"}'

# 3. Send an email to that inbox → webhook fires within a few seconds.
# 4. GET /api/logs shows status "delivered" with processing_time_ms.
# 5. Dry-run without waiting for mail: POST /api/rules/<id>/test
```

Supported providers: Gmail (OAuth), Outlook (OAuth),
Yahoo/Zoho/iCloud/FastMail/GMX/AOL/Custom (IMAP credentials or app passwords).
