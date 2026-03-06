import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { HELIOS_INSTANCE_TOKEN } from '../HeliosInstanceDefinition';
import type { HeliosInstance } from '@zenystx/helios-core/core/HeliosInstance';

/**
 * Health indicator for a Helios instance — usable with @nestjs/terminus HealthCheckService.
 *
 * Usage:
 * ```typescript
 * @Controller('health')
 * export class HealthController {
 *   constructor(
 *     private health: HealthCheckService,
 *     private heliosHealth: HeliosHealthIndicator,
 *   ) {}
 *
 *   @Get()
 *   @HealthCheck()
 *   check() {
 *     return this.health.check([
 *       () => this.heliosHealth.isHealthy('helios'),
 *     ]);
 *   }
 * }
 * ```
 */
@Injectable()
export class HeliosHealthIndicator {
    constructor(
        @Inject(HELIOS_INSTANCE_TOKEN) private readonly helios: HeliosInstance,
        private readonly healthIndicatorService: HealthIndicatorService,
    ) {}

    /**
     * Checks whether the Helios instance is running and returns a health indicator result.
     *
     * @param key - The key used in the result object (e.g. `'helios'`).
     * @returns A {@link HealthIndicatorResult} with status `'up'` (includes `memberCount`) or `'down'` (includes `message`).
     * @throws Any error thrown by the Helios lifecycle or cluster API.
     */
    isHealthy(key: string): HealthIndicatorResult {
        const running = this.helios.getLifecycleService().isRunning();
        const session = this.healthIndicatorService.check(key);

        if (!running) {
            return session.down({ message: 'Helios instance is not running' });
        }

        const memberCount = this.helios.getCluster().getMembers().length;
        return session.up({ memberCount });
    }
}
