import { connect, type NatsConnection } from '@nats-io/transport-node';
import { jetstream, jetstreamManager, type JetStreamClient, type JetStreamManager } from '@nats-io/jetstream';
import { Kvm } from '@nats-io/kv';
import { type BlitzConfig, resolveBlitzConfig, type ResolvedBlitzConfig } from './BlitzConfig.ts';
import { BlitzEvent } from './BlitzEvent.ts';
import { Pipeline } from './Pipeline.ts';
import { BatchPipeline } from './batch/BatchPipeline.ts';

/** Listener for BlitzEvents emitted by BlitzService. */
export type BlitzEventListener = (event: BlitzEvent, detail?: unknown) => void;

/**
 * BlitzService — top-level entry point for the Helios Blitz stream processing engine.
 *
 * Owns the NATS connection lifecycle: connect, expose JetStream/KV handles, shutdown.
 * Subscribes to `nc.status()` and emits {@link BlitzEvent}s for reconnect and error conditions.
 *
 * Usage:
 * ```typescript
 * const blitz = await BlitzService.connect({ servers: 'nats://localhost:4222' });
 * blitz.on((event) => console.log('BlitzEvent:', event));
 * // ... use blitz.js, blitz.jsm, blitz.kvm ...
 * await blitz.shutdown();
 * ```
 */
export class BlitzService {
    /** Resolved configuration (all defaults applied). */
    readonly config: ResolvedBlitzConfig;

    /** The underlying NATS connection. */
    readonly nc: NatsConnection;

    /** JetStream publish/subscribe client. */
    readonly js: JetStreamClient;

    /** JetStream management API (streams, consumers). */
    readonly jsm: JetStreamManager;

    /** Key-Value store manager. */
    readonly kvm: Kvm;

    private _closed = false;
    private readonly _listeners: BlitzEventListener[] = [];
    private readonly _runningPipelines = new Map<string, Pipeline>();

    private constructor(
        config: ResolvedBlitzConfig,
        nc: NatsConnection,
        js: JetStreamClient,
        jsm: JetStreamManager,
        kvm: Kvm,
    ) {
        this.config = config;
        this.nc = nc;
        this.js = js;
        this.jsm = jsm;
        this.kvm = kvm;

        // Subscribe to NATS status events and forward as BlitzEvents.
        this._subscribeToStatus();
    }

    /**
     * Establish a NATS connection and initialize JetStream/KV handles.
     *
     * @throws if the connection cannot be established within `config.connectTimeoutMs`.
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
        const jsm = await jetstreamManager(nc);
        const kvm = new Kvm(nc);

        return new BlitzService(resolved, nc, js, jsm, kvm);
    }

    /**
     * Returns true if this service has been shut down.
     */
    get isClosed(): boolean {
        return this._closed;
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
