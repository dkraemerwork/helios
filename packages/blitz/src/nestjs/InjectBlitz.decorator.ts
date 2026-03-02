import { Inject } from '@nestjs/common';

/**
 * Token under which {@link HeliosBlitzService} is registered in the NestJS DI container.
 * Use with {@link InjectBlitz} or `@Inject(HELIOS_BLITZ_SERVICE_TOKEN)`.
 */
export const HELIOS_BLITZ_SERVICE_TOKEN = 'HeliosBlitzService';

/**
 * Parameter decorator that injects the {@link HeliosBlitzService} bound to the
 * `HeliosBlitzModule`.
 *
 * ```typescript
 * constructor(@InjectBlitz() private readonly blitz: HeliosBlitzService) {}
 * ```
 */
export const InjectBlitz = (): ParameterDecorator => Inject(HELIOS_BLITZ_SERVICE_TOKEN);
