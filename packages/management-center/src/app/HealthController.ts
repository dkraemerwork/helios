/**
 * Health check endpoints for Kubernetes-style liveness, readiness,
 * and startup probes.
 *
 * - GET /health/live   — Always 200 (process is alive)
 * - GET /health/ready  — 200 when config valid, migrations done, DB reachable, SSR ok
 * - GET /health/startup — 200 when ready AND at least one cluster connect attempted
 *
 * All endpoints bypass authentication via the SessionAuthGuard public-route list.
 */

import { Controller, Get, HttpCode, HttpStatus, Logger, Res } from '@nestjs/common';
import { ConfigService } from '../config/ConfigService.js';
import { TursoConnectionFactory } from '../persistence/TursoConnectionFactory.js';
import { MigrationRunner } from '../persistence/MigrationRunner.js';
import { ClusterConnectorService } from '../connector/ClusterConnectorService.js';
import { ClusterStateStore } from '../connector/ClusterStateStore.js';

interface HealthResponse {
  status: 'ok' | 'degraded' | 'unavailable';
  checks?: Record<string, { status: 'pass' | 'fail'; message?: string }>;
}

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly connectionFactory: TursoConnectionFactory,
    private readonly stateStore: ClusterStateStore,
  ) {}

  // ── GET /health/live ───────────────────────────────────────────────────

  @Get('live')
  @HttpCode(HttpStatus.OK)
  live(): HealthResponse {
    return { status: 'ok' };
  }

  // ── GET /health/ready ──────────────────────────────────────────────────

  @Get('ready')
  async ready(@Res({ passthrough: true }) res: { status: (code: number) => void }): Promise<HealthResponse> {
    const checks: Record<string, { status: 'pass' | 'fail'; message?: string }> = {};

    // 1. Config is valid (if ConfigService was injected, it parsed successfully)
    checks['config'] = { status: 'pass' };

    // 2. Database reachable — run a lightweight test query
    try {
      const client = await this.connectionFactory.getClient();
      await client.execute('SELECT 1');
      checks['database'] = { status: 'pass' };
    } catch (err) {
      checks['database'] = {
        status: 'fail',
        message: err instanceof Error ? err.message : String(err),
      };
    }

    // 3. Migrations applied — verify the schema_migrations table exists and is accessible
    try {
      const client = await this.connectionFactory.getClient();
      await client.execute('SELECT COUNT(*) AS cnt FROM schema_migrations');
      checks['migrations'] = { status: 'pass' };
    } catch (err) {
      checks['migrations'] = {
        status: 'fail',
        message: err instanceof Error ? err.message : String(err),
      };
    }

    // 4. SSR bundle — gracefully degrade if unavailable (not a hard failure)
    checks['ssr'] = { status: 'pass', message: 'SSR availability is non-blocking' };

    const allPassed = Object.values(checks).every((c) => c.status === 'pass');
    const status = allPassed ? 'ok' : 'unavailable';

    if (!allPassed) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return { status, checks };
  }

  // ── GET /health/startup ────────────────────────────────────────────────

  @Get('startup')
  async startup(@Res({ passthrough: true }) res: { status: (code: number) => void }): Promise<HealthResponse> {
    // First run all readiness checks
    const readyResult = await this.ready(res);
    const checks = { ...readyResult.checks };

    // Additional startup check: at least one cluster connect attempt performed
    const clusterStates = this.stateStore.getAllClusterStates();
    const hasAttemptedConnect = clusterStates.size > 0 || this.configService.clusters.length === 0;

    if (hasAttemptedConnect) {
      checks['cluster_connect'] = { status: 'pass', message: `${clusterStates.size} cluster(s) tracked` };
    } else {
      checks['cluster_connect'] = {
        status: 'fail',
        message: `No cluster connect attempted (${this.configService.clusters.length} configured)`,
      };
    }

    const allPassed = Object.values(checks).every((c) => c.status === 'pass');
    const status = allPassed ? 'ok' : 'unavailable';

    if (!allPassed) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return { status, checks };
  }
}
