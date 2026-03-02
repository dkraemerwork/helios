/**
 * @helios/blitz — NATS-backed stream & batch processing engine.
 *
 * Entry point exports for the public API.
 * NOTE: NestJS integration is exported from '@helios/blitz/nestjs' (NOT from this barrel).
 */

export { BlitzService } from './BlitzService.ts';
export type { BlitzEventListener } from './BlitzService.ts';
export type { BlitzConfig, ResolvedBlitzConfig } from './BlitzConfig.ts';
export { resolveBlitzConfig } from './BlitzConfig.ts';
export { BlitzEvent } from './BlitzEvent.ts';
export { BlitzError } from './errors/BlitzError.ts';
export { NakError } from './errors/NakError.ts';
export { DeadLetterError } from './errors/DeadLetterError.ts';
export { PipelineError } from './errors/PipelineError.ts';
