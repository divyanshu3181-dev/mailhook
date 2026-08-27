import { config } from '../config.js';
import { logger } from '../logger.js';
import type { Account, Rule } from '../db/queries.js';
import type { ParsedEmail } from '../email/parser.js';
import { signPayload } from './signer.js';

export interface WebhookPayload {
  event: 'email.received';
  timestamp: string;
  account_id: string;
  account_email: string;
  rule_id: string;
  rule_name: string;
  email: {
    message_id: string | null;
    from: { address: string; name: string } | null;
    to: { address: string; name: string }[];
    cc: { address: string; name: string }[];
    bcc: { address: string; name: string }[];
    reply_to: { address: string; name: string } | null;
    subject: string;
    date: string | null;
    text: string | null;
    html: string | null;
    headers: Record<string, string>;
    attachments: {
      filename: string;
      content_type: string;
      size: number;
      content_base64: string | null;
      truncated: boolean;
    }[];
  };
}

/** Builds the webhook JSON payload from a parsed email + matched rule/account. */
export function buildPayload(
  email: ParsedEmail,
  account: Account,
  rule: Rule,
  timestampIso: string
): WebhookPayload {
  return {
    event: 'email.received',
    timestamp: timestampIso,
    account_id: account.id,
    account_email: account.email_address,
    rule_id: rule.id,
    rule_name: rule.name,
    email: {
      message_id: email.messageId,
      from: email.from,
      to: email.to,
      cc: email.cc,
      bcc: email.bcc,
      reply_to: email.replyTo,
      subject: email.subject,
      date: email.date,
      text: email.text,
      html: email.html,
      headers: email.headers,
      attachments: email.attachments.map((att) => ({
        filename: att.filename,
        content_type: att.contentType,
        size: att.size,
        content_base64: att.contentBase64,
        truncated: att.truncated,
      })),
    },
  };
}

export interface DeliveryAttemptResult {
  ok: boolean;
  responseCode: number | null;
  responseBody: string | null;
  errorMessage: string | null;
}

/**
 * Performs a single HTTP delivery of an already-serialized payload. Never
 * throws — network/timeout failures are returned in the result so the retry
 * layer can decide what to do next.
 */
export async function deliverOnce(
  rule: Rule,
  payloadString: string,
  timestampUnix: number
): Promise<DeliveryAttemptResult> {
  const { signature } = signPayload(payloadString, rule.secret, timestampUnix);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.forwarder.webhookTimeout);

  try {
    const res = await fetch(rule.webhook_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MailHook-Signature': signature,
        'X-MailHook-Timestamp': String(timestampUnix),
        'X-MailHook-Event': 'email.received',
        'X-MailHook-Rule-Id': rule.id,
        'User-Agent': `MailHook/${config.version}`,
      },
      body: payloadString,
      signal: controller.signal,
    });

    let body: string | null = null;
    try {
      body = (await res.text()).slice(0, 500);
    } catch {
      body = null;
    }

    const ok = res.status >= 200 && res.status < 300;
    if (!ok) {
      logger.warn(
        { ruleId: rule.id, url: rule.webhook_url, status: res.status },
        'webhook returned non-2xx'
      );
    }
    return {
      ok,
      responseCode: res.status,
      responseBody: body,
      errorMessage: ok ? null : `HTTP ${res.status}`,
    };
  } catch (err) {
    const isAbort = (err as Error).name === 'AbortError';
    const message = isAbort
      ? `Timeout after ${config.forwarder.webhookTimeout}ms`
      : (err as Error).message;
    logger.warn({ ruleId: rule.id, url: rule.webhook_url, err: message }, 'webhook delivery error');
    return { ok: false, responseCode: null, responseBody: null, errorMessage: message };
  } finally {
    clearTimeout(timer);
  }
}
