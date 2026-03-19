/**
 * WAN batch publisher — drains the event queue and ships batches to
 * the target cluster over a direct TCP connection.
 *
 * Uses Bun.connect() to establish persistent TCP connections to each
 * configured target endpoint, with automatic reconnection on failure.
 */
import { WanAcknowledgeType, type WanBatchPublisherConfig } from '@zenystx/helios-core/config/WanReplicationConfig.js';
import type { WanReplicationEventBatchMsg } from '@zenystx/helios-core/cluster/tcp/ClusterMessage.js';
import type { WanReplicationEvent } from '@zenystx/helios-core/wan/WanReplicationEvent.js';
import { WanReplicationEventQueue } from '@zenystx/helios-core/wan/impl/WanReplicationEventQueue.js';

// ── WanPublisherState ─────────────────────────────────────────────────────────

export enum WanPublisherState {
    /** Publisher is active and replicating events to the target cluster. */
    REPLICATING = 'REPLICATING',
    /** Publisher is paused — events are queued but not sent. */
    PAUSED = 'PAUSED',
    /** Publisher has been stopped and will not send any more events. */
    STOPPED = 'STOPPED',
}

// ── Wire protocol helpers ─────────────────────────────────────────────────────

/**
 * Encode a ClusterMessage to its wire format:
 * [4-byte BE uint32: payload length][JSON payload bytes]
 */
function encodeMessage(msg: unknown): Buffer {
    const json = JSON.stringify(msg, (_key, value) => {
        // Serialize Buffer as base64 string for JSON transport
        if (Buffer.isBuffer(value)) {
            return { __type: 'Buffer', data: value.toString('base64') };
        }
        return value;
    });
    const payload = Buffer.from(json, 'utf8');
    const frame = Buffer.allocUnsafe(4 + payload.length);
    frame.writeUInt32BE(payload.length, 0);
    payload.copy(frame, 4);
    return frame;
}

/**
 * Parse a 4-byte-length-prefixed frame from an accumulated receive buffer.
 * Returns [parsed message, remaining buffer] or [null, original buffer] if
 * more data is needed.
 */
function tryDecodeMessage(buf: Buffer): [unknown, Buffer] | [null, Buffer] {
    if (buf.length < 4) return [null, buf];
    const length = buf.readUInt32BE(0);
    if (buf.length < 4 + length) return [null, buf];
    const payload = buf.subarray(4, 4 + length);
    const remaining = buf.subarray(4 + length);
    const msg = JSON.parse(payload.toString('utf8'), (_key, value) => {
        if (value !== null && typeof value === 'object' && value.__type === 'Buffer') {
            return Buffer.from(value.data, 'base64');
        }
        return value;
    }) as unknown;
    return [msg, remaining];
}

// ── WanBatchPublisher ─────────────────────────────────────────────────────────

export class WanBatchPublisher {
    readonly eventQueue: WanReplicationEventQueue;

    private _state: WanPublisherState = WanPublisherState.STOPPED;
    private readonly _config: WanBatchPublisherConfig;
    private readonly _sourceClusterName: string;

    /** Current active socket to target; null when disconnected. */
    private _socket: import('bun').Socket | null = null;
    /** Reconnect attempt index for exponential backoff. */
    private _reconnectAttempt = 0;
    private _reconnectHandle: ReturnType<typeof setTimeout> | null = null;

    /** Drain timer handle. */
    private _drainHandle: ReturnType<typeof setInterval> | null = null;

    /** Pending ACKs awaiting resolution: batchId → { resolve, reject, timer }. */
    private readonly _pendingAcks = new Map<string, {
        resolve: () => void;
        reject: (err: Error) => void;
        timer: ReturnType<typeof setTimeout>;
    }>();

    /** Receive buffer for framing incoming ACK responses. */
    private _recvBuf: Buffer = Buffer.alloc(0);

    constructor(config: WanBatchPublisherConfig, sourceClusterName: string) {
        this._config = config;
        this._sourceClusterName = sourceClusterName;
        this.eventQueue = new WanReplicationEventQueue(
            config.getQueueCapacity(),
            config.getQueueFullBehavior(),
        );
    }

    getState(): WanPublisherState {
        return this._state;
    }

    /**
     * Enqueue a WAN replication event. Silently drops if queue is full and
     * behavior is DISCARD. Throws if behavior demands it.
     */
    publishEvent(event: WanReplicationEvent): void {
        if (this._state === WanPublisherState.STOPPED) {
            return;
        }
        this.eventQueue.offer(event);
    }

    /**
     * Start the publisher: connect to the target cluster and schedule
     * the periodic drain timer.
     */
    start(): void {
        if (this._state !== WanPublisherState.STOPPED) {
            return;
        }
        this._state = WanPublisherState.REPLICATING;
        this.eventQueue.setPublisherActive(false);
        void this._connectToTarget();
        this._scheduleDrainTimer();
    }

    /**
     * Pause replication. Events are still queued but not sent.
     */
    pause(): void {
        if (this._state === WanPublisherState.REPLICATING) {
            this._state = WanPublisherState.PAUSED;
            this.eventQueue.setPublisherActive(false);
        }
    }

    /**
     * Resume a paused publisher.
     */
    resume(): void {
        if (this._state === WanPublisherState.PAUSED) {
            this._state = WanPublisherState.REPLICATING;
            if (this._socket !== null) {
                this.eventQueue.setPublisherActive(true);
            }
        }
    }

    /**
     * Stop the publisher, cancel timers, and close the TCP connection.
     */
    stop(): void {
        this._state = WanPublisherState.STOPPED;
        this.eventQueue.setPublisherActive(false);
        if (this._drainHandle !== null) {
            clearInterval(this._drainHandle);
            this._drainHandle = null;
        }
        if (this._reconnectHandle !== null) {
            clearTimeout(this._reconnectHandle);
            this._reconnectHandle = null;
        }
        if (this._socket !== null) {
            this._socket.end();
            this._socket = null;
        }
        // Reject all pending ACKs
        for (const [batchId, pending] of this._pendingAcks) {
            clearTimeout(pending.timer);
            pending.reject(new Error(`WAN publisher stopped (batchId=${batchId})`));
        }
        this._pendingAcks.clear();
    }

    /**
     * Drain the event queue and send accumulated events as a batch to the target.
     * Called by the internal timer and can also be triggered externally for testing.
     */
    async drainAndSend(): Promise<void> {
        if (this._state !== WanPublisherState.REPLICATING || this._socket === null) {
            return;
        }
        const events = this.eventQueue.drainTo(this._config.getBatchSize());
        if (events.length === 0) {
            return;
        }
        const batchId = `wan-batch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const batchMsg: WanReplicationEventBatchMsg = {
            type: 'WAN_REPLICATION_EVENT_BATCH',
            batchId,
            sourceClusterName: this._sourceClusterName,
            events: events.map((e) => ({
                mapName: e.mapName,
                eventType: e.eventType,
                keyData: e.key,
                valueData: e.value,
                ttl: e.ttl,
            })),
        };

        const frame = encodeMessage(batchMsg);

        if (this._config.getAcknowledgeType() === WanAcknowledgeType.ACK_ON_RECEIPT ||
            this._config.getAcknowledgeType() === WanAcknowledgeType.ACK_ON_OPERATION_COMPLETE) {
            // Send and wait for ACK
            await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => {
                    this._pendingAcks.delete(batchId);
                    reject(new Error(`WAN batch ACK timeout (batchId=${batchId})`));
                }, 10_000);

                this._pendingAcks.set(batchId, { resolve, reject, timer });

                if (this._socket !== null) {
                    this._socket.write(frame);
                } else {
                    clearTimeout(timer);
                    this._pendingAcks.delete(batchId);
                    // Re-enqueue events on disconnect
                    for (const evt of events) {
                        this.eventQueue.offer(evt);
                    }
                    resolve();
                }
            }).catch(() => {
                // On timeout/error, re-enqueue events for retry
                for (const evt of events) {
                    this.eventQueue.offer(evt);
                }
            });
        } else {
            // Fire-and-forget
            if (this._socket !== null) {
                this._socket.write(frame);
            } else {
                for (const evt of events) {
                    this.eventQueue.offer(evt);
                }
            }
        }
    }

    // ── Connection management ─────────────────────────────────────────────────

    private async _connectToTarget(): Promise<void> {
        if (this._state === WanPublisherState.STOPPED) {
            return;
        }
        const endpoints = this._config.getTargetEndpoints();
        if (endpoints.length === 0) {
            return;
        }
        // Round-robin across target endpoints
        const endpoint = endpoints[this._reconnectAttempt % endpoints.length];
        const [host, portStr] = endpoint.includes(':')
            ? endpoint.split(':').length === 2
                ? endpoint.split(':') as [string, string]
                : [endpoint.split(':').slice(0, -1).join(':'), endpoint.split(':').at(-1)!]
            : [endpoint, '5701'];
        const port = parseInt(portStr, 10);

        const publisher = this;
        try {
            const socket = await Bun.connect({
                hostname: host,
                port: isNaN(port) ? 5701 : port,
                socket: {
                    open(sock) {
                        publisher._socket = sock as unknown as import('bun').Socket;
                        publisher._reconnectAttempt = 0;
                        if (publisher._state === WanPublisherState.REPLICATING) {
                            publisher.eventQueue.setPublisherActive(true);
                        }
                    },
                    data(_sock, data) {
                        publisher._onData(data as Buffer);
                    },
                    close() {
                        publisher._socket = null;
                        publisher.eventQueue.setPublisherActive(false);
                        publisher._scheduleReconnect();
                    },
                    error(_sock, error) {
                        publisher._socket = null;
                        publisher.eventQueue.setPublisherActive(false);
                        void error; // suppress unused warning
                        publisher._scheduleReconnect();
                    },
                },
            });
            this._socket = socket as unknown as import('bun').Socket;
        } catch {
            this._scheduleReconnect();
        }
    }

    private _scheduleReconnect(): void {
        if (this._state === WanPublisherState.STOPPED) {
            return;
        }
        if (this._reconnectHandle !== null) {
            return;
        }
        this._reconnectAttempt++;
        // Exponential backoff: 500ms, 1s, 2s, 4s, ... max 30s
        const delayMs = Math.min(500 * Math.pow(2, this._reconnectAttempt - 1), 30_000);
        this._reconnectHandle = setTimeout(() => {
            this._reconnectHandle = null;
            void this._connectToTarget();
        }, delayMs);
    }

    private _scheduleDrainTimer(): void {
        if (this._drainHandle !== null) {
            return;
        }
        const batchMaxDelay = this._config.getBatchMaxDelayMillis();
        this._drainHandle = setInterval(() => {
            void this.drainAndSend();
        }, batchMaxDelay > 0 ? batchMaxDelay : 1000);
    }

    private _onData(data: Buffer): void {
        this._recvBuf = Buffer.concat([this._recvBuf, data]);
        let msg: unknown;
        while (true) {
            const result = tryDecodeMessage(this._recvBuf);
            if (result[0] === null) break;
            [msg, this._recvBuf] = result;
            this._handleIncomingMessage(msg);
        }
    }

    private _handleIncomingMessage(msg: unknown): void {
        if (typeof msg !== 'object' || msg === null) return;
        const typed = msg as { type?: string; batchId?: string; success?: boolean; error?: string };
        if (typed.type === 'WAN_REPLICATION_ACK' && typeof typed.batchId === 'string') {
            const pending = this._pendingAcks.get(typed.batchId);
            if (pending !== undefined) {
                clearTimeout(pending.timer);
                this._pendingAcks.delete(typed.batchId);
                if (typed.success !== false) {
                    pending.resolve();
                } else {
                    pending.reject(new Error(typed.error ?? 'WAN ACK failure'));
                }
            }
        }
    }
}
