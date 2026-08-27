import { simpleParser, type ParsedMail, type AddressObject } from 'mailparser';
import type { Readable } from 'node:stream';
import { config } from '../config.js';

export interface ParsedAddress {
  address: string;
  name: string;
}

export interface ParsedAttachment {
  filename: string;
  contentType: string;
  size: number;
  contentBase64: string | null;
  truncated: boolean;
}

export interface ParsedEmail {
  messageId: string | null;
  from: ParsedAddress | null;
  to: ParsedAddress[];
  cc: ParsedAddress[];
  bcc: ParsedAddress[];
  replyTo: ParsedAddress | null;
  subject: string;
  date: string | null;
  text: string | null;
  html: string | null;
  headers: Record<string, string>;
  attachments: ParsedAttachment[];
}

function toAddresses(obj: AddressObject | AddressObject[] | undefined): ParsedAddress[] {
  if (!obj) return [];
  const list = Array.isArray(obj) ? obj : [obj];
  const out: ParsedAddress[] = [];
  for (const group of list) {
    for (const addr of group.value) {
      if (addr.address) out.push({ address: addr.address.toLowerCase(), name: addr.name ?? '' });
    }
  }
  return out;
}

function flattenHeaders(parsed: ParsedMail): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of parsed.headers) {
    if (typeof value === 'string') {
      headers[key] = value;
    } else if (value == null) {
      continue;
    } else if (typeof value === 'object' && 'text' in value && typeof value.text === 'string') {
      headers[key] = value.text;
    } else {
      try {
        headers[key] = JSON.stringify(value);
      } catch {
        headers[key] = String(value);
      }
    }
  }
  return headers;
}

/**
 * Parses a raw RFC-822 email into a normalized structure. Attachments whose
 * cumulative size exceeds MAX_ATTACHMENT_SIZE keep their metadata but have
 * `contentBase64` set to null and `truncated` set to true, so payloads stay
 * bounded without dropping the fact that an attachment was present.
 */
export async function parseEmail(source: Readable | Buffer): Promise<ParsedEmail> {
  const parsed = await simpleParser(source, {
    skipHtmlToText: false,
    skipTextToHtml: true,
    skipImageLinks: true,
  });

  const maxSize = config.forwarder.maxAttachmentSize;
  let cumulative = 0;

  const attachments: ParsedAttachment[] = (parsed.attachments ?? []).map((att) => {
    const size = att.size ?? att.content.length;
    cumulative += size;
    const withinLimit = size <= maxSize && cumulative <= maxSize;
    return {
      filename: att.filename ?? 'unnamed',
      contentType: att.contentType ?? 'application/octet-stream',
      size,
      contentBase64: withinLimit ? att.content.toString('base64') : null,
      truncated: !withinLimit,
    };
  });

  const fromList = toAddresses(parsed.from);
  const replyToList = toAddresses(parsed.replyTo);

  return {
    messageId: parsed.messageId ?? null,
    from: fromList[0] ?? null,
    to: toAddresses(parsed.to),
    cc: toAddresses(parsed.cc),
    bcc: toAddresses(parsed.bcc),
    replyTo: replyToList[0] ?? null,
    subject: parsed.subject ?? '',
    date: parsed.date ? parsed.date.toISOString() : null,
    text: parsed.text ?? null,
    html: typeof parsed.html === 'string' ? parsed.html : null,
    headers: flattenHeaders(parsed),
    attachments,
  };
}
