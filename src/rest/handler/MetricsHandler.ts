/**
 * MetricsHandler — serves Helios comprehensive metrics via the REST API.
 *
 * Endpoints:
 *   GET /helios/metrics           — JSON metrics object (all subsystems)
 *   GET /helios/metrics/prometheus — Prometheus text exposition format
 *
 * The handler reads from the shared HazelcastMetrics singleton and, when
 * a MetricsRegistry is provided, also updates the runtime gauges from the
 * latest MetricsSample before responding.
 */

import type { HazelcastMetrics } from '@zenystx/helios-core/monitor/HazelcastMetrics';
import type { MetricsRegistry } from '@zenystx/helios-core/monitor/MetricsRegistry';
import type { ResourceLimiter } from '@zenystx/helios-core/monitor/ResourceLimiter';

const JSON_HEADERS  = { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' };
const TEXT_HEADERS  = { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Cache-Control': 'no-cache' };
const CORS_HEADERS  = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };

export class MetricsHandler {
    constructor(
        private readonly _metrics: HazelcastMetrics,
        private readonly _registry: MetricsRegistry | null,
        private readonly _limiter: ResourceLimiter | null,
    ) {}

    handle(req: Request): Response {
        if (req.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

        const path = new URL(req.url).pathname;

        // Sync runtime gauges from latest MetricsSample before serving
        this._syncRuntimeMetrics();

        if (path === '/helios/metrics' || path === '/helios/metrics/') {
            return this._jsonMetrics();
        }

        if (path === '/helios/metrics/prometheus') {
            return this._prometheusMetrics();
        }

        return new Response(
            JSON.stringify({ status: 404, message: 'Unknown metrics endpoint.' }),
            { status: 404, headers: { ...JSON_HEADERS, ...CORS_HEADERS } },
        );
    }

    private _syncRuntimeMetrics(): void {
        const latest = this._registry?.getLatest() ?? null;
        if (latest !== null) {
            this._metrics.updateFromSample(latest);
        }

        // Sync resource limiter gauges
        if (this._limiter !== null) {
            const snap = this._limiter.getSnapshot();
            this._metrics.connections.active.value           = snap.activeConnections;
            this._metrics.connections.totalCreated.value     = snap.totalConnectionsCreated;
            this._metrics.connections.lost.value             = snap.totalConnectionsRejected;
        }
    }

    private _jsonMetrics(): Response {
        const payload = {
            timestamp: new Date().toISOString(),
            metrics: this._metrics.renderJson(),
            ...(this._limiter ? { resourceLimiter: this._limiter.getSnapshot() } : {}),
        };
        return new Response(JSON.stringify(payload), {
            status: 200,
            headers: { ...JSON_HEADERS, ...CORS_HEADERS },
        });
    }

    private _prometheusMetrics(): Response {
        return new Response(this._metrics.renderPrometheus(), {
            status: 200,
            headers: { ...TEXT_HEADERS, ...CORS_HEADERS },
        });
    }
}
