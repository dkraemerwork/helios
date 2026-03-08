import { Module } from '@nestjs/common';
import { HeliosMonitorService } from './HeliosMonitorService';

/**
 * HeliosMonitorModule — NestJS module that provides {@link HeliosMonitorService}
 * for programmatic access to Helios runtime metrics.
 *
 * Import this module wherever you need to inject {@link HeliosMonitorService}.
 * Requires that `HELIOS_INSTANCE_TOKEN` is already provided in the module graph
 * (typically by importing `HeliosModule`).
 *
 * Usage:
 * ```typescript
 * @Module({
 *     imports: [HeliosMonitorModule],
 * })
 * export class AppModule {}
 * ```
 */
@Module({
    providers: [HeliosMonitorService],
    exports: [HeliosMonitorService],
})
export class HeliosMonitorModule {}
