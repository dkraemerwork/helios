/**
 * Helper for registering ManagementCenterExtension with a Helios instance.
 *
 * Provides a convenient factory function that creates and returns a configured
 * extension ready to be passed to the Helios extension registry.
 */

import { ManagementCenterExtension } from './ManagementCenterExtension.js';
import type { ManagementCenterExtensionConfig } from './ManagementCenterExtensionConfig.js';

/**
 * Creates a new ManagementCenterExtension instance with the provided config.
 *
 * Usage:
 * ```ts
 * import { createManagementCenterExtension } from '@zenystx/helios-management-center';
 *
 * const extension = createManagementCenterExtension({
 *   port: 9090,
 *   databaseUrl: 'file:mc.db',
 *   bootstrapAdminEmail: 'admin@example.com',
 *   bootstrapAdminPassword: 'secure-password-here',
 *   csrfSecret: 'a-random-secret-at-least-16-chars',
 * });
 *
 * // Register with Helios instance
 * helios.registerExtension(extension);
 * ```
 */
export function createManagementCenterExtension(
  config: ManagementCenterExtensionConfig = {},
): ManagementCenterExtension {
  return new ManagementCenterExtension(config);
}
