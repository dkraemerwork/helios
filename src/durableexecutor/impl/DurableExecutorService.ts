/**
 * Durable Executor Service — WP7.
 *
 * Provides partition-owned task submission with persistent result storage.
 * Unlike the standard executor, tasks are stored in per-partition ringbuffers
 * so results survive member failure. Each submission is assigned a monotonic
 * sequence number that the caller can use to poll for and retrieve the result.
 *
 * Callable execution strategy:
 *   1. Attempt to deserialize as a Helios-registered IdentifiedDataSerializable
 *      using the node engine's serialization service.
 *   2. Attempt to interpret the raw bytes as UTF-8 JSON with a `__taskType` field,
 *      looking up the factory from the node engine's executor container service registry.
 *   3. Fall back to storing a "no executor available" error result.
 *
 * Port of com.hazelcast.durableexecutor.impl.DurableExecutorServiceProxy (server side).
 */

import type { DurableExecutorConfig } from '@zenystx/helios-core/config/DurableExecutorConfig.js';
import { DurableTaskRingbuffer } from '@zenystx/helios-core/durableexecutor/impl/DurableTaskRingbuffer.js';
import { Bits } from '@zenystx/helios-core/internal/nio/Bits.js';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data.js';
import { HeapData } from '@zenystx/helios-core/internal/serialization/impl/HeapData.js';
import type { NodeEngine } from '@zenystx/helios-core/spi/NodeEngine.js';

/** Standard Hazelcast partition count used for sequence encoding. */
const PARTITION_COUNT = 271;

export const DURABLE_EXECUTOR_SERVICE_NAME = 'hz:impl:durableExecutorService';

/** Serialized error sentinel stored in the ringbuffer when execution fails. */
const NO_EXECUTOR_ERROR_PAYLOAD = Buffer.from(
    JSON.stringify({ __durableError: true, message: 'No callable executor available for this task type.' }),
);

export class DurableExecutorService {
    static readonly SERVICE_NAME = DURABLE_EXECUTOR_SERVICE_NAME;

    private readonly _name: string;
    private readonly _config: DurableExecutorConfig;
    private readonly _nodeEngine: NodeEngine;
    /** Per-partition ringbuffers keyed by partitionId. */
    private readonly _partitionRingbuffers = new Map<number, DurableTaskRingbuffer>();
    /** Partitions that have been shut down. */
    private readonly _shutdownPartitions = new Set<number>();

    constructor(name: string, config: DurableExecutorConfig, nodeEngine: NodeEngine) {
        this._name = name;
        this._config = config;
        this._nodeEngine = nodeEngine;
    }

    getName(): string {
        return this._name;
    }

    // ── Core operations ────────────────────────────────────────────────────────

    /**
     * Submit a callable to the ringbuffer for a given partition.
     *
     * The callable is stored immediately. Execution begins asynchronously.
     * Returns a global sequence number that encodes the partitionId:
     *   `globalSequence = partitionId + partitionCount * localRingbufferSequence`
     *
     * This allows callers to recover the partition via `sequence % partitionCount`.
     *
     * @throws Error if the partition has been shut down.
     * @throws RangeError if the partition ringbuffer is full and no completed slot is available.
     */
    submitToPartition(partitionId: number, callableData: Data): number {
        if (this._shutdownPartitions.has(partitionId)) {
            throw new Error(
                `DurableExecutor "${this._name}" partition ${partitionId} has been shut down.`,
            );
        }

        const rb = this._getOrCreateRingbuffer(partitionId);
        const rawBytes = this._extractRawBytes(callableData);
        const localSequence = rb.submit(rawBytes);

        // Encode partition into the global sequence number.
        // `partitionId + partitionCount * localSequence` ensures:
        //   - globalSequence % partitionCount === partitionId
        //   - globalSequence > 0 for all valid inputs (partitionId >= 0, localSequence >= 1)
        const globalSequence = partitionId + PARTITION_COUNT * localSequence;

        // Kick off async execution — never awaited by the caller.
        void this._executeCallable(partitionId, localSequence, rawBytes);

        return globalSequence;
    }

    /**
     * Retrieve the stored result for a previously submitted task.
     *
     * The `globalSequence` was returned by `submitToPartition`. Decode it to
     * recover partitionId and localSequence.
     *
     * Returns `{ completed: false, result: null }` if the task is still running.
     * Returns `{ completed: true, result: <data> }` when done (result may encode an error).
     * Returns `{ completed: false, result: null }` if the sequence is not found in the ring.
     */
    retrieveResult(partitionId: number, globalSequence: number): { completed: boolean; result: Data | null } {
        const rb = this._partitionRingbuffers.get(partitionId);
        if (rb === undefined) return { completed: false, result: null };

        const localSequence = DurableExecutorService._localSequence(globalSequence);
        const record = rb.retrieveResult(localSequence);
        if (record === null) return { completed: false, result: null };
        if (!record.completed) return { completed: false, result: null };

        return {
            completed: true,
            result: record.result !== null ? this._wrapAsData(record.result) : null,
        };
    }

    /**
     * Remove the stored result for the given global sequence without returning it.
     */
    disposeResult(partitionId: number, globalSequence: number): void {
        const rb = this._partitionRingbuffers.get(partitionId);
        rb?.dispose(DurableExecutorService._localSequence(globalSequence));
    }

    /**
     * Atomically retrieve and remove the stored result.
     *
     * More efficient than calling retrieveResult + disposeResult separately.
     */
    retrieveAndDisposeResult(partitionId: number, globalSequence: number): { completed: boolean; result: Data | null } {
        const rb = this._partitionRingbuffers.get(partitionId);
        if (rb === undefined) return { completed: false, result: null };

        const localSequence = DurableExecutorService._localSequence(globalSequence);
        const record = rb.retrieveAndDispose(localSequence);
        if (record === null) return { completed: false, result: null };
        if (!record.completed) return { completed: false, result: null };

        return {
            completed: true,
            result: record.result !== null ? this._wrapAsData(record.result) : null,
        };
    }

    /**
     * Mark a partition as shut down.
     *
     * Further submissions to this partition will be rejected. Existing in-flight
     * tasks complete normally; their results remain in the ringbuffer until
     * retrieved or disposed.
     */
    shutdownPartition(partitionId: number): void {
        this._shutdownPartitions.add(partitionId);
    }

    /**
     * Shut down all partitions for this executor.
     */
    shutdownAll(): void {
        for (const partitionId of this._partitionRingbuffers.keys()) {
            this._shutdownPartitions.add(partitionId);
        }
    }

    isShutdown(partitionId: number): boolean {
        return this._shutdownPartitions.has(partitionId);
    }

    isFullyShutdown(): boolean {
        if (this._partitionRingbuffers.size === 0) return false;
        for (const partitionId of this._partitionRingbuffers.keys()) {
            if (!this._shutdownPartitions.has(partitionId)) return false;
        }
        return true;
    }

    // ── Snapshot / restore (for partition migration) ───────────────────────────

    /**
     * Export a partition ringbuffer snapshot for backup replication.
     */
    getSnapshot(partitionId: number): ReturnType<DurableTaskRingbuffer['getSnapshot']> {
        return this._partitionRingbuffers.get(partitionId)?.getSnapshot() ?? [];
    }

    /**
     * Restore a partition ringbuffer from a snapshot received on ownership transfer.
     */
    restoreFromSnapshot(
        partitionId: number,
        records: ReturnType<DurableTaskRingbuffer['getSnapshot']>,
    ): void {
        const rb = this._getOrCreateRingbuffer(partitionId);
        rb.restoreFromSnapshot(records);
    }

    // ── Private helpers ────────────────────────────────────────────────────────

    private _getOrCreateRingbuffer(partitionId: number): DurableTaskRingbuffer {
        let rb = this._partitionRingbuffers.get(partitionId);
        if (rb === undefined) {
            rb = new DurableTaskRingbuffer(this._config.getCapacity());
            this._partitionRingbuffers.set(partitionId, rb);
        }
        return rb;
    }

    /**
     * Execute a callable asynchronously and store the result in the ringbuffer.
     *
     * Never throws — all errors are captured and stored as error result payloads.
     */
    private async _executeCallable(
        partitionId: number,
        sequence: number,
        callableData: Buffer,
    ): Promise<void> {
        try {
            const resultBuffer = await this._invokeCallable(callableData);
            const rb = this._partitionRingbuffers.get(partitionId);
            rb?.complete(sequence, resultBuffer);
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            const errorPayload = Buffer.from(
                JSON.stringify({ __durableError: true, message: errorMsg }),
            );
            const rb = this._partitionRingbuffers.get(partitionId);
            rb?.complete(sequence, errorPayload);
        }
    }

    /**
     * Attempt to invoke the callable represented by the raw bytes.
     *
     * Strategy (in order):
     *  1. If bytes look like a Hazelcast HeapData frame (≥ 6 bytes, valid type offset),
     *     deserialize via NodeEngine's serialization service and try to call it as a
     *     `call()` method on the deserialized object.
     *  2. Try to parse as UTF-8 JSON. If it has a `__taskType` field, look up the
     *     factory in the NodeEngine's registered services.
     *  3. Store a "no executor available" sentinel result.
     */
    private async _invokeCallable(callableData: Buffer): Promise<Buffer> {
        // ── Strategy 1: deserialize as Helios Data ─────────────────────────────
        if (callableData.length >= HeapData.DATA_OFFSET) {
            const data = new HeapData(callableData);
            const ss = this._nodeEngine.getSerializationService();
            try {
                const obj = ss.toObject(data);
                if (obj !== null && typeof obj === 'object' && typeof (obj as Record<string, unknown>)['call'] === 'function') {
                    const result = await (obj as { call(): unknown })['call']();
                    const json = JSON.stringify(result ?? null);
                    return DurableExecutorService._encodeJsonResult(json);
                }
            } catch {
                // Not a recognized serializable — fall through.
            }
        }

        // ── Strategy 2: UTF-8 JSON with __taskType field ───────────────────────
        try {
            const text = callableData.toString('utf8');
            const parsed = JSON.parse(text) as Record<string, unknown>;
            const taskType = typeof parsed['__taskType'] === 'string' ? parsed['__taskType'] : null;
            if (taskType !== null) {
                // Look up a registered factory via the executor container registry.
                // NodeEngine exposes getServiceOrNull for named services.
                const containerKey = `helios:executor:container:${this._name}`;
                const container = this._nodeEngine.getServiceOrNull<{
                    executeTask(req: {
                        taskUuid: string;
                        taskType: string;
                        registrationFingerprint: string;
                        inputData: Buffer;
                        executorName: string;
                        submitterMemberUuid: string;
                        timeoutMillis: number;
                    }): Promise<{ status: string; resultData: import('@zenystx/helios-core/internal/serialization/Data.js').Data | null; errorMessage: string | null }>;
                }>(containerKey);

                if (container !== null) {
                    const envelope = await container.executeTask({
                        taskUuid: crypto.randomUUID(),
                        taskType,
                        registrationFingerprint: '',
                        inputData: Buffer.from(JSON.stringify(parsed['input'] ?? null)),
                        executorName: this._name,
                        submitterMemberUuid: 'durable',
                        timeoutMillis: 300_000,
                    });

                    if (envelope.status === 'success' && envelope.resultData !== null) {
                        return this._extractRawBytes(envelope.resultData);
                    }
                    if (envelope.status === 'rejected' || envelope.status === 'timeout') {
                        const errorPayload = Buffer.from(
                            JSON.stringify({ __durableError: true, message: envelope.errorMessage ?? 'Task failed' }),
                        );
                        return errorPayload;
                    }
                }
            }
        } catch {
            // Not valid JSON or no matching executor — fall through.
        }

        // ── Strategy 3: No executor available ─────────────────────────────────
        return NO_EXECUTOR_ERROR_PAYLOAD;
    }

    /**
     * Recover the local (per-ringbuffer) sequence from a global sequence number.
     * Inverse of: `globalSequence = partitionId + PARTITION_COUNT * localSequence`
     */
    private static _localSequence(globalSequence: number): number {
        return Math.floor(globalSequence / PARTITION_COUNT);
    }

    /**
     * Extract raw bytes from a Data object for storage in the ringbuffer.
     */
    private _extractRawBytes(data: Data): Buffer {
        const bytes = data.toByteArray();
        if (bytes === null) return Buffer.alloc(0);
        if (bytes instanceof Buffer) return bytes;
        return Buffer.from(bytes);
    }

    /**
     * Wrap raw bytes back into a HeapData for return to the client protocol layer.
     */
    private _wrapAsData(rawBytes: Buffer): Data {
        return new HeapData(rawBytes);
    }

    /**
     * Encode a JSON result string as a HeapData-compatible Buffer.
     * Uses type -130 (JAVASCRIPT_JSON) with a 4-byte length prefix.
     */
    private static _encodeJsonResult(json: string): Buffer {
        const payload = Buffer.from(json, 'utf8');
        const buf = Buffer.alloc(HeapData.DATA_OFFSET + 4 + payload.length);
        Bits.writeIntB(buf, HeapData.PARTITION_HASH_OFFSET, 0);
        Bits.writeIntB(buf, HeapData.TYPE_OFFSET, -130); // JAVASCRIPT_JSON
        Bits.writeIntB(buf, HeapData.DATA_OFFSET, payload.length);
        payload.copy(buf, HeapData.DATA_OFFSET + 4);
        return buf;
    }
}
