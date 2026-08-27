import type { FastifyReply, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Fastify preHandler enforcing `Authorization: Bearer <API_KEY>`. Constant-time
 * comparison avoids leaking the key via timing.
 */
export async function requireApiKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const header = request.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    await reply.code(401).send({ error: 'Missing or malformed Authorization header' });
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  if (!safeCompare(token, config.api.apiKey)) {
    await reply.code(401).send({ error: 'Invalid API key' });
    return;
  }
}
