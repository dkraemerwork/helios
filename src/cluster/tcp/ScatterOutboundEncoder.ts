import type { ClusterMessage } from '@zenystx/helios-core/cluster/tcp/ClusterMessage';
import { serializeBinaryClusterMessage as serializeBinaryClusterMessageOnMain } from '@zenystx/helios-core/cluster/tcp/BinarySerializationStrategy';
import type { OutboundBatcher } from '@zenystx/helios-core/cluster/tcp/OutboundBatcher';
import type { SpawnContext, ThreadHandle } from '@zenystx/scatterjs';
import { Channel, ChannelClosedError, scatter } from '@zenystx/scatterjs';

declare function serializeBinaryClusterMessage(message: ClusterMessage): Uint8Array;

type ScatterEncodeRequest = {
    message: ClusterMessage;
};

type ScatterWorkerStatus = {
    type: 'failed';
    error: string;
};

type ScatterEncoderChannels = {
    input: ReturnType<typeof Channel.in<ScatterEncodeRequest>>;
    output: ReturnType<typeof Channel.out<Uint8Array>>;
    status: ReturnType<typeof Channel.out<ScatterWorkerStatus>>;
};

export interface ScatterOutboundEncoderOptions {
    inputCapacityBytes?: number;
    outputCapacityBytes?: number;
    serializerImportUrl?: string;
}

const OUTPUT_DRAIN_BATCH_SIZE = 64;
const STATUS_DRAIN_BATCH_SIZE = 4;
const IDLE_POLL_DELAY_MS = 1;

const scatterEncodeRequestCodec = {
    name: 'helios-scatter-encode-request',
    encode(value: ScatterEncodeRequest): Uint8Array {
        const bufferMarker = '__heliosScatterBuffer';
        const dataMarker = '__heliosScatterData';
        return new TextEncoder().encode(JSON.stringify(value.message, (_key: string, currentValue: unknown): unknown => {
            if (Buffer.isBuffer(currentValue)) {
                return { [bufferMarker]: currentValue.toString('base64') };
            }

            if (currentValue !== null && typeof currentValue === 'object' && typeof (currentValue as { toByteArray?: () => Uint8Array | null }).toByteArray === 'function') {
                const bytes = (currentValue as { toByteArray: () => Uint8Array | null }).toByteArray();
                return { [dataMarker]: bytes === null ? null : Buffer.from(bytes).toString('base64') };
            }

            return currentValue;
        }));
    },
    decode(buffer: Uint8Array): ScatterEncodeRequest {
        const bufferMarker = '__heliosScatterBuffer';
        const dataMarker = '__heliosScatterData';
        return {
            message: JSON.parse(new TextDecoder().decode(buffer), (_key: string, currentValue: unknown): unknown => {
                if (currentValue !== null && typeof currentValue === 'object') {
                    const objectValue = currentValue as Record<string, unknown>;
                    if (objectValue.type === 'Buffer' && Array.isArray(objectValue.data)) {
                        return Buffer.from(objectValue.data as number[]);
                    }

                    if (bufferMarker in objectValue) {
                        return Buffer.from(objectValue[bufferMarker] as string, 'base64');
                    }

                    if (dataMarker in objectValue) {
                        const encoded = objectValue[dataMarker] as string | null;
                        if (encoded === null) {
                            return null;
                        }

                        const payload = Buffer.from(encoded, 'base64');
                        return {
                            copyTo(dest: Buffer, destPos: number): void {
                                payload.copy(dest, destPos);
                            },
                            dataSize(): number {
                                return Math.max(payload.length - 8, 0);
                            },
                            getType(): number {
                                return payload.length >= 8 ? payload.readInt32BE(4) : 0;
                            },
                            toByteArray(): Buffer {
                                return payload;
                            },
                            totalSize(): number {
                                return payload.length;
                            },
                        };
                    }
                }

                return currentValue;
            }) as ClusterMessage,
        };
    },
};

export class ScatterOutboundEncoder {
    private readonly _batcher: OutboundBatcher;
    private readonly _worker: ThreadHandle<ScatterEncoderChannels>;
    private readonly _acceptedMessages: ClusterMessage[] = [];
    private _disposed = false;
    private _scatterHealthy = true;
    private _submittedCount = 0;
    private _workerFailure: string | null = null;
    constructor(batcher: OutboundBatcher, options?: ScatterOutboundEncoderOptions) {
        this._batcher = batcher;
        this._worker = scatter.spawn(
            scatterOutboundEncoderWorker,
            {
                channels: {
                    input: Channel.in<ScatterEncodeRequest>({
                        codec: scatterEncodeRequestCodec,
                        capacity: options?.inputCapacityBytes,
                    }),
                    output: Channel.out<Uint8Array>({
                        codec: 'raw',
                        capacity: options?.outputCapacityBytes,
                    }),
                    status: Channel.out<ScatterWorkerStatus>({
                        codec: 'json',
                    }),
                },
                imports: [
                    `import { serializeBinaryClusterMessage } from '${options?.serializerImportUrl ?? new URL('./BinarySerializationStrategy.ts', import.meta.url).href}';`,
                ],
            },
        );
        void this._monitorWorker();
    }

    enqueue(message: ClusterMessage): boolean {
        if (this._disposed) {
            return false;
        }

        if (!this._scatterHealthy) {
            return this._enqueueSynchronously(message);
        }

        this._acceptedMessages.push(message);
        this._pumpInput();
        return !this._disposed;
    }

    dispose(): void {
        if (this._disposed) {
            return;
        }

        this._disposed = true;
        this._acceptedMessages.length = 0;
        this._submittedCount = 0;
        this._worker.terminate();
    }

    private _pumpInput(): void {
        if (this._disposed || !this._scatterHealthy) {
            return;
        }

        while (this._submittedCount < this._acceptedMessages.length) {
            if (!this._worker.alive) {
                this._workerFailure = this._workerFailure ?? 'scatter worker exited before finishing accepted outbound sends';
                return;
            }

            try {
                if (!this._worker.channels.input.tryWrite({ message: this._acceptedMessages[this._submittedCount]! })) {
                    return;
                }
                this._submittedCount += 1;
            } catch (error) {
                if (error instanceof ChannelClosedError) {
                    this._workerFailure = this._workerFailure ?? 'scatter input channel closed before finishing accepted outbound sends';
                    return;
                }
                throw error;
            }
        }
    }

    private async _monitorWorker(): Promise<void> {
        try {
            while (!this._disposed) {
                let madeProgress = false;

                while (true) {
                    const payloads = this._worker.channels.output.readBatch(OUTPUT_DRAIN_BATCH_SIZE);
                    if (payloads.length === 0) {
                        break;
                    }

                    madeProgress = true;
                    for (const payload of payloads) {
                        if (!this._acceptEncodedPayload(payload)) {
                            return;
                        }
                    }
                }

                const statuses = this._worker.channels.status.readBatch(STATUS_DRAIN_BATCH_SIZE);
                if (statuses.length > 0) {
                    madeProgress = true;
                    for (const status of statuses) {
                        if (status.type === 'failed') {
                            this._workerFailure = status.error;
                        }
                    }
                }

                this._pumpInput();

                if ((this._workerFailure !== null && this._worker.channels.output.closed) || !this._worker.alive) {
                    this._failOverToSynchronousEncoding();
                    return;
                }

                if (!madeProgress) {
                    await Bun.sleep(IDLE_POLL_DELAY_MS);
                }
            }
        } finally {
            await this._drainWorker();
        }
    }

    private _acceptEncodedPayload(payload: Uint8Array): boolean {
        if (this._acceptedMessages.length === 0) {
            return !this._disposed;
        }

        if (!this._batcher.enqueue(payload)) {
            this.dispose();
            return false;
        }

        this._acceptedMessages.shift();
        this._submittedCount = Math.max(0, this._submittedCount - 1);
        return true;
    }

    private _failOverToSynchronousEncoding(): void {
        if (this._disposed || !this._scatterHealthy) {
            return;
        }

        this._scatterHealthy = false;
        while (!this._disposed && this._acceptedMessages.length > 0) {
            const message = this._acceptedMessages.shift()!;
            this._submittedCount = Math.max(0, this._submittedCount - 1);
            let payload: Uint8Array;
            try {
                payload = serializeBinaryClusterMessageOnMain(message);
            } catch {
                this.dispose();
                return;
            }

            if (!this._enqueuePayload(payload)) {
                return;
            }
        }
    }

    private _enqueueSynchronously(message: ClusterMessage): boolean {
        try {
            return this._enqueuePayload(serializeBinaryClusterMessageOnMain(message));
        } catch {
            this.dispose();
            return false;
        }
    }

    private _enqueuePayload(payload: Uint8Array): boolean {
        if (!this._batcher.enqueue(payload)) {
            this.dispose();
            return false;
        }
        return true;
    }

    private async _drainWorker(): Promise<void> {
        try {
            await this._worker.shutdown();
        } catch {
            this._worker.terminate();
        }
    }
}

async function scatterOutboundEncoderWorker(ctx: SpawnContext<ScatterEncoderChannels>): Promise<void> {
    const input = ctx.channel('input');
    const output = ctx.channel('output');
    const status = ctx.channel('status');

    try {
        while (true) {
            const request = input.readBlocking();
            if (request === null) {
                break;
            }

            const payload = serializeBinaryClusterMessage(request.message);
            output.writeBlocking(payload);
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        status.writeBlocking({
            type: 'failed',
            error: `scatter outbound encoding failed: ${message}`,
        });
    } finally {
        output.close();
        status.close();
    }
}
