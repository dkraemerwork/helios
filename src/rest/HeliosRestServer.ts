import { RestApiConfig } from '@zenystx/helios-core/config/RestApiConfig';
import { RestApiFilter } from '@zenystx/helios-core/rest/RestApiFilter';

type Handler = (req: Request) => Response | Promise<Response>;

/**
 * Built-in HTTP server for the Helios REST API.
 *
 * Wraps `Bun.serve()` and delegates access control to `RestApiFilter`.
 * Handlers for specific endpoint groups are registered via `registerHandler()`.
 *
 * Lifecycle:
 *  - `start()` — starts Bun.serve() on the configured port (no-op when REST is disabled)
 *  - `stop()`  — stops the server and frees the port
 *  - `getBoundPort()` — returns the actual OS-assigned port (useful when port=0 in tests)
 */
export class HeliosRestServer {
    private _server: ReturnType<typeof Bun.serve> | null = null;
    private readonly _filter: RestApiFilter;
    /** Prefix → handler registrations (evaluated in insertion order). */
    private readonly _handlers: Array<[string, Handler]> = [];

    constructor(private readonly _config: RestApiConfig) {
        this._filter = new RestApiFilter(_config);
    }

    /**
     * Starts the HTTP server on the configured port.
     * No-op if the REST API config is disabled or has no enabled groups.
     */
    start(): void {
        if (!this._config.isEnabledAndNotEmpty()) return;
        if (this._server !== null) return;

        this._server = Bun.serve({
            port: this._config.getPort(),
            fetch: (req) => this._handle(req),
        });
    }

    /** Stops the HTTP server. No-op if not started. */
    stop(): void {
        this._server?.stop(true);
        this._server = null;
    }

    /** Returns the actual bound port. Throws if the server is not started. */
    getBoundPort(): number {
        if (this._server === null) {
            throw new Error('HeliosRestServer is not started');
        }
        const port = this._server.port;
        if (port === undefined) throw new Error('HeliosRestServer port is unavailable');
        return port;
    }

    /** Returns true if the server is currently running. */
    isStarted(): boolean {
        return this._server !== null;
    }

    /**
     * Registers a path-prefix handler. When a request passes the filter,
     * the first handler whose prefix matches the request path is invoked.
     * Later blocks (11.3–11.5) use this to register endpoint-group handlers.
     */
    registerHandler(prefix: string, handler: Handler): void {
        this._handlers.push([prefix, handler]);
    }

    private _handle(req: Request): Response | Promise<Response> {
        const filtered = this._filter.filter(req);
        if (filtered !== null) return filtered;

        const pathname = new URL(req.url).pathname;
        for (const [prefix, handler] of this._handlers) {
            if (pathname === prefix || pathname.startsWith(prefix + '/')) {
                return handler(req);
            }
        }

        // Group is enabled but no handler registered yet — 404
        return new Response(
            JSON.stringify({ status: 404, message: 'Unknown REST endpoint.' }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
        );
    }
}
