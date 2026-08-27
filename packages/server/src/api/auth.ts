import type { FastifyReply, FastifyRequest } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../logger.js';

/** Base64url-decode to a Buffer. */
function b64urlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

interface SupabaseJwtPayload {
  sub?: string;
  email?: string;
  exp?: number;
  aud?: string | string[];
  [k: string]: unknown;
}

/**
 * Verifies a Supabase-issued JWT (HS256) using the shared JWT secret and returns
 * its payload, or null if the signature is invalid, malformed, or expired.
 * Uses only Node crypto — no external JWT dependency.
 */
export function verifySupabaseJwt(token: string): SupabaseJwtPayload | null {
  const secret = config.supabase.jwtSecret;
  if (!secret) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  // Only HS256 is accepted (Supabase's default) — reject anything else, and in
  // particular refuse "alg: none" downgrade attempts.
  let header: { alg?: string; typ?: string };
  try {
    header = JSON.parse(b64urlDecode(headerB64).toString('utf8'));
  } catch {
    return null;
  }
  if (header.alg !== 'HS256') return null;

  const expected = createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const provided = b64urlDecode(signatureB64);
  if (expected.length !== provided.length) return null;
  if (!timingSafeEqual(expected, provided)) return null;

  let payload: SupabaseJwtPayload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8'));
  } catch {
    return null;
  }

  // Reject expired tokens (exp is seconds since epoch).
  if (typeof payload.exp === 'number' && Date.now() / 1000 >= payload.exp) {
    return null;
  }

  return payload;
}

/** True if the email is on the configured admin allowlist (case-insensitive). */
export function isAllowed(email: string | undefined): boolean {
  if (!email) return false;
  return config.auth.allowlist.includes(email.toLowerCase());
}

/**
 * Fastify preHandler enforcing a valid Supabase session whose email is on the
 * admin allowlist. Replaces the previous static API-key gate.
 */
export async function requireSupabaseUser(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const header = request.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    await reply.code(401).send({ error: 'Missing or malformed Authorization header' });
    return;
  }

  const token = header.slice('Bearer '.length).trim();
  const payload = verifySupabaseJwt(token);
  if (!payload) {
    await reply.code(401).send({ error: 'Invalid or expired session' });
    return;
  }

  if (!isAllowed(payload.email)) {
    logger.warn({ email: payload.email }, 'rejected sign-in: email not on allowlist');
    await reply.code(403).send({ error: 'This account is not authorized for MailHook.' });
    return;
  }

  // Attach for downstream handlers that may want the identity.
  (request as FastifyRequest & { user?: { id?: string; email?: string } }).user = {
    id: payload.sub,
    email: payload.email,
  };
}
