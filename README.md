# MailHook

**Instant email-to-webhook relay using IMAP IDLE.** Connect your existing email
accounts, define rules for which emails to watch, and MailHook POSTs matching
messages as structured, HMAC-signed JSON to any webhook — purpose-built for n8n,
works with any consumer.

Like Make.com's Mailhook feature, but **universal, self-hosted, and single-process**:

- **Universal** — Gmail, Outlook, Yahoo, or any IMAP provider.
- **Instant** — IMAP IDLE pushes new mail; 1–3s latency, not polling.
- **Zero email changes** — no MX records, no DNS, no port 25. Your mail keeps working.
- **Simple runtime** — one process, in-process retry, no Redis or message broker.
  State lives in **Supabase (Postgres)**.
- **Secure** — credentials encrypted at rest (AES-256-GCM) before they reach the
  database; every webhook payload is HMAC-signed.

## Prerequisites

A Supabase project. Apply the schema once (Supabase SQL editor, or
`supabase db push`):

```
supabase/migrations/0001_mailhook_schema.sql
```

Then grab your project URL and **service-role** key from the Supabase dashboard.

## Quick start (Docker)

```bash
cp .env.example .env
# Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, API_KEY, and ENCRYPTION_KEY:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
docker compose up --build
```

Open <http://localhost:3000>, sign in with your `API_KEY`, and add an account.

> `ENCRYPTION_KEY` is required and must stay stable. Credentials are encrypted
> with it before being written to Supabase — if it's lost or changed, stored
> OAuth tokens and IMAP passwords become unreadable.

## Quick start (local)

```bash
pnpm install
cp .env.example .env
pnpm build
pnpm start                    # UI + API on http://localhost:3000
```

Or run server and UI dev servers separately — see [CLAUDE.md](./CLAUDE.md).

## How it works

```
IMAP IDLE  →  Parse  →  Match rules  →  Sign + POST  →  your webhook
```

1. **Add an account** — Gmail/Outlook via OAuth, or any IMAP host with a
   username/password (or app password). MailHook validates by connecting.
2. **Add rules** — a webhook URL plus optional filters (from, to, subject,
   attachments). No filters = match everything. Filters combine with AND; a
   value in `/slashes/` is a regex, otherwise a case-insensitive substring match.
3. **Receive webhooks** — the moment matching mail arrives, MailHook POSTs the
   parsed email as JSON with signature headers, retrying with backoff on failure.

## Webhook payload

```jsonc
{
  "event": "email.received",
  "timestamp": "2026-08-27T10:30:00.000Z",
  "account_id": "a1b2c3d4",
  "account_email": "you@gmail.com",
  "rule_id": "e5f6g7h8",
  "rule_name": "All emails to n8n",
  "email": {
    "message_id": "<abc@mail.gmail.com>",
    "from": { "address": "sender@example.com", "name": "John Doe" },
    "to": [{ "address": "you@gmail.com", "name": "You" }],
    "cc": [], "bcc": [], "reply_to": null,
    "subject": "New inquiry",
    "date": "2026-08-27T10:29:55.000Z",
    "text": "Plain text…",
    "html": "<p>HTML…</p>",
    "headers": { "x-mailer": "Outlook 16.0" },
    "attachments": [
      { "filename": "quote.pdf", "content_type": "application/pdf",
        "size": 48230, "content_base64": "…", "truncated": false }
    ]
  }
}
```

### Verifying the signature

```
X-MailHook-Signature: sha256=<hex>
X-MailHook-Timestamp: <unix-seconds>
```

```js
const expected = 'sha256=' +
  crypto.createHmac('sha256', ruleSecret)
        .update(timestamp + '.' + rawRequestBody)
        .digest('hex');
// constant-time compare expected === receivedSignature
```

## Admin API

All routes are under `/api` and require `Authorization: Bearer <API_KEY>`
(except the OAuth callback routes the providers redirect to).

- `GET/POST /api/accounts`, `POST /api/accounts/custom`, `POST /api/accounts/test`,
  `PUT/DELETE /api/accounts/:id`, `POST /api/accounts/:id/reconnect`
- `GET /api/oauth/{google,microsoft}/url`, callbacks, `POST /api/oauth/:id/refresh`
- `GET/POST /api/rules`, `PUT/DELETE /api/rules/:id`,
  `POST /api/rules/:id/test`, `POST /api/rules/:id/regenerate-secret`
- `GET /api/logs`, `GET /api/logs/:id`, `POST /api/logs/:id/retry`,
  `DELETE /api/logs/purge?days=30`
- `GET /api/health`, `GET /api/stats`, `GET /api/settings`
- `GET /healthz` — public, unauthenticated (for load balancers)

## Provider setup

- **Gmail** — create OAuth credentials at the Google Cloud console, set
  `GOOGLE_CLIENT_ID/SECRET`, redirect URI `${BASE_URL}/api/oauth/google/callback`.
  Custom-IMAP alternative: a Google **App Password** (2FA required).
- **Outlook** — register an app in Azure, set `MICROSOFT_CLIENT_ID/SECRET`,
  redirect URI `${BASE_URL}/api/oauth/microsoft/callback`.
- **Yahoo / others** — IMAP username + app password. Host presets are built into
  the "Add account" dialog.

## Notes & tradeoffs

- **Retry durability:** in-flight payloads live in memory so retries re-send the
  exact signed bytes. Email bodies are not persisted, so deliveries still pending
  when the process restarts are marked `failed` with an explanatory message (the
  email remains in the mailbox and can be reprocessed) rather than silently lost.
- **Duplicate protection:** each connection tracks the highest processed UID, so
  reconnects and repeated `exists` events never re-fire a webhook for seen mail.
- **Attachment limits:** attachments over `MAX_ATTACHMENT_SIZE` are sent as
  metadata only with `truncated: true`.

See [CLAUDE.md](./CLAUDE.md) for architecture and module details.
