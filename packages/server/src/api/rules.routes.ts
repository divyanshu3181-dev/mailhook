import type { FastifyInstance } from 'fastify';
import {
  createRule,
  getRuleById,
  getAllRules,
  updateRule,
  deleteRule,
  getAccountById,
  getRuleDeliveryCounts,
  generateSecret,
  type Rule,
} from '../db/queries.js';
import { buildPayload, deliverOnce } from '../forwarder/forwarder.js';
import {
  createRuleSchema,
  updateRuleSchema,
  listRulesQuerySchema,
  idParamsSchema,
} from './schemas.js';

interface RuleBody {
  account_id: string;
  name: string;
  webhook_url: string;
  is_active?: boolean;
  filter_from?: string | null;
  filter_to?: string | null;
  filter_subject?: string | null;
  filter_has_attachment?: boolean | null;
  filter_label?: string | null;
  filter_unseen_only?: boolean;
}

export async function registerRuleRoutes(app: FastifyInstance): Promise<void> {
  app.get('/rules', { schema: { querystring: listRulesQuerySchema } }, async (request) => {
    const q = request.query as { account_id?: string };
    const [rules, counts] = await Promise.all([getAllRules(q.account_id), getRuleDeliveryCounts(24)]);
    return {
      data: rules.map((r) => ({ ...r, deliveries_24h: counts.get(r.id) ?? 0 })),
    };
  });

  app.post('/rules', { schema: { body: createRuleSchema } }, async (request, reply) => {
    const body = request.body as RuleBody;
    const account = await getAccountById(body.account_id);
    if (!account) {
      reply.code(400);
      return { error: 'account_id does not reference an existing account' };
    }
    const rule = await createRule(body);
    reply.code(201);
    return rule;
  });

  app.get('/rules/:id', { schema: { params: idParamsSchema } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const rule = await getRuleById(id);
    if (!rule) {
      reply.code(404);
      return { error: 'Rule not found' };
    }
    return rule;
  });

  app.put(
    '/rules/:id',
    { schema: { params: idParamsSchema, body: updateRuleSchema } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const existing = await getRuleById(id);
      if (!existing) {
        reply.code(404);
        return { error: 'Rule not found' };
      }
      const updated = await updateRule(id, request.body as Partial<RuleBody>);
      return updated;
    }
  );

  app.delete('/rules/:id', { schema: { params: idParamsSchema } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await getRuleById(id);
    if (!existing) {
      reply.code(404);
      return { error: 'Rule not found' };
    }
    await deleteRule(id);
    return { deleted: true };
  });

  app.post(
    '/rules/:id/regenerate-secret',
    { schema: { params: idParamsSchema } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const existing = await getRuleById(id);
      if (!existing) {
        reply.code(404);
        return { error: 'Rule not found' };
      }
      const rule = await updateRule(id, { secret: generateSecret() });
      return { id: rule.id, secret: rule.secret };
    }
  );

  // Send a mock payload to the webhook for testing (does not persist a log).
  app.post('/rules/:id/test', { schema: { params: idParamsSchema } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const rule = (await getRuleById(id)) as Rule | null;
    if (!rule) {
      reply.code(404);
      return { error: 'Rule not found' };
    }
    const account = await getAccountById(rule.account_id);
    if (!account) {
      reply.code(400);
      return { error: 'Rule has no associated account' };
    }

    const nowIso = new Date().toISOString();
    const timestampUnix = Math.floor(Date.now() / 1000);
    const payload = buildPayload(
      {
        messageId: `<test-${timestampUnix}@mailhook>`,
        from: { address: 'test@mailhook.local', name: 'MailHook Test' },
        to: [{ address: account.email_address, name: '' }],
        cc: [],
        bcc: [],
        replyTo: null,
        subject: 'MailHook test delivery',
        date: nowIso,
        text: 'This is a test payload sent from MailHook.',
        html: '<p>This is a test payload sent from MailHook.</p>',
        headers: { 'x-mailhook-test': 'true' },
        attachments: [],
      },
      account,
      rule,
      nowIso
    );
    const payloadString = JSON.stringify(payload);
    const result = await deliverOnce(rule, payloadString, timestampUnix);

    return {
      ok: result.ok,
      response_code: result.responseCode,
      response_body: result.responseBody,
      error_message: result.errorMessage,
    };
  });
}
