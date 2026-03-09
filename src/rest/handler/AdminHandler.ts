/**
 * AdminHandler — handles administrative REST endpoints for the Management Center.
 *
 * Endpoints:
 *   POST /helios/admin/cluster-state          — Set cluster state
 *   POST /helios/admin/job/:id/cancel         — Cancel a running job
 *   POST /helios/admin/job/:id/restart        — Restart a job
 *   POST /helios/admin/object/map/:name/clear — Clear all entries in a map
 *   POST /helios/admin/object/map/:name/evict — Evict all entries in a map
 *   POST /helios/admin/gc                     — Trigger garbage collection
 */

/** CORS headers for cross-origin MC requests. */
const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

const JSON_HEADERS = { 'Content-Type': 'application/json', ...CORS_HEADERS };

/**
 * Provider interface for admin operations. Implemented by HeliosInstanceImpl or a bridge.
 * Each method returns a result or throws on error.
 */
export interface AdminOperationsProvider {
    /** Set the cluster state (ACTIVE, FROZEN, PASSIVE, NO_MIGRATION). */
    setClusterState(state: string): void;

    /** Cancel a job by ID. Throws if the job is not found. */
    cancelJob(jobId: string): Promise<void>;

    /** Restart a job by ID. Throws if the job is not found. */
    restartJob(jobId: string): Promise<void>;

    /** Clear all entries in a named IMap. */
    clearMap(name: string): Promise<void>;

    /** Evict all entries in a named IMap. */
    evictMap(name: string): Promise<void>;

    /** Trigger garbage collection. */
    triggerGc(): void;
}

export class AdminHandler {
    constructor(private readonly _ops: AdminOperationsProvider) {}

    async handle(req: Request): Promise<Response> {
        // Handle CORS preflight
        if (req.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

        const url = new URL(req.url);
        const path = url.pathname;
        const method = req.method.toUpperCase();

        if (method !== 'POST') {
            return this._error(405, 'Only POST is supported for admin endpoints.');
        }

        // POST /helios/admin/cluster-state
        if (path === '/helios/admin/cluster-state') {
            return this._setClusterState(req);
        }

        // POST /helios/admin/gc
        if (path === '/helios/admin/gc') {
            return this._triggerGc();
        }

        // POST /helios/admin/job/:id/cancel
        const cancelMatch = path.match(/^\/helios\/admin\/job\/([^/]+)\/cancel$/);
        if (cancelMatch) {
            return this._cancelJob(cancelMatch[1]!);
        }

        // POST /helios/admin/job/:id/restart
        const restartMatch = path.match(/^\/helios\/admin\/job\/([^/]+)\/restart$/);
        if (restartMatch) {
            return this._restartJob(restartMatch[1]!);
        }

        // POST /helios/admin/object/map/:name/clear
        const clearMapMatch = path.match(/^\/helios\/admin\/object\/map\/([^/]+)\/clear$/);
        if (clearMapMatch) {
            return this._clearMap(decodeURIComponent(clearMapMatch[1]!));
        }

        // POST /helios/admin/object/map/:name/evict
        const evictMapMatch = path.match(/^\/helios\/admin\/object\/map\/([^/]+)\/evict$/);
        if (evictMapMatch) {
            return this._evictMap(decodeURIComponent(evictMapMatch[1]!));
        }

        return this._error(404, 'Unknown admin endpoint.');
    }

    private async _setClusterState(req: Request): Promise<Response> {
        const body = await this._parseJson(req);
        const state = (body as Record<string, unknown>)?.state;
        if (typeof state !== 'string') {
            return this._error(400, 'Missing "state" field in request body.');
        }
        try {
            this._ops.setClusterState(state);
            return this._ok({ success: true, state });
        } catch (e) {
            return this._error(400, e instanceof Error ? e.message : String(e));
        }
    }

    private async _cancelJob(jobId: string): Promise<Response> {
        try {
            await this._ops.cancelJob(jobId);
            return this._ok({ success: true, jobId });
        } catch (e) {
            return this._error(404, e instanceof Error ? e.message : String(e));
        }
    }

    private async _restartJob(jobId: string): Promise<Response> {
        try {
            await this._ops.restartJob(jobId);
            return this._ok({ success: true, jobId });
        } catch (e) {
            return this._error(404, e instanceof Error ? e.message : String(e));
        }
    }

    private async _clearMap(name: string): Promise<Response> {
        try {
            await this._ops.clearMap(name);
            return this._ok({ success: true, map: name });
        } catch (e) {
            return this._error(500, e instanceof Error ? e.message : String(e));
        }
    }

    private async _evictMap(name: string): Promise<Response> {
        try {
            await this._ops.evictMap(name);
            return this._ok({ success: true, map: name });
        } catch (e) {
            return this._error(500, e instanceof Error ? e.message : String(e));
        }
    }

    private _triggerGc(): Response {
        try {
            this._ops.triggerGc();
            return this._ok({ success: true, message: 'GC triggered.' });
        } catch (e) {
            return this._error(500, e instanceof Error ? e.message : String(e));
        }
    }

    private async _parseJson(req: Request): Promise<unknown> {
        try {
            return await req.json() as unknown;
        } catch {
            return null;
        }
    }

    private _ok(body: unknown): Response {
        return new Response(JSON.stringify(body), { status: 200, headers: JSON_HEADERS });
    }

    private _error(status: number, message: string): Response {
        return new Response(JSON.stringify({ status, message }), { status, headers: JSON_HEADERS });
    }
}
