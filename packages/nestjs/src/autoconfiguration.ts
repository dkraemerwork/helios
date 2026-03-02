/**
 * @helios/nestjs/autoconfiguration — Boot 4 autoconfiguration subpath barrel.
 *
 * Import Boot 4 autoconfiguration symbols from this subpath to reduce bundle size:
 * ```typescript
 * import { HeliosAutoConfigurationModule } from '@helios/nestjs/autoconfiguration';
 * ```
 */

export {
    HeliosAutoConfigurationModule,
    type HeliosAutoConfigurationAsyncOptions,
} from './autoconfiguration/HeliosAutoConfigurationModule';
export {
    HeliosBoot4ObjectExtractionModule,
    type HeliosObjectType,
    type HeliosObjectDescriptor,
    type HeliosBoot4ObjectExtractionOptions,
} from './autoconfiguration/HeliosBoot4ObjectExtractionModule';
