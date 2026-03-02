/**
 * @helios/nestjs/health — Health subpath barrel.
 *
 * Import health-check symbols from this subpath to reduce bundle size:
 * ```typescript
 * import { HeliosHealthIndicator, HeliosHealthModule } from '@helios/nestjs/health';
 * ```
 */

export { HeliosHealthIndicator } from './health/HeliosHealthIndicator';
export { HeliosHealthModule } from './health/HeliosHealthModule';
