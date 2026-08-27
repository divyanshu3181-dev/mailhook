import type { FastifyInstance } from 'fastify';
import {
  createAccount,
  getAccountById,
  getAccountByEmail,
  getAllAccounts,
  updateAccount,
  deleteAccount,
  countRulesForAccount,
  getAccountLastDelivery,
  type Provider,
} from '../db/queries.js';
import { encrypt } from '../auth/encryption.js';
import { testImapConnection } from '../connections/imap-client.js';
import { connectionManager } from '../connections/manager.js';
import { publicAccount } from './serialize.js';
import {
  createCustomAccountSchema,
  testConnectionSchema,
  updateAccountSchema,
  idParamsSchema,
} from './schemas.js';

interface CustomAccountBody {
  name: string;
  provider?: 'yahoo' | 'custom';
  email_address: string;
  imap_host: string;
  imap_port?: number;
  imap_user: string;
  imap_pass: string;
  imap_tls?: boolean;
  watch_folder?: string;
}

export async function registerAccountRoutes(app: FastifyInstance): Promise<void> {
  // List all accounts with rule counts + last delivery.
  app.get('/accounts', async () => {
    const accounts = await getAllAccounts();
    const lastDelivery = await getAccountLastDelivery();
    const withCounts = await Promise.all(
      accounts.map(async (a) => ({
        ...publicAccount(a),
        rule_count: await countRulesForAccount(a.id),
        last_delivery_at: lastDelivery.get(a.id) ?? null,
      }))
    );
    return { data: withCounts };
  });

  // Add a custom / preset IMAP account (validates by test-connecting first).
  app.post(
    '/accounts/custom',
    { schema: { body: createCustomAccountSchema } },
    async (request, reply) => {
      const body = request.body as CustomAccountBody;

      if (await getAccountByEmail(body.email_address)) {
        reply.code(409);
        return { error: 'An account with this email address already exists' };
      }

      const secure = body.imap_tls !== false;
      const test = await testImapConnection({
        host: body.imap_host,
        port: body.imap_port ?? 993,
        secure,
        user: body.imap_user,
        pass: body.imap_pass,
        folder: body.watch_folder ?? 'INBOX',
      });
      if (!test.ok) {
        reply.code(400);
        return { error: `IMAP connection failed: ${test.error}` };
      }

      const account = await createAccount({
        name: body.name,
        provider: (body.provider ?? 'custom') as Provider,
        email_address: body.email_address,
        imap_host: body.imap_host,
        imap_port: body.imap_port ?? 993,
        imap_user: body.imap_user,
        imap_pass_enc: encrypt(body.imap_pass),
        imap_tls: secure,
        watch_folder: body.watch_folder ?? 'INBOX',
        is_active: true,
      });

      await connectionManager.addAccount(account.id);
      reply.code(201);
      return publicAccount(account);
    }
  );

  // Test a connection without persisting anything.
  app.post('/accounts/test', { schema: { body: testConnectionSchema } }, async (request) => {
    const body = request.body as Omit<CustomAccountBody, 'name'>;
    const secure = body.imap_tls !== false;
    return testImapConnection({
      host: body.imap_host,
      port: body.imap_port ?? 993,
      secure,
      user: body.imap_user,
      pass: body.imap_pass,
      folder: body.watch_folder ?? 'INBOX',
    });
  });

  app.get('/accounts/:id', { schema: { params: idParamsSchema } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const account = await getAccountById(id);
    if (!account) {
      reply.code(404);
      return { error: 'Account not found' };
    }
    return {
      ...publicAccount(account),
      rule_count: await countRulesForAccount(account.id),
      live_status: connectionManager.getStatus(account.id),
    };
  });

  app.put(
    '/accounts/:id',
    { schema: { params: idParamsSchema, body: updateAccountSchema } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as {
        name?: string;
        watch_folder?: string;
        is_active?: boolean;
      };
      const existing = await getAccountById(id);
      if (!existing) {
        reply.code(404);
        return { error: 'Account not found' };
      }

      const updated = await updateAccount(id, body);

      // React to activation / watch-folder changes on the live connection.
      const wasActive = existing.is_active;
      const nowActive = updated.is_active;
      const folderChanged = existing.watch_folder !== updated.watch_folder;

      if (wasActive && !nowActive) {
        await connectionManager.removeAccount(id);
      } else if (!wasActive && nowActive) {
        await connectionManager.addAccount(id);
      } else if (nowActive && folderChanged) {
        await connectionManager.reconnect(id);
      }

      return publicAccount(updated);
    }
  );

  app.delete('/accounts/:id', { schema: { params: idParamsSchema } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await getAccountById(id);
    if (!existing) {
      reply.code(404);
      return { error: 'Account not found' };
    }
    await connectionManager.removeAccount(id);
    await deleteAccount(id); // cascades rules + logs
    return { deleted: true };
  });

  app.post(
    '/accounts/:id/reconnect',
    { schema: { params: idParamsSchema } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const account = await getAccountById(id);
      if (!account) {
        reply.code(404);
        return { error: 'Account not found' };
      }
      await connectionManager.reconnect(id);
      return { reconnecting: true };
    }
  );
}
