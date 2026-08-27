import type { FastifyInstance } from 'fastify';
import {
  getLogs,
  getLogById,
  purgeOldLogs,
  updateDeliveryLog,
  type DeliveryStatus,
} from '../db/queries.js';
import { retryQueue } from '../forwarder/retry.js';
import { logIdParamsSchema, listLogsQuerySchema, purgeLogsQuerySchema } from './schemas.js';

export async function registerLogRoutes(app: FastifyInstance): Promise<void> {
  app.get('/logs', { schema: { querystring: listLogsQuerySchema } }, async (request) => {
    const q = request.query as {
      page?: number;
      limit?: number;
      status?: DeliveryStatus;
      account_id?: string;
      rule_id?: string;
      from?: string;
      to?: string;
    };
    const page = q.page ?? 1;
    const limit = q.limit ?? 20;
    const { data, total } = await getLogs({
      page,
      limit,
      status: q.status,
      account_id: q.account_id,
      rule_id: q.rule_id,
      from_date: q.from,
      to_date: q.to,
    });
    return {
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  });

  // NOTE: register the static purge route before the :id param route so
  // "/logs/purge" is not captured as an id.
  app.delete('/logs/purge', { schema: { querystring: purgeLogsQuerySchema } }, async (request) => {
    const q = request.query as { days?: number };
    const days = q.days ?? 30;
    const removed = await purgeOldLogs(days);
    return { purged: removed, older_than_days: days };
  });

  app.get('/logs/:id', { schema: { params: logIdParamsSchema } }, async (request, reply) => {
    const { id } = request.params as { id: number };
    const log = await getLogById(id);
    if (!log) {
      reply.code(404);
      return { error: 'Log entry not found' };
    }
    return log;
  });

  app.post('/logs/:id/retry', { schema: { params: logIdParamsSchema } }, async (request, reply) => {
    const { id } = request.params as { id: number };
    const log = await getLogById(id);
    if (!log) {
      reply.code(404);
      return { error: 'Log entry not found' };
    }
    const ok = retryQueue.retryNow(id);
    if (!ok) {
      reply.code(409);
      return {
        error:
          'Original payload no longer available (server restarted since this delivery). The email remains in the mailbox and can be reprocessed.',
      };
    }
    await updateDeliveryLog(id, { status: 'retrying', next_retry_at: new Date().toISOString() });
    return { retrying: true };
  });
}
