/**
 * @InjectHelios() — parameter decorator that injects the HeliosInstance.
 *
 * Equivalent to @Inject(HELIOS_INSTANCE_TOKEN) but more ergonomic.
 *
 * ```typescript
 * @Injectable()
 * class MyService {
 *     constructor(@InjectHelios() private readonly helios: HeliosInstance) {}
 * }
 * ```
 */

import { Inject } from '@nestjs/common';
import { HELIOS_INSTANCE_TOKEN } from '../HeliosInstanceDefinition';

/**
 * Parameter decorator that injects the HeliosInstance registered under
 * {@link HELIOS_INSTANCE_TOKEN}.
 */
export const InjectHelios = (): ParameterDecorator => Inject(HELIOS_INSTANCE_TOKEN);
