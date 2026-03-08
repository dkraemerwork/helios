/**
 * HazelcastMetrics — comprehensive metrics exposure for all Helios subsystems.
 *
 * Integrates with the existing MetricsRegistry and exposes a flat metrics map
 * compatible with Prometheus text format via the /metrics REST endpoint.
 *
 * Metric naming follows Hazelcast conventions: hz.<subsystem>.<name>
 *
 * Types:
 *   counter  — monotonically increasing value (resets on restart)
 *   gauge    — point-in-time value (can go up or down)
 *   histogram — distribution of values (min/max/p50/p99/mean)
 */

import type { MetricsSample } from '@zenystx/helios-core/monitor/MetricsSample';

// ── Metric type system ───────────────────────────────────────────────────────

export type MetricType = 'counter' | 'gauge' | 'histogram';

export interface MetricLabel {
    readonly name: string;
    readonly value: string;
}

export interface MetricDescriptor {
    readonly name: string;
    readonly type: MetricType;
    readonly help: string;
    readonly labels?: readonly MetricLabel[];
}

export interface CounterMetric extends MetricDescriptor {
    readonly type: 'counter';
    value: number;
}

export interface GaugeMetric extends MetricDescriptor {
    readonly type: 'gauge';
    value: number;
}

export interface HistogramMetric extends MetricDescriptor {
    readonly type: 'histogram';
    min: number;
    max: number;
    mean: number;
    p50: number;
    p99: number;
    count: number;
    sum: number;
}

export type AnyMetric = CounterMetric | GaugeMetric | HistogramMetric;

// ── Counter / Gauge builders ─────────────────────────────────────────────────

export function counter(name: string, help: string, labels?: readonly MetricLabel[]): CounterMetric {
    return { name, type: 'counter', help, labels, value: 0 };
}

export function gauge(name: string, help: string, labels?: readonly MetricLabel[]): GaugeMetric {
    return { name, type: 'gauge', help, labels, value: 0 };
}

export function histogram(name: string, help: string, labels?: readonly MetricLabel[]): HistogramMetric {
    return { name, type: 'histogram', help, labels, min: 0, max: 0, mean: 0, p50: 0, p99: 0, count: 0, sum: 0 };
}

// ── Per-datastructure label helpers ─────────────────────────────────────────

function mapLabel(mapName: string): readonly MetricLabel[] {
    return [{ name: 'map', value: mapName }];
}

function queueLabel(queueName: string): readonly MetricLabel[] {
    return [{ name: 'queue', value: queueName }];
}

function topicLabel(topicName: string): readonly MetricLabel[] {
    return [{ name: 'topic', value: topicName }];
}

function executorLabel(executorName: string): readonly MetricLabel[] {
    return [{ name: 'executor', value: executorName }];
}

// ── Main HazelcastMetrics class ──────────────────────────────────────────────

/**
 * Central metrics registry for all Helios subsystems.
 *
 * All counters/gauges are plain objects — zero allocation on disabled levels.
 * Callers increment/set values directly; no callbacks or closures allocated
 * unless a metric is actively updated.
 */
export class HazelcastMetrics {

    // ── Topology ─────────────────────────────────────────────────────────────

    readonly topology = {
        memberCount:      gauge('hz.topology.memberCount',      'Current number of cluster members'),
        partitionCount:   gauge('hz.topology.partitionCount',   'Total number of partitions'),
        primaryOwned:     gauge('hz.topology.primaryOwned',     'Number of partitions owned locally (primary)'),
        backupOwned:      gauge('hz.topology.backupOwned',      'Number of partitions owned locally (backup)'),
        migrationCount:   counter('hz.topology.migrationCount', 'Total partition migrations started since node start'),
        migrationActive:  gauge('hz.topology.migrationActive',  'Number of in-progress partition migrations'),
    };

    // ── Connections ──────────────────────────────────────────────────────────

    readonly connections = {
        active:        gauge('hz.client.connection.active',           'Currently open client connections'),
        totalCreated:  counter('hz.client.connection.totalCreated',   'Total client connections ever established'),
        lost:          counter('hz.client.connection.lost',           'Total client connections lost (unclean close)'),
        reconnects:    counter('hz.client.connection.reconnects',     'Total successful reconnect attempts'),
        reconnectsFailed: counter('hz.client.connection.reconnectsFailed', 'Total failed reconnect attempts'),

        /** Inter-member transport channels */
        peerChannels:   gauge('hz.transport.peerChannels',   'Open inter-member TCP channels'),
        bytesRead:      counter('hz.transport.bytesRead',    'Total bytes received over inter-member transport'),
        bytesWritten:   counter('hz.transport.bytesWritten', 'Total bytes sent over inter-member transport'),
    };

    // ── Invocations ──────────────────────────────────────────────────────────

    readonly invocations = {
        active:              gauge('hz.client.invocation.active',              'Currently in-flight client invocations'),
        completed:           counter('hz.client.invocation.completed',         'Total successfully completed invocations'),
        timedOut:            counter('hz.client.invocation.timedOut',          'Total invocations that timed out'),
        retried:             counter('hz.client.invocation.retried',           'Total invocation retries'),
        memberLeftFailures:  counter('hz.client.invocation.memberLeftFailures','Invocations failed due to target member leaving'),
        backpressureWaits:   counter('hz.client.invocation.backpressureWaits', 'Times backpressure caused an invocation to wait'),
        backpressureRejects: counter('hz.client.invocation.backpressureRejects','Invocations rejected by backpressure'),
        latency:             histogram('hz.client.invocation.latencyMs',       'Invocation round-trip latency in milliseconds'),
    };

    // ── Listeners ────────────────────────────────────────────────────────────

    readonly listeners = {
        activeRegistrations:  gauge('hz.listener.activeRegistrations',    'Currently registered event listeners'),
        recoveryAttempts:     counter('hz.listener.recoveryAttempts',     'Total listener re-registration attempts after reconnect'),
        recoveryFailures:     counter('hz.listener.recoveryFailures',     'Total listener re-registration failures'),
    };

    // ── Near Cache ───────────────────────────────────────────────────────────

    readonly nearCache = {
        hits:            counter('hz.nearCache.hits',           'Near-cache lookup hits'),
        misses:          counter('hz.nearCache.misses',         'Near-cache lookup misses'),
        invalidations:   counter('hz.nearCache.invalidations',  'Near-cache entries invalidated'),
        staleReads:      counter('hz.nearCache.staleReads',     'Stale reads detected and repaired'),
        /** Per-map near-cache size gauges, keyed by map name */
        sizeByMap:       new Map<string, GaugeMetric>(),
    };

    /** Ensure a per-map near-cache size gauge exists and return it. */
    nearCacheSizeForMap(mapName: string): GaugeMetric {
        let g = this.nearCache.sizeByMap.get(mapName);
        if (g === undefined) {
            g = gauge('hz.nearCache.size', `Near-cache size for map '${mapName}'`, mapLabel(mapName));
            this.nearCache.sizeByMap.set(mapName, g);
        }
        return g;
    }

    // ── Transactions ─────────────────────────────────────────────────────────

    readonly transactions = {
        active:    gauge('hz.transaction.active',   'Currently open transactions'),
        committed: counter('hz.transaction.committed', 'Total committed transactions'),
        rolledBack: counter('hz.transaction.rolledBack', 'Total rolled-back transactions'),
        timedOut:  counter('hz.transaction.timedOut', 'Transactions that exceeded their timeout'),
    };

    // ── SQL ──────────────────────────────────────────────────────────────────

    readonly sql = {
        activeQueries:    gauge('hz.sql.activeQueries',    'Currently executing SQL queries'),
        completedQueries: counter('hz.sql.completedQueries', 'Total SQL queries completed'),
        queryErrors:      counter('hz.sql.queryErrors',    'SQL queries that resulted in an error'),
        rowsReturned:     counter('hz.sql.rowsReturned',   'Total rows returned by SQL queries'),
    };

    // ── Serialization ────────────────────────────────────────────────────────

    readonly serialization = {
        serializationsTotal:   counter('hz.serialization.serializationsTotal',   'Total object serializations'),
        deserializationsTotal: counter('hz.serialization.deserializationsTotal', 'Total object deserializations'),
        compactSchemaFetches:  counter('hz.serialization.compactSchemaFetches',  'Compact schema fetches from cluster'),
    };

    // ── Executor ─────────────────────────────────────────────────────────────

    readonly executor = {
        /** Global executor counters */
        submitted:     counter('hz.executor.submitted',     'Total tasks submitted to executors'),
        completed:     counter('hz.executor.completed',     'Total executor tasks completed'),
        cancelled:     counter('hz.executor.cancelled',     'Total executor tasks cancelled'),
        rejected:      counter('hz.executor.rejected',      'Total executor tasks rejected (queue full)'),
        activeWorkers: gauge('hz.executor.activeWorkers',   'Total currently active executor worker threads'),

        /** Per-executor gauges/counters, keyed by executor name */
        activeByExecutor:    new Map<string, GaugeMetric>(),
        submittedByExecutor: new Map<string, CounterMetric>(),
    };

    executorActiveWorkers(executorName: string): GaugeMetric {
        let g = this.executor.activeByExecutor.get(executorName);
        if (g === undefined) {
            g = gauge('hz.executor.activeWorkers', `Active workers for executor '${executorName}'`, executorLabel(executorName));
            this.executor.activeByExecutor.set(executorName, g);
        }
        return g;
    }

    executorSubmitted(executorName: string): CounterMetric {
        let c = this.executor.submittedByExecutor.get(executorName);
        if (c === undefined) {
            c = counter('hz.executor.submitted', `Tasks submitted to executor '${executorName}'`, executorLabel(executorName));
            this.executor.submittedByExecutor.set(executorName, c);
        }
        return c;
    }

    // ── Data structures ──────────────────────────────────────────────────────

    readonly map = {
        /** Per-map operation counters, keyed by map name */
        gets:    new Map<string, CounterMetric>(),
        puts:    new Map<string, CounterMetric>(),
        removes: new Map<string, CounterMetric>(),
        sizes:   new Map<string, GaugeMetric>(),
    };

    mapGet(mapName: string): CounterMetric {
        return this._lazyCounter(this.map.gets, mapName, 'hz.map.gets', 'Map get operations', mapLabel(mapName));
    }

    mapPut(mapName: string): CounterMetric {
        return this._lazyCounter(this.map.puts, mapName, 'hz.map.puts', 'Map put operations', mapLabel(mapName));
    }

    mapRemove(mapName: string): CounterMetric {
        return this._lazyCounter(this.map.removes, mapName, 'hz.map.removes', 'Map remove operations', mapLabel(mapName));
    }

    mapSize(mapName: string): GaugeMetric {
        let g = this.map.sizes.get(mapName);
        if (g === undefined) {
            g = gauge('hz.map.size', `Current entry count for map '${mapName}'`, mapLabel(mapName));
            this.map.sizes.set(mapName, g);
        }
        return g;
    }

    readonly queue = {
        offers:  new Map<string, CounterMetric>(),
        polls:   new Map<string, CounterMetric>(),
        sizes:   new Map<string, GaugeMetric>(),
    };

    queueOffer(queueName: string): CounterMetric {
        return this._lazyCounter(this.queue.offers, queueName, 'hz.queue.offers', 'Queue offer operations', queueLabel(queueName));
    }

    queuePoll(queueName: string): CounterMetric {
        return this._lazyCounter(this.queue.polls, queueName, 'hz.queue.polls', 'Queue poll operations', queueLabel(queueName));
    }

    queueSize(queueName: string): GaugeMetric {
        let g = this.queue.sizes.get(queueName);
        if (g === undefined) {
            g = gauge('hz.queue.size', `Current depth of queue '${queueName}'`, queueLabel(queueName));
            this.queue.sizes.set(queueName, g);
        }
        return g;
    }

    readonly topic = {
        publishes: new Map<string, CounterMetric>(),
        received:  new Map<string, CounterMetric>(),
    };

    topicPublish(topicName: string): CounterMetric {
        return this._lazyCounter(this.topic.publishes, topicName, 'hz.topic.publishes', 'Topic publish operations', topicLabel(topicName));
    }

    topicReceived(topicName: string): CounterMetric {
        return this._lazyCounter(this.topic.received, topicName, 'hz.topic.received', 'Topic messages received', topicLabel(topicName));
    }

    // ── Event loop / runtime ─────────────────────────────────────────────────

    readonly runtime = {
        eventLoopLatency: histogram('hz.runtime.eventLoopLatencyMs', 'Event loop delay in milliseconds'),
        heapUsedBytes:    gauge('hz.runtime.heapUsedBytes',   'JVM/V8 heap used bytes'),
        heapTotalBytes:   gauge('hz.runtime.heapTotalBytes',  'JVM/V8 heap total bytes'),
        cpuPercent:       gauge('hz.runtime.cpuPercent',      'CPU utilization percentage'),
    };

    // ── Snapshot update from MetricsSample ───────────────────────────────────

    /**
     * Update runtime gauges/histograms from the latest MetricsSample.
     * Called by MetricsSampler on each sample tick.
     */
    updateFromSample(sample: MetricsSample): void {
        const { eventLoop, memory, cpu } = sample;

        const h = this.runtime.eventLoopLatency;
        h.min   = eventLoop.minMs;
        h.max   = eventLoop.maxMs;
        h.mean  = eventLoop.meanMs;
        h.p50   = eventLoop.p50Ms;
        h.p99   = eventLoop.p99Ms;
        h.count += 1;
        h.sum   += eventLoop.meanMs;

        this.runtime.heapUsedBytes.value  = memory.heapUsed;
        this.runtime.heapTotalBytes.value = memory.heapTotal;
        this.runtime.cpuPercent.value     = cpu.percentUsed;

        const { transport } = sample;
        this.connections.peerChannels.value = transport.peerCount;
        // Transport byte counters are cumulative — set as gauge snapshot
        // (true counters are maintained separately via the transport stats delta)
        this.connections.bytesRead.value    = transport.bytesRead;
        this.connections.bytesWritten.value = transport.bytesWritten;
    }

    // ── Prometheus text rendering ─────────────────────────────────────────────

    /**
     * Render all metrics in Prometheus text exposition format.
     * Compatible with Prometheus scrape, Grafana, and OpenTelemetry collectors.
     */
    renderPrometheus(): string {
        const lines: string[] = [];

        for (const metric of this._allMetrics()) {
            this._renderMetric(metric, lines);
        }

        return lines.join('\n') + '\n';
    }

    /**
     * Render all metrics as a JSON object for the /metrics REST endpoint.
     */
    renderJson(): Record<string, unknown> {
        const out: Record<string, unknown> = {};

        for (const metric of this._allMetrics()) {
            const key = _prometheusKey(metric);
            if (metric.type === 'histogram') {
                out[key] = {
                    type: 'histogram',
                    min: metric.min,
                    max: metric.max,
                    mean: metric.mean,
                    p50: metric.p50,
                    p99: metric.p99,
                    count: metric.count,
                    sum: metric.sum,
                    labels: metric.labels ?? [],
                };
            } else {
                out[key] = {
                    type: metric.type,
                    value: metric.value,
                    labels: metric.labels ?? [],
                };
            }
        }

        return out;
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private _lazyCounter(map: Map<string, CounterMetric>, key: string, name: string, help: string, labels: readonly MetricLabel[]): CounterMetric {
        let c = map.get(key);
        if (c === undefined) {
            c = counter(name, help, labels);
            map.set(key, c);
        }
        return c;
    }

    private *_allMetrics(): Generator<AnyMetric> {
        // Topology
        yield this.topology.memberCount;
        yield this.topology.partitionCount;
        yield this.topology.primaryOwned;
        yield this.topology.backupOwned;
        yield this.topology.migrationCount;
        yield this.topology.migrationActive;

        // Connections
        yield this.connections.active;
        yield this.connections.totalCreated;
        yield this.connections.lost;
        yield this.connections.reconnects;
        yield this.connections.reconnectsFailed;
        yield this.connections.peerChannels;
        yield this.connections.bytesRead;
        yield this.connections.bytesWritten;

        // Invocations
        yield this.invocations.active;
        yield this.invocations.completed;
        yield this.invocations.timedOut;
        yield this.invocations.retried;
        yield this.invocations.memberLeftFailures;
        yield this.invocations.backpressureWaits;
        yield this.invocations.backpressureRejects;
        yield this.invocations.latency;

        // Listeners
        yield this.listeners.activeRegistrations;
        yield this.listeners.recoveryAttempts;
        yield this.listeners.recoveryFailures;

        // Near cache
        yield this.nearCache.hits;
        yield this.nearCache.misses;
        yield this.nearCache.invalidations;
        yield this.nearCache.staleReads;
        yield* this.nearCache.sizeByMap.values();

        // Transactions
        yield this.transactions.active;
        yield this.transactions.committed;
        yield this.transactions.rolledBack;
        yield this.transactions.timedOut;

        // SQL
        yield this.sql.activeQueries;
        yield this.sql.completedQueries;
        yield this.sql.queryErrors;
        yield this.sql.rowsReturned;

        // Serialization
        yield this.serialization.serializationsTotal;
        yield this.serialization.deserializationsTotal;
        yield this.serialization.compactSchemaFetches;

        // Executor
        yield this.executor.submitted;
        yield this.executor.completed;
        yield this.executor.cancelled;
        yield this.executor.rejected;
        yield this.executor.activeWorkers;
        yield* this.executor.activeByExecutor.values();
        yield* this.executor.submittedByExecutor.values();

        // Data structures
        yield* this.map.gets.values();
        yield* this.map.puts.values();
        yield* this.map.removes.values();
        yield* this.map.sizes.values();
        yield* this.queue.offers.values();
        yield* this.queue.polls.values();
        yield* this.queue.sizes.values();
        yield* this.topic.publishes.values();
        yield* this.topic.received.values();

        // Runtime
        yield this.runtime.eventLoopLatency;
        yield this.runtime.heapUsedBytes;
        yield this.runtime.heapTotalBytes;
        yield this.runtime.cpuPercent;
    }

    private _renderMetric(metric: AnyMetric, lines: string[]): void {
        const labelStr = _renderLabels(metric.labels);

        lines.push(`# HELP ${metric.name} ${metric.help}`);
        lines.push(`# TYPE ${metric.name} ${metric.type === 'histogram' ? 'gauge' : metric.type}`);

        if (metric.type === 'histogram') {
            lines.push(`${metric.name}_min${labelStr} ${metric.min}`);
            lines.push(`${metric.name}_max${labelStr} ${metric.max}`);
            lines.push(`${metric.name}_mean${labelStr} ${metric.mean}`);
            lines.push(`${metric.name}_p50${labelStr} ${metric.p50}`);
            lines.push(`${metric.name}_p99${labelStr} ${metric.p99}`);
            lines.push(`${metric.name}_count${labelStr} ${metric.count}`);
            lines.push(`${metric.name}_sum${labelStr} ${metric.sum}`);
        } else {
            lines.push(`${metric.name}${labelStr} ${metric.value}`);
        }
    }
}

// ── Module-level singleton ────────────────────────────────────────────────────

/** Global singleton — one per process. Use this for all metric updates. */
export const globalMetrics = new HazelcastMetrics();

// ── Utility functions ─────────────────────────────────────────────────────────

function _renderLabels(labels: readonly MetricLabel[] | undefined): string {
    if (!labels || labels.length === 0) return '';
    const pairs = labels.map((l) => `${l.name}="${l.value.replace(/"/g, '\\"')}"`).join(',');
    return `{${pairs}}`;
}

function _prometheusKey(metric: AnyMetric): string {
    const labelStr = metric.labels?.map((l) => `${l.name}="${l.value}"`).join(',') ?? '';
    return labelStr ? `${metric.name}{${labelStr}}` : metric.name;
}
