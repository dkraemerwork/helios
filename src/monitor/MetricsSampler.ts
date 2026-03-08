/**
 * MetricsSampler — collects runtime metrics at a configurable interval.
 *
 * Gathers:
 *   - Event loop latency (via `monitorEventLoopDelay` / `performance` APIs)
 *   - Process memory (`process.memoryUsage()`)
 *   - CPU usage delta (`process.cpuUsage()`)
 *   - V8 heap statistics (GC metrics)
 *   - Helios transport, objects, partition ownership (via MonitorStateProvider)
 *   - Blitz metrics (if active, via MonitorStateProvider)
 *
 * Pushes each sample into the {@link MetricsRegistry}.
 */

import type { MonitorConfig } from '@zenystx/helios-core/config/MonitorConfig';
import type { MetricsRegistry } from '@zenystx/helios-core/monitor/MetricsRegistry';
import type { CpuMetrics, EventLoopMetrics, GcMetrics, InvocationMetrics, MemoryMetrics, MetricsSample, MigrationMetrics, OperationMetrics } from '@zenystx/helios-core/monitor/MetricsSample';
import type { MonitorStateProvider } from '@zenystx/helios-core/monitor/MonitorStateProvider';
import { HeliosLoggers } from '@zenystx/helios-core/monitor/StructuredLogger';

/**
 * Event loop delay histogram — Bun exposes `performance.eventLoopUtilization()`
 * but not `monitorEventLoopDelay`. We approximate with high-resolution timer probes.
 */
class EventLoopProbe {
    private _samples: number[] = [];
    private _timer: ReturnType<typeof setInterval> | null = null;
    private _lastProbeTime = 0;

    /** Start probing event loop delay at ~100ms intervals. */
    start(): void {
        if (this._timer !== null) return;
        this._lastProbeTime = performance.now();

        // Schedule a 1ms timer — actual delay measures event loop backlog
        this._timer = setInterval(() => {
            const now = performance.now();
            const expectedMs = 1; // We scheduled at 1ms
            const actualMs = now - this._lastProbeTime;
            const delayMs = Math.max(0, actualMs - expectedMs);
            this._samples.push(delayMs);
            this._lastProbeTime = now;

            // Cap at 1000 samples to prevent memory growth
            if (this._samples.length > 1000) {
                this._samples.splice(0, this._samples.length - 500);
            }
        }, 1);
    }

    /** Collect and reset event loop metrics since last call. */
    collect(): EventLoopMetrics {
        if (this._samples.length === 0) {
            return { meanMs: 0, p50Ms: 0, p99Ms: 0, maxMs: 0, minMs: 0 };
        }

        const sorted = [...this._samples].sort((a, b) => a - b);
        const len = sorted.length;
        const sum = sorted.reduce((a, b) => a + b, 0);

        const result: EventLoopMetrics = {
            meanMs: round2(sum / len),
            p50Ms: round2(sorted[Math.floor(len * 0.5)]!),
            p99Ms: round2(sorted[Math.floor(len * 0.99)]!),
            maxMs: round2(sorted[len - 1]!),
            minMs: round2(sorted[0]!),
        };

        this._samples.length = 0;
        return result;
    }

    stop(): void {
        if (this._timer !== null) {
            clearInterval(this._timer);
            this._timer = null;
        }
        this._samples.length = 0;
    }
}

/** Round to 2 decimal places. */
function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

export class MetricsSampler {
    private readonly _config: MonitorConfig;
    private readonly _provider: MonitorStateProvider;
    private readonly _registry: MetricsRegistry;
    private readonly _elProbe = new EventLoopProbe();
    private _timer: ReturnType<typeof setInterval> | null = null;
    private _lastCpuUsage: ReturnType<typeof process.cpuUsage> | null = null;
    private _lastCpuTime = 0;
    private _running = false;

    constructor(config: MonitorConfig, provider: MonitorStateProvider, registry: MetricsRegistry) {
        this._config = config;
        this._provider = provider;
        this._registry = registry;
    }

    /** Start the sampling loop. */
    start(): void {
        if (this._running) return;
        this._running = true;

        // Initialize CPU baseline
        this._lastCpuUsage = process.cpuUsage();
        this._lastCpuTime = performance.now();

        // Start event loop probe
        this._elProbe.start();

        // Take an initial sample immediately
        this._takeSample();

        // Schedule periodic sampling
        this._timer = setInterval(() => {
            this._takeSample();
        }, this._config.getSampleIntervalMs());
    }

    /** Stop sampling. */
    stop(): void {
        if (!this._running) return;
        this._running = false;
        this._elProbe.stop();

        if (this._timer !== null) {
            clearInterval(this._timer);
            this._timer = null;
        }
    }

    /** Whether the sampler is active. */
    get isRunning(): boolean {
        return this._running;
    }

    private _takeSample(): void {
        const timestamp = Date.now();

        // Event loop
        const eventLoop = this._elProbe.collect();

        // Memory
        const mem = process.memoryUsage();
        const memory: MemoryMetrics = {
            heapUsed: mem.heapUsed,
            heapTotal: mem.heapTotal,
            rss: mem.rss,
            external: mem.external,
            arrayBuffers: mem.arrayBuffers,
        };

        // CPU delta
        const cpu = this._collectCpu();

        // GC / V8 heap
        const gc = this._collectGc();

        // Cluster state via provider
        const transport = this._provider.getTransportMetrics();
        const threads = this._provider.getThreadPoolMetrics();
        const migration: MigrationMetrics = this._provider.getMigrationMetrics();
        const operation: OperationMetrics = this._provider.getOperationMetrics();
        const invocation: InvocationMetrics = this._provider.getInvocationMetrics();
        const blitz = this._provider.getBlitzMetrics();

        // Hazelcast HealthMonitor parity: warn when pending invocations exceed thresholds.
        // Hazelcast alerts at > 70% of capacity OR absolute count > 1000.
        if (invocation.usedPercentage > 70 || invocation.pendingCount > 1000) {
            HeliosLoggers.invocation.warn('Pending invocations exceed health threshold', {
                event: 'invocation.health.threshold',
                pendingCount: invocation.pendingCount,
                maxConcurrent: invocation.maxConcurrent,
                usedPercentage: invocation.usedPercentage,
                timeoutFailures: invocation.timeoutFailures,
                memberLeftFailures: invocation.memberLeftFailures,
            });
        }

        const sample: MetricsSample = {
            timestamp,
            eventLoop,
            memory,
            cpu,
            gc,
            transport,
            threads,
            migration,
            operation,
            invocation,
            blitz,
        };

        this._registry.push(sample);
    }

    private _collectCpu(): CpuMetrics {
        const current = process.cpuUsage(this._lastCpuUsage ?? undefined);
        const now = performance.now();
        const elapsedMs = now - this._lastCpuTime;

        // Total CPU microseconds used in this interval
        const totalCpuUs = current.user + current.system;

        // Convert elapsed wall-clock to microseconds
        const elapsedUs = elapsedMs * 1000;

        // CPU percentage: (CPU time / wall time) × 100
        const percentUsed = elapsedUs > 0 ? round2((totalCpuUs / elapsedUs) * 100) : 0;

        // Update baseline
        this._lastCpuUsage = process.cpuUsage();
        this._lastCpuTime = now;

        return {
            userUs: current.user,
            systemUs: current.system,
            percentUsed,
        };
    }

    private _collectGc(): GcMetrics | null {
        if (!this._config.isCollectGcMetrics()) return null;

        try {
            // Bun supports v8.getHeapStatistics() via the v8 module
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const v8 = require('v8');
            const stats = v8.getHeapStatistics();
            return {
                totalHeapSize: stats.total_heap_size ?? 0,
                totalHeapSizeExecutable: stats.total_heap_size_executable ?? 0,
                usedHeapSize: stats.used_heap_size ?? 0,
                heapSizeLimit: stats.heap_size_limit ?? 0,
                totalPhysicalSize: stats.total_physical_size ?? 0,
                totalAvailableSize: stats.total_available_size ?? 0,
                mallocedMemory: stats.malloced_memory ?? 0,
                numberOfNativeContexts: stats.number_of_native_contexts ?? 0,
                numberOfDetachedContexts: stats.number_of_detached_contexts ?? 0,
            };
        } catch {
            // v8 module not available — skip GC metrics
            return null;
        }
    }
}
