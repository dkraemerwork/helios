import { Module } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { HeliosHealthIndicator } from './HeliosHealthIndicator';

/**
 * NestJS module that registers {@link HeliosHealthIndicator} and its
 * required {@link HealthIndicatorService} dependency.
 *
 * Import this module alongside your HeliosModule and TerminusModule to
 * expose Helios health checks via your existing health endpoint.
 *
 * Note: HELIOS_INSTANCE_TOKEN must be provided in the importing module
 * (either by importing HeliosModule or by providing the token directly).
 */
@Module({
    providers: [HeliosHealthIndicator, HealthIndicatorService],
    exports: [HeliosHealthIndicator],
})
export class HeliosHealthModule {}
