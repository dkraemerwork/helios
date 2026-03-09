/**
 * Helios Management Center
 *
 * Real-time cluster monitoring, metrics visualization, alerting,
 * and administration for Helios distributed systems.
 *
 * @packageDocumentation
 */

// ── Shared Types ────────────────────────────────────────────────────────────
export * from './shared/types.js';

// ── Constants ───────────────────────────────────────────────────────────────
export * from './shared/constants.js';

// ── Errors ──────────────────────────────────────────────────────────────────
export * from './shared/errors.js';

// ── Time Utilities ──────────────────────────────────────────────────────────
export * from './shared/time.js';

// ── Formatters ──────────────────────────────────────────────────────────────
export * from './shared/formatters.js';

// ── Config ──────────────────────────────────────────────────────────────────
export type { ManagementCenterConfig } from './config/ConfigSchema.js';
export { managementCenterConfigSchema, parseEnvToRawConfig } from './config/ConfigSchema.js';

// ── Extension ───────────────────────────────────────────────────────────────
export { ManagementCenterExtension } from './extension/ManagementCenterExtension.js';
export type { ManagementCenterExtensionConfig } from './extension/ManagementCenterExtensionConfig.js';
export { createManagementCenterExtension } from './extension/ExtensionRegistration.js';
