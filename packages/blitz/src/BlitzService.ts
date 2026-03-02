import { connect, type NatsConnection } from '@nats-io/transport-node';
import { jetstream, jetstreamManager, type JetStreamClient, type JetStreamManager } from '@nats-io/jetstream';
import { Kvm, type KvManager } from '@nats-io/kv';
import { type BlitzConfig, resolveBlitzConfig, type ResolvedBlitzConfig } from './BlitzConfig.ts';

/**
 * BlitzService — top-level entry point for the Helios Blitz stream processing engine.
 *
 * Owns the NATS connection lifecycle: connect, expose JetStream/KV handles, shutdown.
 *
 * Usage:
 * ```typescript
 * const blitz = await BlitzService.connect({ servers: 'nats://localhost:4222' });
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
    readonly kvm: KvManager;

    private _closed = false;

    private constructor(
        config: ResolvedBlitzConfig,
        nc: NatsConnection,
        js: JetStreamClient,
        jsm: JetStreamManager,
        kvm: KvManager,
    ) {
        this.config = config;
        this.nc = nc;
        this.js = js;
        this.jsm = jsm;
        this.kvm = kvm;
    }

    /**
     * Establish a NATS connection and initialize JetStream/KV handles.
     *
     * @throws if the connection cannot be established within `config.connectTimeoutMs`.
     */
    static async connect(config: BlitzConfig): Promise<BlitzService> {
        const resolved = resolveBlitzConfig(config);

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
}
