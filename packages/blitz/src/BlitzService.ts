import { connect, type NatsConnection } from '@nats-io/transport-node';
import { jetstream, jetstreamManager, type JetStreamClient, type JetStreamManager } from '@nats-io/jetstream';
import { Kvm } from '@nats-io/kv';
import { type BlitzConfig, resolveBlitzConfig, type ResolvedBlitzConfig } from './BlitzConfig.js';
import { BlitzEvent } from './BlitzEvent.js';
import { Pipeline } from './Pipeline.js';
import { BatchPipeline } from './batch/BatchPipeline.js';
import { NatsServerManager } from './server/NatsServerManager.js';
import { NatsServerBinaryResolver } from './server/NatsServerBinaryResolver.js';
import type { NatsServerNodeConfig } from './server/NatsServerConfig.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Listener for BlitzEvents emitted by BlitzService. */
export type BlitzEventListener = (event: BlitzEvent, detail?: unknown) => void;

/**
 * BlitzService — top-level entry point for the Helios Blitz stream processing engine.
 *
 * Owns the NATS connection lifecycle: connect, expose JetStream/KV handles, shutdown.
 * Subscribes to `nc.status()` and emits {@link BlitzEvent}s for reconnect and error conditions.
 *
 * JetStream manager (`jsm`) and KV manager (`kvm`) are lazy-initialized on first
 * access. This allows BlitzService to connect to a NATS cluster that hasn't yet
 * elected a Raft leader (e.g. during cluster formation) — core pub/sub works
 * immediately, and JetStream operations become available once the leader is elected.
 *
 * Usage:
 * ```typescript
 * const blitz = await BlitzService.connect({ servers: 'nats://localhost:4222' });
 * blitz.on((event) => console.log('BlitzEvent:', event));
 * // Core NATS pub/sub is available immediately via blitz.nc
 * // JetStream operations are available once the cluster has a leader:
 * const jsm = await blitz.getJsm();
 * await blitz.shutdown();
 * ```
 */
export class BlitzService {
    /** Resolved configuration (all defaults applied). */
    readonly config: ResolvedBlitzConfig;

    /** The underlying NATS connection. */
    readonly nc: NatsConnection;

    /** JetStream publish/subscribe client (available immediately — does not require leader). */
    readonly js: JetStreamClient;

    /**
     * JetStream management API (streams, consumers).
     * @deprecated Use `getJsm()` for safe lazy initialization. This field is
     *             initialized eagerly when possible but may be null during
     *             cluster formation. Kept for backward compatibility.
     */
    get jsm(): JetStreamManager {
        if (this._jsm === null) {
            throw new Error(
                'JetStream manager is not yet initialized. The NATS cluster may still be electing a leader. ' +
                'Use `await blitz.getJsm()` for retry-based initialization, or `blitz.waitForJetStream()` to block until ready.',
            );
        }
        return this._jsm;
    }

    /**
     * Key-Value store manager.
     * @deprecated Use `getKvm()` for safe lazy initialization.
     */
    get kvm(): Kvm {
        if (this._kvm === null) {
            throw new Error(
                'KV manager is not yet initialized. The NATS cluster may still be electing a leader. ' +
                'Use `await blitz.getKvm()` for retry-based initialization, or `blitz.waitForJetStream()` to block until ready.',
            );
        }
        return this._kvm;
    }

    private _jsm: JetStreamManager | null;
    private _kvm: Kvm | null;
    private _closed = false;
    private _manager: NatsServerManager | null = null;
    private readonly _listeners: BlitzEventListener[] = [];
    private readonly _runningPipelines = new Map<string, Pipeline>();
    private _jsmInitPromise: Promise<JetStreamManager> | null = null;

    private constructor(
        config: ResolvedBlitzConfig,
        nc: NatsConnection,
        js: JetStreamClient,
        jsm: JetStreamManager | null,
        kvm: Kvm | null,
    ) {
        this.config = config;
        this.nc = nc;
        this.js = js;
        this._jsm = jsm;
        this._kvm = kvm;

        // Subscribe to NATS status events and forward as BlitzEvents.
        this._subscribeToStatus();
    }

    /**
     * Start an embedded NATS JetStream server and connect BlitzService to it.
     *
     * @throws NatsServerNotFoundError if the nats-server binary cannot be resolved.
     * @throws Error if the server(s) do not become reachable within startTimeoutMs.
     */
    static async start(config: Omit<BlitzConfig, 'servers'> = {}): Promise<BlitzService> {
        const resolved = resolveBlitzConfig(config);
        const nodeConfigs = buildNodeConfigs(resolved);
        const manager = await NatsServerManager.spawn(nodeConfigs);
        const servers = manager.clientUrls;
        // Strip embedded/cluster before calling connect — connect only needs servers
        const { embedded: _e, cluster: _c, ...rest } = config;
        const service = await BlitzService.connect({ ...rest, servers });
        service._manager = manager;
        return service;
    }

    /**
     * Establish a NATS connection and initialize JetStream/KV handles.
     *
     * Core NATS connection is established eagerly. JetStream manager and KV
     * manager initialization is attempted but will not block or fail if the
     * cluster hasn't elected a Raft leader yet — they become available lazily
     * via `getJsm()` / `getKvm()` / `waitForJetStream()`.
     *
     * @throws if the NATS TCP connection cannot be established within `config.connectTimeoutMs`.
     */
    static async connect(config: BlitzConfig): Promise<BlitzService> {
        const resolved = resolveBlitzConfig(config);
        if (!resolved.servers) {
            throw new Error('BlitzService.connect() requires `servers` in config. Use BlitzService.start() for embedded mode.');
        }

        const nc = await connect({
            servers: resolved.servers,
            timeout: resolved.connectTimeoutMs,
            reconnect: resolved.maxReconnectAttempts !== 0,
            maxReconnectAttempts: resolved.maxReconnectAttempts === -1
                ? undefined
                : resolved.maxReconnectAttempts,
            reconnectTimeWait: resolved.reconnectWaitMs,
        });

        const js = jetstream(nc);

        // Attempt eager JetStream manager init (non-blocking best-effort).
        // If the cluster hasn't elected a leader yet, jsm/kvm stay null
        // and are initialized lazily on first access via getJsm()/getKvm().
        let jsm: JetStreamManager | null = null;
        let kvm: Kvm | null = null;
        try {
            jsm = await jetstreamManager(nc, { timeout: 2000 });
            kvm = new Kvm(nc);
        } catch {
            // JetStream not ready yet (cluster forming, no Raft leader).
            // This is expected during multi-node cluster startup.
            // jsm/kvm will be lazy-initialized on first access.
        }

        return new BlitzService(resolved, nc, js, jsm, kvm);
    }

    /**
     * Returns true if this service has been shut down.
     */
    get isClosed(): boolean {
        return this._closed;
    }

    /**
     * Returns true if the JetStream manager has been initialized.
     * When false, JetStream operations are not yet available (cluster may still
     * be electing a Raft leader). Use `waitForJetStream()` to block until ready.
     */
    get isJetStreamReady(): boolean {
        return this._jsm !== null;
    }

    /**
     * Get the JetStream manager, initializing it lazily if needed.
     * Retries with backoff until JetStream is available.
     *
     * @param timeoutMs Maximum time to wait for JetStream readiness. @default 15000
     * @throws Error if JetStream does not become available within timeoutMs.
     */
    async getJsm(timeoutMs = 15_000): Promise<JetStreamManager> {
        if (this._jsm !== null) return this._jsm;
        await this.waitForJetStream(timeoutMs);
        return this._jsm!;
    }

    /**
     * Get the KV manager, initializing it lazily if needed.
     *
     * @param timeoutMs Maximum time to wait for JetStream readiness. @default 15000
     */
    async getKvm(timeoutMs = 15_000): Promise<Kvm> {
        if (this._kvm !== null) return this._kvm;
        await this.waitForJetStream(timeoutMs);
        return this._kvm!;
    }

    /**
     * Wait until JetStream is operational (Raft leader elected).
     * Polls with 200ms intervals, matching Hazelcast's "fast scan" pattern.
     *
     * @param timeoutMs Maximum time to wait. @default 15000
     * @throws Error if JetStream does not become available within timeoutMs.
     */
    async waitForJetStream(timeoutMs = 15_000): Promise<void> {
        if (this._jsm !== null) return;

        // Deduplicate concurrent calls
        if (this._jsmInitPromise !== null) {
            await this._jsmInitPromise;
            return;
        }

        this._jsmInitPromise = this._initJetStream(timeoutMs);
        try {
            await this._jsmInitPromise;
        } finally {
            this._jsmInitPromise = null;
        }
    }

    /**
     * Register a listener for BlitzEvents.
     * The listener receives the event type and an optional detail payload.
     */
    on(listener: BlitzEventListener): this {
        this._listeners.push(listener);
        return this;
    }

    /**
     * Remove a previously registered BlitzEvent listener.
     */
    off(listener: BlitzEventListener): this {
        const idx = this._listeners.indexOf(listener);
        if (idx !== -1) {
            this._listeners.splice(idx, 1);
        }
        return this;
    }

    /**
     * Create a new pipeline builder with the given name.
     * The pipeline is NOT submitted until `blitz.submit(p)` is called.
     */
    pipeline(name: string): Pipeline {
        return new Pipeline(name);
    }

    /**
     * Create a new bounded batch pipeline with the given name.
     *
     * A batch pipeline reads from a finite source (e.g. `FileSource.lines()`,
     * `HeliosMapSource.snapshot()`), processes records through operators, and
     * returns a `Promise<BatchResult>` when the source is exhausted.
     *
     * ```typescript
     * const result = await blitz.batch('etl-job')
     *   .readFrom(FileSource.lines('/data/input.ndjson'))
     *   .map(line => JSON.parse(line))
     *   .writeTo(HeliosMapSink.put(activeUsersMap));
     * ```
     */
    batch(name: string): BatchPipeline {
        return new BatchPipeline(name);
    }

    /**
     * Validate and submit a pipeline for execution.
     *
     * Validates the DAG structure (throws {@link PipelineError} on invalid DAG),
     * registers the pipeline as running, and starts consumer loops for each vertex.
     *
     * @throws PipelineError if the DAG is invalid
     */
    async submit(p: Pipeline): Promise<void> {
        // Validate throws PipelineError if the DAG is malformed
        p.validate();
        this._runningPipelines.set(p.name, p);
        // Consumer loop startup will be wired in Block 10.2+ when real sources/sinks are added.
    }

    /**
     * Cancel a running pipeline by name.
     *
     * Gracefully stops all consumer loops and removes the pipeline from the running set.
     * Emits {@link BlitzEvent.PIPELINE_CANCELLED}.
     * If no pipeline with the given name is running, this is a no-op.
     */
    async cancel(name: string): Promise<void> {
        if (!this._runningPipelines.has(name)) {
            return;
        }
        this._runningPipelines.delete(name);
        this._emit(BlitzEvent.PIPELINE_CANCELLED, { name });
    }

    /**
     * Returns true if a pipeline with the given name is currently running.
     */
    isRunning(name: string): boolean {
        return this._runningPipelines.has(name);
    }

    /**
     * Gracefully drain and close the NATS connection.
     *
     * Drain ensures in-flight messages are delivered before the connection closes.
     * After shutdown, no further NATS operations should be performed.
     */
    async shutdown(): Promise<void> {
        if (this._closed) {
            return;
        }
        this._closed = true;
        await this.nc.drain();
        // N15 FIX: must await — kills embedded processes and waits for port release
        await this._manager?.shutdown();
    }

    /**
     * Poll `jetstreamManager()` with 200ms intervals until it succeeds or timeout.
     * Mirrors Hazelcast's pattern: fast polling (100-200ms) during cluster formation.
     */
    private async _initJetStream(timeoutMs: number): Promise<JetStreamManager> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            try {
                const jsm = await jetstreamManager(this.nc, { timeout: 2000 });
                this._jsm = jsm;
                this._kvm = new Kvm(this.nc);
                this._emit(BlitzEvent.NATS_RECONNECTED, { reason: 'jetstream-ready' });
                return jsm;
            } catch {
                // JetStream not ready yet — Raft leader election in progress
                await new Promise<void>((r) => setTimeout(r, 200));
            }
        }
        throw new Error(
            `JetStream did not become operational within ${timeoutMs}ms. ` +
            'The NATS cluster may not have enough nodes for Raft quorum.',
        );
    }

    private _emit(event: BlitzEvent, detail?: unknown): void {
        for (const listener of this._listeners) {
            try {
                listener(event, detail);
            } catch {
                // swallow listener errors — do not let them crash the service
            }
        }
    }

    private _subscribeToStatus(): void {
        // nc.status() returns an async iterable of StatusEvent objects.
        // We consume it in a detached async task so it doesn't block connect().
        (async () => {
            for await (const s of this.nc.status()) {
                if (s.type === 'reconnecting') {
                    this._emit(BlitzEvent.NATS_RECONNECTING, s);
                } else if (s.type === 'reconnect') {
                    this._emit(BlitzEvent.NATS_RECONNECTED, s);
                }
                // Other status types (disconnect, error, etc.) are not mapped
                // to BlitzEvents at Block 10.0 — pipeline-level events are
                // emitted by Pipeline.cancel() and individual stage operators.
            }
        })().catch(() => {
            // Status iterator closes when the connection closes — swallow.
        });
    }
}

/**
 * Translate ResolvedBlitzConfig → NatsServerNodeConfig[].
 * Internal helper for BlitzService.start().
 */
function buildNodeConfigs(config: ResolvedBlitzConfig): NatsServerNodeConfig[] {
    if (config.embedded) {
        const e = config.embedded;
        const binaryPath = NatsServerBinaryResolver.resolve(e.binaryPath);
        return [{
            binaryPath,
            port: e.port,
            clusterPort: 0,
            dataDir: e.dataDir,
            serverName: 'helios-blitz-embedded',
            clusterName: undefined,
            routes: [],
            extraArgs: e.extraArgs,
            startTimeoutMs: e.startTimeoutMs,
        }];
    }

    if (config.cluster) {
        const c = config.cluster;
        const binaryPath = NatsServerBinaryResolver.resolve(c.binaryPath);
        const nodes: NatsServerNodeConfig[] = [];

        // For cluster mode without explicit dataDir, use unique temp dirs per node
        // to avoid JetStream storage conflicts between nodes sharing the OS default.
        const baseTmpDir = c.dataDir ?? join(tmpdir(), `blitz-cluster-${Date.now()}`);

        for (let i = 0; i < c.nodes; i++) {
            const port = c.basePort + i;
            const clusterPort = c.baseClusterPort + i;
            const routes = Array.from({ length: c.nodes }, (_, j) => j)
                .filter(j => j !== i)
                .map(j => `nats://127.0.0.1:${c.baseClusterPort + j}`);

            nodes.push({
                binaryPath,
                port,
                clusterPort,
                dataDir: `${baseTmpDir}/node-${i}`,
                serverName: `${c.name}-node-${i}`,
                clusterName: c.name,
                routes,
                extraArgs: [],
                startTimeoutMs: c.startTimeoutMs,
            });
        }

        return nodes;
    }

    throw new Error('buildNodeConfigs: config must have embedded or cluster set');
}
