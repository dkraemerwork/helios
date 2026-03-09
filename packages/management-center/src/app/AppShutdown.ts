/**
 * Ordered graceful shutdown handler for the Management Center.
 *
 * Implements NestJS OnApplicationShutdown to ensure resources are released
 * in the correct order: network listeners first, then in-flight work,
 * then persistent connections. Each step has a 5-second timeout to
 * prevent indefinite hangs during shutdown.
 */

import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { WsTicketService } from '../auth/WsTicketService.js';
import { WsHeartbeatService } from '../realtime/WsHeartbeatService.js';
import { ClusterConnectorService } from '../connector/ClusterConnectorService.js';
import { WriteBatcher } from '../persistence/WriteBatcher.js';
import { AsyncSerialQueue } from '../persistence/AsyncSerialQueue.js';
import { EmailNotificationChannel } from '../alerts/EmailNotificationChannel.js';
import { TursoConnectionFactory } from '../persistence/TursoConnectionFactory.js';

const STEP_TIMEOUT_MS = 5_000;

/**
 * Executes a shutdown step with a timeout. If the step exceeds the timeout,
 * a warning is logged and execution continues to the next step.
 */
async function withTimeout(
  logger: Logger,
  stepName: string,
  fn: () => Promise<void> | void,
): Promise<void> {
  logger.log(`Shutdown: ${stepName}...`);
  const start = Date.now();

  try {
    await Promise.race([
      Promise.resolve(fn()),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${STEP_TIMEOUT_MS}ms`)), STEP_TIMEOUT_MS),
      ),
    ]);
    logger.log(`Shutdown: ${stepName} completed (${Date.now() - start}ms)`);
  } catch (err) {
    logger.warn(
      `Shutdown: ${stepName} failed or timed out (${Date.now() - start}ms): ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

@Injectable()
export class AppShutdown implements OnApplicationShutdown {
  private readonly logger = new Logger(AppShutdown.name);

  constructor(
    private readonly wsTicketService: WsTicketService,
    private readonly wsHeartbeatService: WsHeartbeatService,
    private readonly connectorService: ClusterConnectorService,
    private readonly writeBatcher: WriteBatcher,
    private readonly asyncQueue: AsyncSerialQueue,
    private readonly emailChannel: EmailNotificationChannel,
    private readonly connectionFactory: TursoConnectionFactory,
  ) {}

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(`Application shutdown initiated (signal: ${signal ?? 'none'})`);
    const start = Date.now();

    // Step 1: Stop accepting new HTTP connections — handled by NestJS/Fastify
    this.logger.log('Shutdown: Step 1 — HTTP listener closed by NestJS');

    // Step 2: Stop WS ticket issuance
    await withTimeout(this.logger, 'Step 2 — Stop WS ticket issuance', () => {
      // Clear all pending tickets to prevent new WebSocket connections
      this.wsTicketService.cleanup();
    });

    // Step 3: Drain WebSocket sessions
    await withTimeout(this.logger, 'Step 3 — Drain WebSocket sessions', () => {
      // WsHeartbeatService.onModuleDestroy handles timer cleanup;
      // here we log the count of sessions being drained
      const activeCount = this.wsHeartbeatService.activeSocketCount;
      this.logger.log(`Draining ${activeCount} active WebSocket session(s)`);
      // Module destroy will be called by NestJS, closing sockets
    });

    // Step 4: Abort SSE readers (ClusterConnectorService.onModuleDestroy handles this)
    await withTimeout(this.logger, 'Step 4 — Abort SSE readers', async () => {
      // Trigger connector shutdown — disconnects all SSE clients
      await this.connectorService.onModuleDestroy();
    });

    // Step 5: Flush WriteBatcher
    await withTimeout(this.logger, 'Step 5 — Flush WriteBatcher', async () => {
      await this.writeBatcher.shutdown();
    });

    // Step 6: Drain AsyncSerialQueue
    await withTimeout(this.logger, 'Step 6 — Drain AsyncSerialQueue', async () => {
      const deadline = Date.now() + STEP_TIMEOUT_MS;
      while (this.asyncQueue.depth > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (this.asyncQueue.depth > 0) {
        this.logger.warn(`AsyncSerialQueue still has ${this.asyncQueue.depth} pending operation(s)`);
      }
    });

    // Step 7: Close SMTP transport
    await withTimeout(this.logger, 'Step 7 — Close SMTP transport', () => {
      this.emailChannel.close();
    });

    // Step 8: Close Turso/SQLite client
    await withTimeout(this.logger, 'Step 8 — Close database connection', async () => {
      await this.connectionFactory.close();
    });

    this.logger.log(`Application shutdown complete (${Date.now() - start}ms)`);
  }
}
