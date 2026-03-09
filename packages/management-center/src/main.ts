/**
 * Standalone entry point for the Helios Management Center.
 *
 * Bootstraps the NestJS application with a Fastify adapter for running
 * the Management Center independently (without the Helios core runtime).
 * For embedded usage inside a Helios instance, use ManagementCenterExtension.
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { WsAdapter } from '@nestjs/platform-ws';
import { ManagementCenterModule } from './app/ManagementCenterModule.js';
import { ConfigService } from './config/ConfigService.js';
import { Logger } from '@nestjs/common';

async function bootstrap(): Promise<void> {
  const adapter = new FastifyAdapter({ trustProxy: true });

  // Register @fastify/cookie so request.cookies and reply.setCookie() work.
  const fastifyCookie = await import('@fastify/cookie');
  const fastifyInstance = adapter.getInstance();
  await fastifyInstance.register(fastifyCookie.default ?? fastifyCookie);

  const app = await NestFactory.create<NestFastifyApplication>(
    ManagementCenterModule,
    adapter,
    { bufferLogs: true },
  );

  const config = app.get(ConfigService);
  const host = config.serverHost;
  const port = config.serverPort;

  // Pass the raw Node.js http.Server so the WsAdapter 'upgrade' listener
  // attaches correctly — avoids Bun's multi-copy instanceof mismatch.
  const rawHttpServer = app.getHttpServer();
  app.useWebSocketAdapter(new WsAdapter(rawHttpServer));
  app.enableShutdownHooks();

  await app.listen(port, host);
  Logger.log(`Management Center listening on ${host}:${port}`, 'Bootstrap');
}

bootstrap().catch((err: unknown) => {
  Logger.error('Failed to start Management Center', err instanceof Error ? err.stack : String(err), 'Bootstrap');
  process.exit(1);
});
