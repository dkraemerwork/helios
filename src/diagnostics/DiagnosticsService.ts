/**
 * DiagnosticsService — plugin-based periodic metric collection.
 *
 * Port of the Hazelcast diagnostics plugin framework:
 * {@code com.hazelcast.internal.diagnostics.DiagnosticsPlugin}.
 *
 * Lifecycle:
 *   - Call registerPlugin() before start().
 *   - Call start() to begin periodic collection.
 *   - Call stop() to halt collection.
 *   - Call getLatestSnapshot() / getHistory() to query collected data.
 */

// ── Plugin contract ────────────────────────────────────────────────────────────

/** A single collected diagnostic payload. */
export interface DiagnosticData {
    /** Identifies which plugin produced this data. */
    pluginName: string;
    /** Unix timestamp (ms) when the data was collected. */
    timestamp: number;
    /** Collected metrics: values are primitives for JSON-safe serialization. */
    metrics: Record<string, number | string | boolean>;
}

/** A diagnostic plugin that knows how to collect a set of metrics. */
export interface DiagnosticsPlugin {
    /** Unique identifier for this plugin. */
    readonly name: string;
    /** How often to collect data (ms). */
    readonly period: number;
    /** Collect and return current metrics. */
    collect(): DiagnosticData;
}

// ── History buffer ─────────────────────────────────────────────────────────────

const DEFAULT_HISTORY_SIZE = 100;

class RingBuffer<T> {
    private readonly _buf: T[] = [];

    constructor(private readonly _capacity: number) {}

    push(item: T): void {
        if (this._buf.length >= this._capacity) {
            this._buf.shift();
        }
        this._buf.push(item);
    }

    snapshot(): T[] {
        return [...this._buf];
    }

    get size(): number {
        return this._buf.length;
    }
}

// ── Built-in plugins ──────────────────────────────────────────────────────────

/**
 * Collects process-level system metrics: heap, RSS, external memory, and a
 * coarse event-loop-lag sample obtained by scheduling a zero-delay timer.
 */
export class SystemMetricsPlugin implements DiagnosticsPlugin {
    readonly name = 'SystemMetrics';
    readonly period = 5_000;

    /** Latest event loop lag in ms — updated asynchronously via setImmediate. */
    private _eventLoopLagMs = 0;
    private _lagTimer: ReturnType<typeof setInterval> | null = null;

    startLagSampler(): void {
        if (this._lagTimer !== null) return;
        this._lagTimer = setInterval(() => {
            const start = Date.now();
            setImmediate(() => {
                this._eventLoopLagMs = Date.now() - start;
            });
        }, 1_000);
        // Unreference so the timer does not prevent process exit
        this._lagTimer.unref?.();
    }

    stopLagSampler(): void {
        if (this._lagTimer !== null) {
            clearInterval(this._lagTimer);
            this._lagTimer = null;
        }
    }

    collect(): DiagnosticData {
        const mem = process.memoryUsage();
        return {
            pluginName: this.name,
            timestamp: Date.now(),
            metrics: {
                heapUsedBytes: mem.heapUsed,
                heapTotalBytes: mem.heapTotal,
                rssBytes: mem.rss,
                externalBytes: mem.external,
                arrayBuffersBytes: mem.arrayBuffers,
                heapUsedPercent: mem.heapTotal > 0
                    ? Math.round((mem.heapUsed / mem.heapTotal) * 10_000) / 100
                    : 0,
                eventLoopLagMs: this._eventLoopLagMs,
                uptimeSeconds: Math.floor(process.uptime()),
                pid: process.pid,
            },
        };
    }
}

/**
 * Collects connection-level metrics.
 * Counts are provided via a callback so the plugin stays decoupled from the
 * connection layer.
 */
export class ConnectionMetricsPlugin implements DiagnosticsPlugin {
    readonly name = 'ConnectionMetrics';
    readonly period = 10_000;

    constructor(
        private readonly _getActiveClientConnections: () => number,
        private readonly _getMemberConnections: () => number,
        private readonly _getTotalConnectionsCreated: () => number,
    ) {}

    collect(): DiagnosticData {
        return {
            pluginName: this.name,
            timestamp: Date.now(),
            metrics: {
                activeClientConnections: this._getActiveClientConnections(),
                memberConnections: this._getMemberConnections(),
                totalConnectionsCreated: this._getTotalConnectionsCreated(),
            },
        };
    }
}

/**
 * Collects operation-level metrics: pending, completed, and slow-operation
 * counts. Counts are provided via callbacks.
 */
export class OperationMetricsPlugin implements DiagnosticsPlugin {
    readonly name = 'OperationMetrics';
    readonly period = 5_000;

    constructor(
        private readonly _getPendingOperations: () => number,
        private readonly _getCompletedOperations: () => number,
        private readonly _getSlowOperationCount: () => number,
    ) {}

    collect(): DiagnosticData {
        return {
            pluginName: this.name,
            timestamp: Date.now(),
            metrics: {
                pendingOperations: this._getPendingOperations(),
                completedOperations: this._getCompletedOperations(),
                slowOperationCount: this._getSlowOperationCount(),
            },
        };
    }
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * Orchestrates multiple DiagnosticsPlugins, running each on its own timer.
 * History is stored in a per-plugin circular buffer.
 */
export class DiagnosticsService {
    private readonly _plugins: DiagnosticsPlugin[] = [];
    private readonly _timers: Array<ReturnType<typeof setInterval>> = [];
    private readonly _history = new Map<string, RingBuffer<DiagnosticData>>();
    private _running = false;
    private _systemPlugin: SystemMetricsPlugin | null = null;

    constructor(private readonly _historySize = DEFAULT_HISTORY_SIZE) {}

    /** Register a plugin. Must be called before start(). */
    registerPlugin(plugin: DiagnosticsPlugin): void {
        this._plugins.push(plugin);
        this._history.set(plugin.name, new RingBuffer<DiagnosticData>(this._historySize));
    }

    /** Start periodic collection. No-op if already running. */
    start(): void {
        if (this._running) return;
        this._running = true;

        // Start event-loop lag sampler if SystemMetricsPlugin is registered
        for (const plugin of this._plugins) {
            if (plugin instanceof SystemMetricsPlugin) {
                plugin.startLagSampler();
                this._systemPlugin = plugin;
            }
        }

        for (const plugin of this._plugins) {
            // Collect once immediately, then on each interval
            this._collect(plugin);
            const timer = setInterval(() => this._collect(plugin), plugin.period);
            timer.unref?.();
            this._timers.push(timer);
        }
    }

    /** Stop periodic collection. No-op if not running. */
    stop(): void {
        if (!this._running) return;
        this._running = false;

        for (const timer of this._timers) {
            clearInterval(timer);
        }
        this._timers.length = 0;

        this._systemPlugin?.stopLagSampler();
        this._systemPlugin = null;
    }

    /**
     * Returns the latest snapshot from every registered plugin.
     * Plugins with no data yet are omitted.
     */
    getLatestSnapshot(): DiagnosticData[] {
        const result: DiagnosticData[] = [];
        for (const [, buf] of this._history) {
            const snap = buf.snapshot();
            if (snap.length > 0) {
                result.push(snap[snap.length - 1]!);
            }
        }
        return result;
    }

    /**
     * Returns all historical data from every registered plugin in
     * chronological order (oldest first per plugin, plugins in registration order).
     */
    getHistory(): DiagnosticData[] {
        const result: DiagnosticData[] = [];
        for (const [, buf] of this._history) {
            result.push(...buf.snapshot());
        }
        return result;
    }

    /** Returns the history for a specific plugin by name, or [] if not found. */
    getPluginHistory(name: string): DiagnosticData[] {
        return this._history.get(name)?.snapshot() ?? [];
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private _collect(plugin: DiagnosticsPlugin): void {
        try {
            const data = plugin.collect();
            this._history.get(plugin.name)?.push(data);
        } catch {
            // Swallow plugin errors — diagnostics must never destabilize the node
        }
    }
}
