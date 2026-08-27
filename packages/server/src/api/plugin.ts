import type { FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { requireApiKey } from './auth.js';
import { registerAccountRoutes } from './accounts.routes.js';
import { registerRuleRoutes } from './rules.routes.js';
import { registerLogRoutes } from './logs.routes.js';
import { registerSystemRoutes } from './system.routes.js';
import {
  registerOAuthProtectedRoutes,
  registerOAuthCallbackRoutes,
} from './oauth.routes.js';

const startTime = Date.now();

/**
 * Registers the entire HTTP surface:
 *   - Public OAuth callbacks under /api/oauth/*\/callback (no API key)
 *   - Public /healthz (no API key)
 *   - Auth-protected admin API under /api
 *   - Static admin UI + SPA fallback
 */
export async function registerApi(app: FastifyInstance): Promise<void> {
  // Public OAuth callbacks — identity providers redirect here, so no API key.
  await registerOAuthCallbackRoutes(app);

  // Public health check for load balancers.
  app.get('/healthz', async () => ({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: config.version,
  }));

  // Auth-protected admin API.
  await app.register(
    async (api) => {
      api.addHook('preHandler', requireApiKey);
      await registerAccountRoutes(api);
      await registerRuleRoutes(api);
      await registerLogRoutes(api);
      await registerSystemRoutes(api);
      await registerOAuthProtectedRoutes(api);
    },
    { prefix: '/api' }
  );

  // Static UI + SPA fallback.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '..', 'public'), // dist/public (production, if copied there)
    join(here, '..', '..', '..', 'ui', 'dist'), // monorepo layout
  ];
  const uiRoot = candidates.find((p) => existsSync(join(p, 'index.html')));

  if (uiRoot) {
    await app.register(fastifyStatic, { root: uiRoot, prefix: '/', wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api') || request.url.startsWith('/healthz')) {
        reply.code(404).send({ error: 'Not found' });
        return;
      }
      reply.sendFile('index.html');
    });
    logger.info({ uiRoot }, 'serving admin UI');
  } else {
    logger.warn('admin UI build not found; API-only mode');
    app.setNotFoundHandler((_request, reply) => {
      reply.code(404).send({ error: 'Not found' });
    });
  }
}
