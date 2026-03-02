/**
 * @helios/blitz NestJS integration.
 *
 * Import from '@helios/blitz/nestjs' (NOT from '@helios/blitz').
 *
 * ```typescript
 * import { HeliosBlitzModule } from '@helios/blitz/nestjs';
 * ```
 */
export { HeliosBlitzModule } from './HeliosBlitzModule.ts';
export type { HeliosBlitzModuleAsyncOptions } from './HeliosBlitzModule.ts';
export { HeliosBlitzService } from './HeliosBlitzService.ts';
export { InjectBlitz, HELIOS_BLITZ_SERVICE_TOKEN } from './InjectBlitz.decorator.ts';
