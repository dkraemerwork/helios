import { jetstream, jetstreamManager, type ConsumerMessages } from '@nats-io/jetstream';
import { type NatsConnection, type Subscription } from '@nats-io/transport-node';
import type { AsyncChannel } from './AsyncChannel.js';
import type { ProcessorItem } from './ProcessorItem.js';
import type { EdgeType } from '../PipelineDescriptor.js';
import { ProcessingGuarantee } from '../JobConfig.js';

const BARRIER_HEADER = 'blitz-barrier';
const SNAPSHOT_ID_HEADER = 'blitz-snapshot-id';

export interface DistributedEdgeReceiverConfig {
    readonly nc: NatsConnection;
    readonly subjects: string[];
    readonly inbox: AsyncChannel<ProcessorItem>;
    readonly edgeType: EdgeType;
    readonly processingGuarantee: ProcessingGuarantee;
    readonly streamName?: string;
}

/**
 * Subscribes to NATS subjects, deserializes items, and pushes them to a local
 * inbox AsyncChannel. Recognizes barrier messages from NATS headers.
 *
 * Uses JetStream consumers for durable edges (AT_LEAST_ONCE / EXACTLY_ONCE)
 * and core NATS subscriptions for fire-and-forget (NONE).
 *
 * When the inbox is full, backpressure propagates naturally — the receiver
 * blocks on `inbox.send()` which pauses consumption from NATS.
 */
export class DistributedEdgeReceiver {
    private readonly _nc: NatsConnection;
    private readonly _subjects: string[];
    private readonly _inbox: AsyncChannel<ProcessorItem>;
    private readonly _isJetStream: boolean;
    private readonly _streamName: string | undefined;
    private _subscriptions: Subscription[] = [];
    private _jsConsumer: ConsumerMessages | null = null;
    private _running = false;
    private _loopPromises: Promise<void>[] = [];

    constructor(config: DistributedEdgeReceiverConfig) {
        this._nc = config.nc;
        this._subjects = config.subjects;
        this._inbox = config.inbox;
        this._isJetStream = config.processingGuarantee !== ProcessingGuarantee.NONE;
        this._streamName = config.streamName;
    }

    get isJetStream(): boolean {
        return this._isJetStream;
    }

    async start(): Promise<void> {
        if (this._running) return;
        this._running = true;

        if (this._isJetStream) {
            await this._startJetStream();
        } else {
            this._startCoreNats();
        }
    }

    async stop(): Promise<void> {
        this._running = false;

        for (const sub of this._subscriptions) {
            sub.unsubscribe();
        }
        this._subscriptions = [];

        if (this._jsConsumer) {
            this._jsConsumer.stop();
            this._jsConsumer = null;
        }

        await Promise.allSettled(this._loopPromises);
        this._loopPromises = [];
    }

    private _startCoreNats(): void {
        for (const subject of this._subjects) {
            const sub = this._nc.subscribe(subject);
            this._subscriptions.push(sub);

            const loop = (async (): Promise<void> => {
                for await (const msg of sub) {
                    if (!this._running) break;

                    const item = this._decodeMessage(msg.data, msg.headers);
                    await this._inbox.send(item);
                }
            })();
            this._loopPromises.push(loop);
        }
    }

    private async _startJetStream(): Promise<void> {
        const jsm = await jetstreamManager(this._nc);
        const streamName = this._streamName!;

        // Ensure stream exists
        try {
            await jsm.streams.info(streamName);
        } catch {
            await jsm.streams.add({
                name: streamName,
                subjects: this._subjects,
            });
        }

        const js = jetstream(this._nc);
        const consumerName = `${streamName}-recv-${crypto.randomUUID().slice(0, 8)}`;

        await jsm.consumers.add(streamName, {
            durable_name: consumerName,
            filter_subjects: this._subjects.length > 1 ? this._subjects : undefined,
            filter_subject: this._subjects.length === 1 ? this._subjects[0] : undefined,
        });
        const consumer = await js.consumers.get(streamName, consumerName);

        const messages = await consumer.consume();
        this._jsConsumer = messages;

        const loop = (async (): Promise<void> => {
            for await (const msg of messages) {
                if (!this._running) break;

                const item = this._decodeMessage(msg.data, msg.headers);
                await this._inbox.send(item);
                msg.ack();
            }
        })();
        this._loopPromises.push(loop);
    }

    private _decodeMessage(data: Uint8Array, hdrs?: { get(key: string): string }): ProcessorItem {
        // Check for barrier via headers
        if (hdrs) {
            const isBarrier = hdrs.get(BARRIER_HEADER);
            if (isBarrier === 'true') {
                const snapshotId = hdrs.get(SNAPSHOT_ID_HEADER) ?? '';
                return { type: 'barrier', snapshotId };
            }
        }

        // Deserialize JSON payload
        const json = new TextDecoder().decode(data);
        return JSON.parse(json) as ProcessorItem;
    }
}
