import Fastify, { type FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { registerApi } from './plugin.js';

let app: FastifyInstance | null = null;

export async function startApiServer(): Promise<FastifyInstance> {
  app = Fastify({
    logger: false, // we use our own pino instance
    bodyLimit: 5 * 1024 * 1024,
    trustProxy: true,
  });

  await registerApi(app);
  await app.listen({ port: config.api.port, host: config.api.host });
  logger.info({ port: config.api.port, host: config.api.host }, 'API server listening');
  return app;
}

export async function stopApiServer(): Promise<void> {
  if (app) {
    await app.close();
    app = null;
    logger.info('API server stopped');
  }
}
