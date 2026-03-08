import { jetstream, type JetStreamClient } from '@nats-io/jetstream';
import { type NatsConnection, headers } from '@nats-io/transport-node';
import type { AsyncChannel } from './AsyncChannel.js';
import type { ProcessorItem } from './ProcessorItem.js';
import { EdgeType } from '../PipelineDescriptor.js';
import { ProcessingGuarantee } from '../JobConfig.js';

const BARRIER_HEADER = 'blitz-barrier';
const SNAPSHOT_ID_HEADER = 'blitz-snapshot-id';

export interface DistributedEdgeSenderConfig {
    readonly nc: NatsConnection;
    readonly outbox: AsyncChannel<ProcessorItem>;
    readonly memberSubjects: string[];
    readonly broadcastSubject?: string;
    readonly edgeType: EdgeType;
    readonly processingGuarantee: ProcessingGuarantee;
    readonly streamName?: string;
}

/**
 * Consumes items from a local outbox AsyncChannel, serializes them as JSON,
 * and publishes to NATS subjects based on edge type routing.
 *
 * - DISTRIBUTED_UNICAST: round-robin across member subjects
 * - DISTRIBUTED_PARTITIONED: hash key to select member subject
 * - DISTRIBUTED_BROADCAST: publish to broadcast subject
 * - ALL_TO_ONE: always publish to first member subject
 *
 * Barriers are always broadcast to ALL member subjects regardless of edge type,
 * transmitted with `blitz-barrier` / `blitz-snapshot-id` headers.
 *
 * Uses JetStream publish for AT_LEAST_ONCE / EXACTLY_ONCE guarantees,
 * core NATS publish for NONE.
 */
export class DistributedEdgeSender {
    private readonly _nc: NatsConnection;
    private readonly _outbox: AsyncChannel<ProcessorItem>;
    private readonly _memberSubjects: string[];
    private readonly _broadcastSubject: string | undefined;
    private readonly _edgeType: EdgeType;
    private readonly _isJetStream: boolean;
    private _js: JetStreamClient | null = null;
    private _running = false;
    private _loopPromise: Promise<void> | null = null;
    private _roundRobinIndex = 0;
    private _itemsOut = 0;
    private _bytesOut = 0;

    constructor(config: DistributedEdgeSenderConfig) {
        this._nc = config.nc;
        this._outbox = config.outbox;
        this._memberSubjects = config.memberSubjects;
        this._broadcastSubject = config.broadcastSubject;
        this._edgeType = config.edgeType;
        this._isJetStream = config.processingGuarantee !== ProcessingGuarantee.NONE;

        if (this._isJetStream) {
            this._js = jetstream(this._nc);
        }
    }

    get isJetStream(): boolean {
        return this._isJetStream;
    }

    get itemsOut(): number {
        return this._itemsOut;
    }

    get bytesOut(): number {
        return this._bytesOut;
    }

    start(): void {
        if (this._running) return;
        this._running = true;
        this._loopPromise = this._drainLoop();
    }

    async stop(): Promise<void> {
        this._running = false;
        if (this._loopPromise) {
            await this._loopPromise;
            this._loopPromise = null;
        }
    }

    private async _drainLoop(): Promise<void> {
        while (this._running) {
            let item: ProcessorItem;
            try {
                item = await Promise.race([
                    this._outbox.receive(),
                    new Promise<never>((_, reject) => {
                        const check = (): void => {
                            if (!this._running) {
                                reject(new Error('sender stopped'));
                                return;
                            }
                            setTimeout(check, 50);
                        };
                        setTimeout(check, 50);
                    }),
                ]);
            } catch {
                break;
            }

            if (item.type === 'barrier') {
                await this._publishBarrier(item);
            } else {
                await this._publishData(item);
            }
        }
    }

    private async _publishBarrier(item: ProcessorItem & { type: 'barrier' }): Promise<void> {
        const hdrs = headers();
        hdrs.set(BARRIER_HEADER, 'true');
        hdrs.set(SNAPSHOT_ID_HEADER, item.snapshotId);
        const payload = new TextEncoder().encode(JSON.stringify(item));

        // Barriers are ALWAYS broadcast to all member subjects
        for (const subject of this._memberSubjects) {
            if (this._isJetStream && this._js) {
                await this._js.publish(subject, payload, { headers: hdrs });
            } else {
                this._nc.publish(subject, payload, { headers: hdrs });
            }
        }
        // Barriers count as one logical item out (sent to all members)
        this._itemsOut++;
        this._bytesOut += payload.byteLength;
    }

    private async _publishData(item: ProcessorItem): Promise<void> {
        const payload = new TextEncoder().encode(JSON.stringify(item));
        const subject = this._routeSubject(item);

        if (this._isJetStream && this._js) {
            await this._js.publish(subject, payload);
        } else {
            this._nc.publish(subject, payload);
        }
        this._itemsOut++;
        this._bytesOut += payload.byteLength;
    }

    private _routeSubject(item: ProcessorItem): string {
        switch (this._edgeType) {
            case EdgeType.DISTRIBUTED_UNICAST: {
                const idx = this._roundRobinIndex;
                this._roundRobinIndex = (idx + 1) % this._memberSubjects.length;
                return this._memberSubjects[idx];
            }
            case EdgeType.DISTRIBUTED_PARTITIONED: {
                const key = item.type === 'data' ? (item.key ?? '') : '';
                const hash = this._hashKey(key);
                const idx = Math.abs(hash) % this._memberSubjects.length;
                return this._memberSubjects[idx];
            }
            case EdgeType.DISTRIBUTED_BROADCAST: {
                return this._broadcastSubject ?? this._memberSubjects[0];
            }
            case EdgeType.ALL_TO_ONE: {
                return this._memberSubjects[0];
            }
            default:
                return this._memberSubjects[0];
        }
    }

    private _hashKey(key: string): number {
        let hash = 0;
        for (let i = 0; i < key.length; i++) {
            const ch = key.charCodeAt(i);
            hash = ((hash << 5) - hash + ch) | 0;
        }
        return hash;
    }
}
