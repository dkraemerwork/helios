const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * State provider interface for the cluster-write handler.
 * Implemented by HeliosInstanceImpl and injectable in tests.
 */
export interface ClusterWriteState {
    getLogLevel(): string;
    setLogLevel(level: string): void;
    resetLogLevel(): void;
    shutdown(): void;
}

/**
 * Handles the CLUSTER_WRITE endpoint group.
 *
 * Endpoints:
 *  GET  /hazelcast/rest/log-level                              → {"logLevel":"INFO"}
 *  POST /hazelcast/rest/log-level   body: {"logLevel":"DEBUG"} → 200 OK
 *  POST /hazelcast/rest/log-level/reset                        → 200 OK
 *  POST /hazelcast/rest/management/cluster/memberShutdown      → 200 OK (async shutdown)
 *
 * The memberShutdown endpoint sends 200 OK immediately, then fires shutdown()
 * asynchronously so the response flushes before the server stops.
 *
 * Analogous to com.hazelcast.internal.management.rest.ClusterWriteHandler.
 */
export class ClusterWriteHandler {
    constructor(private readonly _state: ClusterWriteState) {}

    async handle(req: Request): Promise<Response> {
        const path = new URL(req.url).pathname;
        const method = req.method.toUpperCase();

        // GET /hazelcast/rest/log-level
        if (path === '/hazelcast/rest/log-level' || path === '/hazelcast/rest/log-level/') {
            if (method === 'GET') {
                return this._json({ logLevel: this._state.getLogLevel() });
            }
            if (method === 'POST') {
                const body = await this._parseJson(req);
                const level = (body as Record<string, unknown>)?.logLevel;
                if (typeof level !== 'string') {
                    return new Response(
                        JSON.stringify({ status: 400, message: 'Missing logLevel field.' }),
                        { status: 400, headers: JSON_HEADERS },
                    );
                }
                this._state.setLogLevel(level);
                return this._json({ success: true });
            }
        }

        // POST /hazelcast/rest/log-level/reset
        if (path === '/hazelcast/rest/log-level/reset') {
            if (method === 'POST') {
                this._state.resetLogLevel();
                return this._json({ success: true });
            }
        }

        // POST /hazelcast/rest/management/cluster/memberShutdown
        if (path === '/hazelcast/rest/management/cluster/memberShutdown') {
            if (method === 'POST') {
                // Send 200 first, then shutdown asynchronously
                const response = this._json({ success: true });
                Promise.resolve().then(() => this._state.shutdown());
                return response;
            }
        }

        return new Response(
            JSON.stringify({ status: 404, message: 'Unknown cluster-write endpoint.' }),
            { status: 404, headers: JSON_HEADERS },
        );
    }

    private async _parseJson(req: Request): Promise<unknown> {
        try {
            return await req.json() as unknown;
        } catch {
            return null;
        }
    }

    private _json(body: unknown): Response {
        return new Response(JSON.stringify(body), { status: 200, headers: JSON_HEADERS });
    }
}
