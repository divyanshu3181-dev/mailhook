import { createHmac } from 'node:crypto';

export interface Signature {
  signature: string; // "sha256=<hex>"
  timestamp: number; // unix seconds
}

/**
 * Signs `timestamp.payload` with HMAC-SHA256 so consumers can verify both the
 * body and reject replays via the timestamp. The exact payload string passed
 * here MUST be the exact bytes sent as the HTTP body, and the returned
 * timestamp MUST be sent as the X-MailHook-Timestamp header.
 */
export function signPayload(payload: string, secret: string, timestamp?: number): Signature {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const signedContent = `${ts}.${payload}`;
  const signature = createHmac('sha256', secret).update(signedContent).digest('hex');
  return { signature: `sha256=${signature}`, timestamp: ts };
}
