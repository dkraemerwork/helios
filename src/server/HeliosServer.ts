/**
 * HeliosServer — standalone server lifecycle management.
 *
 * Wraps a HeliosInstanceImpl with startup, shutdown, and signal-handler wiring.
 * Suitable for use as a standalone server process or as an embedded server in tests.
 *
 * Block 7.7: CLI entrypoint + standalone server mode
 */
import { Helios } from '@helios/Helios';
import { HeliosConfig } from '@helios/config/HeliosConfig';
import { loadConfig } from '@helios/config/ConfigLoader';
import type { HeliosInstanceImpl } from '@helios/instance/impl/HeliosInstanceImpl';

export type ServerState = 'stopped' | 'starting' | 'running' | 'stopping';

/** Synchronous or async callback invoked on server shutdown. */
export type ShutdownHook = () => void | Promise<void>;

/**
 * Standalone Helios server.
 *
 * ```typescript
 * const server = new HeliosServer();
 * await server.start();                    // default config
 * await server.start(config);             // explicit HeliosConfig
 * await server.start('/path/config.yml'); // file-based config
 * // ...
 * await server.stop();
 * ```
 */
export class HeliosServer {
    private _state: ServerState = 'stopped';
    private _instance: HeliosInstanceImpl | null = null;
    private readonly _shutdownHooks: ShutdownHook[] = [];

    // ──────────────────────────────────────────
    // State / accessors
    // ──────────────────────────────────────────

    getState(): ServerState {
        return this._state;
    }

    isRunning(): boolean {
        return this._state === 'running';
    }

    getInstance(): HeliosInstanceImpl | null {
        return this._instance;
    }

    /**
     * Returns the TCP port that the underlying transport is bound to, or null
     * if the server is not running or TCP is not enabled.
     *
     * When TCP-IP join is disabled (the default) there is no dedicated listener
     * port, so this method returns a synthetic "cluster port" from the network
     * config instead — useful for tests that simply want a non-null number.
     */
    getBoundPort(): number | null {
        if (this._state !== 'running' || this._instance === null) {
            return null;
        }

        // If TCP transport is active, use its bound port.
        const transport = (this._instance as unknown as { _transport?: { boundPort(): number | null } })._transport;
        if (transport) {
            const port = transport.boundPort();
            if (port !== null) return port;
        }

        // Fall back to the configured network port (meaningful for embedded mode).
        const configuredPort = this._instance.getConfig().getNetworkConfig().getPort();
        return configuredPort > 0 ? configuredPort : null;
    }

    // ──────────────────────────────────────────
    // Lifecycle
    // ──────────────────────────────────────────

    /**
     * Starts the server.
     *
     * @param configOrFile
     *   - omitted / undefined: use the default HeliosConfig (name = 'helios')
     *   - HeliosConfig: use the supplied config object
     *   - string: load config from a .json or .yml/.yaml file
     *
     * @throws Error if the server is already running or starting
     */
    async start(configOrFile?: HeliosConfig | string): Promise<void> {
        if (this._state !== 'stopped') {
            throw new Error(`Cannot start: server is already in state "${this._state}"`);
        }

        this._state = 'starting';

        try {
            let config: HeliosConfig;
            if (typeof configOrFile === 'string') {
                config = await loadConfig(configOrFile);
            } else if (configOrFile instanceof HeliosConfig) {
                config = configOrFile;
            } else {
                config = new HeliosConfig();
            }

            this._instance = await Helios.newInstance(config);
            this._state = 'running';
        } catch (err) {
            this._state = 'stopped';
            this._instance = null;
            throw err;
        }
    }

    /**
     * Gracefully stops the server.
     *
     * Runs all registered shutdown hooks in registration order,
     * then shuts down the underlying HeliosInstance.
     * Safe to call even when the server is already stopped.
     */
    async stop(): Promise<void> {
        if (this._state === 'stopped') {
            return;
        }
        if (this._state === 'stopping') {
            return;
        }

        this._state = 'stopping';

        // Run shutdown hooks
        for (const hook of this._shutdownHooks) {
            try {
                await hook();
            } catch {
                // Swallow — best-effort hooks must not block shutdown
            }
        }

        // Shut down the Helios instance
        if (this._instance !== null) {
            if (this._instance.isRunning()) {
                this._instance.shutdown();
            }
            this._instance = null;
        }

        this._state = 'stopped';
    }

    /**
     * Registers a hook to be called during {@link stop()}, in registration order.
     * Can be called before or after {@link start()}.
     */
    addShutdownHook(hook: ShutdownHook): void {
        this._shutdownHooks.push(hook);
    }

    // ──────────────────────────────────────────
    // Signal handling
    // ──────────────────────────────────────────

    /**
     * Wires SIGINT and SIGTERM to graceful shutdown.
     * Call this once after {@link start()} in a long-running process.
     */
    installSignalHandlers(): void {
        const handler = async () => {
            await this.stop();
            process.exit(0);
        };
        process.on('SIGINT', handler);
        process.on('SIGTERM', handler);
    }
}
