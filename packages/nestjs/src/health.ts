/**
 * @zenystx/nestjs/health — Health subpath barrel.
 *
 * Import health-check symbols from this subpath to reduce bundle size:
 * ```typescript
 * import { HeliosHealthIndicator, HeliosHealthModule } from '@zenystx/nestjs/health';
 * ```
 */

export { HeliosHealthIndicator } from './health/HeliosHealthIndicator';
export { HeliosHealthModule } from './health/HeliosHealthModule';
