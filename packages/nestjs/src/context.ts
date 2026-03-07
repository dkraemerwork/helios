/**
 * @zenystx/helios-nestjs/context — NestJS-aware context subpath barrel.
 *
 * Import context symbols from this subpath to reduce bundle size:
 * ```typescript
 * import { NestAware, NestManagedContext } from '@zenystx/helios-nestjs/context';
 * ```
 */

export {
    NEST_AWARE_METADATA_KEY, NestAware,
    isNestAware
} from './context/NestAware';
export { NestManagedContext } from './context/NestManagedContext';
