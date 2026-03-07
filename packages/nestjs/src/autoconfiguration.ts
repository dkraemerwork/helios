/**
 * @zenystx/helios-nestjs/autoconfiguration — Boot 4 autoconfiguration subpath barrel.
 *
 * Import Boot 4 autoconfiguration symbols from this subpath to reduce bundle size:
 * ```typescript
 * import { HeliosAutoConfigurationModule } from '@zenystx/helios-nestjs/autoconfiguration';
 * ```
 */

export {
    HeliosAutoConfigurationModule,
    type HeliosAutoConfigurationAsyncOptions
} from './autoconfiguration/HeliosAutoConfigurationModule';
export {
    HeliosBoot4ObjectExtractionModule, type HeliosBoot4ObjectExtractionOptions, type HeliosObjectDescriptor, type HeliosObjectType
} from './autoconfiguration/HeliosBoot4ObjectExtractionModule';
