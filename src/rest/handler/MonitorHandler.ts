/**
 * MonitorHandler — serves the Helios monitoring dashboard and metrics data.
 *
 * Endpoints:
 *   GET /helios/monitor           — HTML dashboard (single-page, self-contained)
 *   GET /helios/monitor/data      — Full MonitorPayload as JSON (one-shot)
 *   GET /helios/monitor/stream    — SSE stream of MetricsSample events
 *   GET /helios/monitor/jobs      — Active jobs with topology and metrics
 *   GET /helios/monitor/config    — Cluster configuration metadata for MC compatibility
 *
 * The SSE stream sends:
 *   - `event: sample` with JSON MetricsSample on each new sample
 *   - `:keepalive` comments at the configured interval
 *   - `event: init` with the full MonitorPayload on connection
 */

import type { MonitorConfig } from '@zenystx/helios-core/config/MonitorConfig';
import type { MetricsRegistry } from '@zenystx/helios-core/monitor/MetricsRegistry';
import { renderMonitorDashboard } from '@zenystx/helios-core/monitor/MonitorDashboard';
import type { MonitorStateProvider } from '@zenystx/helios-core/monitor/MonitorStateProvider';

/**
 * Provider for job-level data exposed via `/helios/monitor/jobs`.
 * Implemented by HeliosInstanceImpl or a bridge that delegates to the BlitzJobCoordinator.
 */
export interface MonitorJobsProvider {
    getActiveJobs(): Promise<MonitorJobSnapshot[]>;
}

/** JSON-serializable snapshot of a single active job. */
export interface MonitorJobSnapshot {
    id: string;
    name: string;
    status: string;
    submittedAt: number;
    executionStartTime: number | null;
    executionCompletionTime: number | null;
    lightJob: boolean;
    supportsCancel: boolean;
    supportsRestart: boolean;
    participatingMembers: readonly string[];
    /** Vertex descriptors (topology nodes). */
    vertices: ReadonlyArray<{ name: string; type: string }>;
    /** Edge descriptors (topology edges). */
    edges: ReadonlyArray<{ from: string; to: string; edgeType: string }>;
    /** Per-vertex metrics (already JSON-safe — Maps converted to plain objects). */
    metrics: Record<string, unknown> | null;
}

/** CORS headers — required for multi-node dashboards where the browser connects to nodes on different ports. */
const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

const JSON_HEADERS = { 'Content-Type': 'application/json', ...CORS_HEADERS };
const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8' };
const SSE_HEADERS = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...CORS_HEADERS,
};

export class MonitorHandler {
    constructor(
        private readonly _config: MonitorConfig,
        private readonly _registry: MetricsRegistry,
        private readonly _provider: MonitorStateProvider,
        private readonly _jobsProvider: MonitorJobsProvider | null = null,
        private readonly _capabilities: { monitoring: boolean; admin: boolean } = { monitoring: true, admin: true },
    ) {}

    handle(req: Request): Response | Promise<Response> {
        // Handle CORS preflight for cross-port multi-node dashboard requests
        if (req.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

        const path = new URL(req.url).pathname;

        if (path === '/helios/monitor' || path === '/helios/monitor/') {
            return this._dashboard();
        }
        if (path === '/helios/monitor/data') {
            return this._data();
        }
        if (path === '/helios/monitor/stream') {
            return this._stream();
        }
        if (path === '/helios/monitor/jobs') {
            return this._jobs();
        }
        if (path === '/helios/monitor/config') {
            return this._configEndpoint();
        }

        return new Response(
            JSON.stringify({ status: 404, message: 'Unknown monitor endpoint.' }),
            { status: 404, headers: JSON_HEADERS },
        );
    }

    /** Serve the self-contained HTML dashboard. */
    private _dashboard(): Response {
        return new Response(renderMonitorDashboard(), {
            status: 200,
            headers: HTML_HEADERS,
        });
    }

    /** Serve the full MonitorPayload as JSON. */
    private _data(): Response {
        const payload = this._registry.buildPayload(this._provider);
        return new Response(JSON.stringify(payload), {
            status: 200,
            headers: JSON_HEADERS,
        });
    }

    /** Serve active jobs with topology and metrics. */
    private async _jobs(): Promise<Response> {
        if (this._jobsProvider === null) {
            return new Response(
                JSON.stringify({ jobs: [], message: 'No job coordinator available.' }),
                { status: 200, headers: JSON_HEADERS },
            );
        }

        const jobs = await this._jobsProvider.getActiveJobs();
        return new Response(JSON.stringify({ jobs }), {
            status: 200,
            headers: JSON_HEADERS,
        });
    }

    /** Serve cluster configuration metadata for Management Center compatibility. */
    private _configEndpoint(): Response {
        const payload = {
            instanceName: this._provider.getInstanceName(),
            clusterState: this._provider.getClusterState(),
            clusterSize: this._provider.getClusterSize(),
            memberVersion: this._provider.getMemberVersion(),
            partitionCount: this._provider.getPartitionCount(),
            nodeState: this._provider.getNodeState(),
            capabilities: {
                monitoring: this._capabilities.monitoring,
                admin: this._capabilities.admin,
                jobs: this._jobsProvider !== null,
                extensions: true,
            },
        };
        return new Response(JSON.stringify(payload), {
            status: 200,
            headers: JSON_HEADERS,
        });
    }

    /** SSE stream of metrics samples. */
    private _stream(): Response {
        const registry = this._registry;
        const provider = this._provider;
        const keepaliveMs = this._config.getSseKeepaliveMs();

        const stream = new ReadableStream({
            start(controller) {
                const encoder = new TextEncoder();
                const write = (text: string): void => {
                    try {
                        controller.enqueue(encoder.encode(text));
                    } catch {
                        // Stream closed by client
                    }
                };

                // Send full payload on connect
                const initPayload = registry.buildPayload(provider);
                write(`event: init\ndata: ${JSON.stringify(initPayload)}\n\n`);

                // Subscribe to new samples — also piggyback a payload refresh so diagnostics panels stay live
                const unsubscribe = registry.subscribe((sample) => {
                    write(`event: sample\ndata: ${JSON.stringify(sample)}\n\n`);
                    // Refresh payload-level fields (mapStats, queueStats, topicStats, systemEvents, storeLatency)
                    const refreshPayload = registry.buildPayload(provider);
                    write(`event: payload\ndata: ${JSON.stringify(refreshPayload)}\n\n`);
                });

                // Keepalive timer
                const keepaliveTimer = setInterval(() => {
                    write(`:keepalive ${Date.now()}\n\n`);
                }, keepaliveMs);

                // Cleanup when stream is cancelled
                const checkClosed = setInterval(() => {
                    try {
                        // Test if controller is still usable
                        if (controller.desiredSize === null) {
                            clearInterval(checkClosed);
                            clearInterval(keepaliveTimer);
                            unsubscribe();
                        }
                    } catch {
                        clearInterval(checkClosed);
                        clearInterval(keepaliveTimer);
                        unsubscribe();
                    }
                }, 5_000);
            },
        });

        return new Response(stream, {
            status: 200,
            headers: SSE_HEADERS,
        });
    }
}
