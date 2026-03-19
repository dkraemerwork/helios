/**
 * StatsHandler — REST management endpoints for per-structure statistics and cluster info.
 *
 * All endpoints live under /hazelcast/rest/stats/ to avoid overlapping with the
 * existing DataHandler (/maps, /queues) and ClusterReadHandler (/cluster) prefixes.
 *
 * Endpoints:
 *   GET  /hazelcast/rest/stats/maps/{name}        — per-map stats (LocalMapStats snapshot)
 *   GET  /hazelcast/rest/stats/queues/{name}       — per-queue stats (LocalQueueStats snapshot)
 *   GET  /hazelcast/rest/stats/cluster/members     — member list with addresses and UUIDs
 *   GET  /hazelcast/rest/stats/cluster/version     — cluster version string
 *   POST /hazelcast/rest/stats/cluster/state       — change cluster state
 *   GET  /hazelcast/rest/stats/diagnostics         — latest diagnostic snapshot from DiagnosticsService
 */

import type { LocalQueueStats } from '@zenystx/helios-core/collection/LocalQueueStats';
import type { DiagnosticData } from '@zenystx/helios-core/diagnostics/DiagnosticsService';
import type { LocalMapStats } from '@zenystx/helios-core/internal/monitor/impl/LocalMapStatsImpl';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// ── Provider interface ────────────────────────────────────────────────────────

/** Member info for the REST members endpoint. */
export interface MemberInfoSnapshot {
    uuid: string;
    address: string;
    localMember: boolean;
    liteMember: boolean;
}

/**
 * State provider interface for StatsHandler.
 * Implemented by HeliosInstanceImpl or a test double.
 */
export interface StatsHandlerState {
    /** Returns stats for a named map, or null if the map has no stats yet. */
    getMapStats(name: string): LocalMapStats | null;
    /** Returns stats for a named queue, or null if the queue has no stats yet. */
    getQueueStats(name: string): LocalQueueStats | null;
    /** Returns all cluster members. */
    getMembers(): MemberInfoSnapshot[];
    /** Returns the cluster version string. */
    getClusterVersion(): string;
    /**
     * Transition the cluster to the given state.
     * @throws Error with human-readable message if the state is invalid.
     */
    setClusterState(state: string): void;
    /** Returns the latest diagnostic data from the DiagnosticsService, or [] if not started. */
    getDiagnostics(): DiagnosticData[];
}

// ── Handler ───────────────────────────────────────────────────────────────────

export class StatsHandler {
    constructor(private readonly _state: StatsHandlerState) {}

    async handle(req: Request): Promise<Response> {
        const url = new URL(req.url);
        const path = url.pathname;
        const method = req.method.toUpperCase();

        // GET /hazelcast/rest/stats/maps/{name}
        const mapStatsMatch = path.match(/^\/hazelcast\/rest\/stats\/maps\/([^/]+)\/?$/);
        if (mapStatsMatch !== null && method === 'GET') {
            return this._mapStats(mapStatsMatch[1]!);
        }

        // GET /hazelcast/rest/stats/queues/{name}
        const queueStatsMatch = path.match(/^\/hazelcast\/rest\/stats\/queues\/([^/]+)\/?$/);
        if (queueStatsMatch !== null && method === 'GET') {
            return this._queueStats(queueStatsMatch[1]!);
        }

        // GET /hazelcast/rest/stats/cluster/members
        if ((path === '/hazelcast/rest/stats/cluster/members' || path === '/hazelcast/rest/stats/cluster/members/') && method === 'GET') {
            return this._clusterMembers();
        }

        // GET /hazelcast/rest/stats/cluster/version
        if ((path === '/hazelcast/rest/stats/cluster/version' || path === '/hazelcast/rest/stats/cluster/version/') && method === 'GET') {
            return this._clusterVersion();
        }

        // POST /hazelcast/rest/stats/cluster/state
        if ((path === '/hazelcast/rest/stats/cluster/state' || path === '/hazelcast/rest/stats/cluster/state/') && method === 'POST') {
            return await this._changeClusterState(req);
        }

        // GET /hazelcast/rest/stats/diagnostics
        if ((path === '/hazelcast/rest/stats/diagnostics' || path === '/hazelcast/rest/stats/diagnostics/') && method === 'GET') {
            return this._diagnostics();
        }

        return new Response(
            JSON.stringify({ status: 404, message: 'Unknown stats endpoint.' }),
            { status: 404, headers: JSON_HEADERS },
        );
    }

    // ── Endpoint implementations ──────────────────────────────────────────────

    private _mapStats(name: string): Response {
        const stats = this._state.getMapStats(decodeURIComponent(name));
        if (stats === null) {
            return new Response(
                JSON.stringify({ status: 404, message: `No stats found for map '${name}'.` }),
                { status: 404, headers: JSON_HEADERS },
            );
        }
        return this._json({ mapName: decodeURIComponent(name), stats, timestamp: Date.now() });
    }

    private _queueStats(name: string): Response {
        const stats = this._state.getQueueStats(decodeURIComponent(name));
        if (stats === null) {
            return new Response(
                JSON.stringify({ status: 404, message: `No stats found for queue '${name}'.` }),
                { status: 404, headers: JSON_HEADERS },
            );
        }
        return this._json({
            queueName: decodeURIComponent(name),
            stats: this._serializeQueueStats(stats),
            timestamp: Date.now(),
        });
    }

    private _clusterMembers(): Response {
        return this._json({ members: this._state.getMembers(), timestamp: Date.now() });
    }

    private _clusterVersion(): Response {
        return this._json({ version: this._state.getClusterVersion(), timestamp: Date.now() });
    }

    private async _changeClusterState(req: Request): Promise<Response> {
        let body: unknown;
        try {
            body = await req.json() as unknown;
        } catch {
            return new Response(
                JSON.stringify({ status: 400, message: 'Invalid JSON body.' }),
                { status: 400, headers: JSON_HEADERS },
            );
        }

        const state = (body as Record<string, unknown>)?.state;
        if (typeof state !== 'string' || state.length === 0) {
            return new Response(
                JSON.stringify({ status: 400, message: 'Missing or invalid "state" field. Expected one of: ACTIVE, FROZEN, PASSIVE.' }),
                { status: 400, headers: JSON_HEADERS },
            );
        }

        try {
            this._state.setClusterState(state);
        } catch (err) {
            return new Response(
                JSON.stringify({ status: 400, message: (err as Error).message }),
                { status: 400, headers: JSON_HEADERS },
            );
        }

        return this._json({ success: true, state });
    }

    private _diagnostics(): Response {
        return this._json({
            diagnostics: this._state.getDiagnostics(),
            timestamp: Date.now(),
        });
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private _serializeQueueStats(stats: LocalQueueStats): Record<string, number> {
        return {
            creationTime: stats.getCreationTime(),
            ownedItemCount: stats.getOwnedItemCount(),
            backupItemCount: stats.getBackupItemCount(),
            minAge: stats.getMinAge(),
            maxAge: stats.getMaxAge(),
            averageAge: stats.getAverageAge(),
            offerOperationCount: stats.getOfferOperationCount(),
            rejectedOfferOperationCount: stats.getRejectedOfferOperationCount(),
            pollOperationCount: stats.getPollOperationCount(),
            emptyPollOperationCount: stats.getEmptyPollOperationCount(),
            otherOperationCount: stats.getOtherOperationCount(),
            eventOperationCount: stats.getEventOperationCount(),
        };
    }

    private _json(body: unknown): Response {
        return new Response(JSON.stringify(body), { status: 200, headers: JSON_HEADERS });
    }
}
