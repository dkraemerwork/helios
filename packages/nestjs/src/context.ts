/**
 * @helios/nestjs/context — NestJS-aware context subpath barrel.
 *
 * Import context symbols from this subpath to reduce bundle size:
 * ```typescript
 * import { NestAware, NestManagedContext } from '@helios/nestjs/context';
 * ```
 */

export {
    NestAware,
    isNestAware,
    NEST_AWARE_METADATA_KEY,
} from './context/NestAware';
export { NestManagedContext } from './context/NestManagedContext';
