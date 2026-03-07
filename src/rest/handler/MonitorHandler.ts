/**
 * MonitorHandler — serves the Helios monitoring dashboard and metrics data.
 *
 * Endpoints:
 *   GET /helios/monitor           — HTML dashboard (single-page, self-contained)
 *   GET /helios/monitor/data      — Full MonitorPayload as JSON (one-shot)
 *   GET /helios/monitor/stream    — SSE stream of MetricsSample events
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

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8' };
const SSE_HEADERS = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
};

export class MonitorHandler {
    constructor(
        private readonly _config: MonitorConfig,
        private readonly _registry: MetricsRegistry,
        private readonly _provider: MonitorStateProvider,
    ) {}

    handle(req: Request): Response {
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

                // Subscribe to new samples
                const unsubscribe = registry.subscribe((sample) => {
                    write(`event: sample\ndata: ${JSON.stringify(sample)}\n\n`);
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
