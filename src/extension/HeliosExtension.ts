/**
 * HeliosExtension — generic extension bootstrapping interface.
 *
 * Extensions are discovered and loaded by the HeliosServer during startup.
 * Each extension receives an ExtensionContext providing access to core services
 * (logger, environment, metrics) without a direct dependency on HeliosInstanceImpl.
 *
 * Lifecycle:
 *   1. HeliosServer creates the extension instance
 *   2. `start(context)` is called after the instance is fully initialized
 *   3. `stop()` is called during graceful shutdown (before instance shutdown)
 */

import type { MetricsRegistry } from '@zenystx/helios-core/monitor/MetricsRegistry';

/** Minimal logger interface for extensions (avoids coupling to StructuredLogger). */
export interface ExtensionLogger {
    info(message: string, context?: Record<string, unknown>): void;
    warn(message: string, context?: Record<string, unknown>): void;
    error(message: string, context?: Record<string, unknown>): void;
    debug(message: string, context?: Record<string, unknown>): void;
}

/** Context provided to extensions during start(). */
export interface ExtensionContext {
    /** Logger scoped to the extension. */
    readonly logger: ExtensionLogger;
    /** Environment variables accessible to the extension. */
    readonly env: Record<string, string | undefined>;
    /** Metrics registry for the extension to register custom metrics. Null if monitoring is disabled. */
    readonly metricsRegistry: MetricsRegistry | null;
    /** The REST server for the extension to register custom endpoints. */
    readonly restServer: {
        registerHandler(prefix: string, handler: (req: Request) => Response | Promise<Response>): void;
    };
}

/** Extension interface that plugins implement to integrate with Helios. */
export interface HeliosExtension {
    /** Unique identifier for this extension (e.g. 'management-center'). */
    readonly id: string;
    /** Called after the Helios instance is fully initialized. */
    start(context: ExtensionContext): Promise<void>;
    /** Called during graceful shutdown, before the instance is torn down. */
    stop(): Promise<void>;
}
