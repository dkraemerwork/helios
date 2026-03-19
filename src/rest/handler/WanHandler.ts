/**
 * REST handler for WAN replication management endpoints.
 *
 * Endpoints:
 *   POST /hazelcast/rest/wan/sync   — body: { configName, mapName } → trigger full sync
 *   POST /hazelcast/rest/wan/pause  — body: { configName } → pause publishers
 *   POST /hazelcast/rest/wan/resume — body: { configName } → resume publishers
 *   GET  /hazelcast/rest/wan/status?configName=X — publisher states and queue depths
 *
 * Analogous to com.hazelcast.wan.impl.rest.WanRestEndpoint.
 */
import type { WanReplicationService } from '@zenystx/helios-core/wan/impl/WanReplicationService.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export class WanHandler {
    constructor(private readonly _wanService: WanReplicationService) {}

    async handle(req: Request): Promise<Response> {
        const url = new URL(req.url);
        const path = url.pathname.replace(/\/$/, '');
        const method = req.method.toUpperCase();

        if (method === 'POST' && path === '/hazelcast/rest/wan/sync') {
            return this._handleSync(req);
        }
        if (method === 'POST' && path === '/hazelcast/rest/wan/pause') {
            return this._handlePause(req);
        }
        if (method === 'POST' && path === '/hazelcast/rest/wan/resume') {
            return this._handleResume(req);
        }
        if (method === 'GET' && path === '/hazelcast/rest/wan/status') {
            return this._handleStatus(url);
        }

        return new Response(
            JSON.stringify({ status: 404, message: 'Unknown WAN endpoint.' }),
            { status: 404, headers: JSON_HEADERS },
        );
    }

    private async _handleSync(req: Request): Promise<Response> {
        let body: unknown;
        try {
            body = await req.json();
        } catch {
            return this._error(400, 'Request body must be valid JSON');
        }
        if (typeof body !== 'object' || body === null) {
            return this._error(400, 'Request body must be an object');
        }
        const { configName, mapName } = body as Record<string, unknown>;
        if (typeof configName !== 'string' || configName.trim() === '') {
            return this._error(400, '"configName" must be a non-empty string');
        }
        if (typeof mapName !== 'string' || mapName.trim() === '') {
            return this._error(400, '"mapName" must be a non-empty string');
        }
        try {
            await this._wanService.triggerSync(configName, mapName);
        } catch (e) {
            return this._error(400, String(e));
        }
        return this._json({ status: 'OK', message: `WAN sync triggered for map '${mapName}' via config '${configName}'` });
    }

    private async _handlePause(req: Request): Promise<Response> {
        let body: unknown;
        try {
            body = await req.json();
        } catch {
            return this._error(400, 'Request body must be valid JSON');
        }
        if (typeof body !== 'object' || body === null) {
            return this._error(400, 'Request body must be an object');
        }
        const { configName } = body as Record<string, unknown>;
        if (typeof configName !== 'string' || configName.trim() === '') {
            return this._error(400, '"configName" must be a non-empty string');
        }
        try {
            this._wanService.pauseReplication(configName);
        } catch (e) {
            return this._error(400, String(e));
        }
        return this._json({ status: 'OK', message: `WAN replication paused for config '${configName}'` });
    }

    private async _handleResume(req: Request): Promise<Response> {
        let body: unknown;
        try {
            body = await req.json();
        } catch {
            return this._error(400, 'Request body must be valid JSON');
        }
        if (typeof body !== 'object' || body === null) {
            return this._error(400, 'Request body must be an object');
        }
        const { configName } = body as Record<string, unknown>;
        if (typeof configName !== 'string' || configName.trim() === '') {
            return this._error(400, '"configName" must be a non-empty string');
        }
        try {
            this._wanService.resumeReplication(configName);
        } catch (e) {
            return this._error(400, String(e));
        }
        return this._json({ status: 'OK', message: `WAN replication resumed for config '${configName}'` });
    }

    private _handleStatus(url: URL): Response {
        const configName = url.searchParams.get('configName');
        if (configName === null || configName.trim() === '') {
            // Return all configs if no specific config requested
            const result: Record<string, unknown[]> = {};
            for (const name of this._wanService.getConfigNames()) {
                result[name] = this._wanService.getStatus(name);
            }
            return this._json(result);
        }
        const status = this._wanService.getStatus(configName);
        return this._json({ configName, publishers: status });
    }

    private _json(body: unknown, statusCode = 200): Response {
        return new Response(JSON.stringify(body), { status: statusCode, headers: JSON_HEADERS });
    }

    private _error(statusCode: number, message: string): Response {
        return new Response(
            JSON.stringify({ status: statusCode, message }),
            { status: statusCode, headers: JSON_HEADERS },
        );
    }
}
