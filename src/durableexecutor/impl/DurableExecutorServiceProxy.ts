/**
 * Caller-facing proxy for the durable executor service.
 *
 * Routes submissions to the correct partition using partition hashing on the
 * callable data. Provides convenience wrappers for result retrieval and disposal.
 *
 * Matches Hazelcast IDurableExecutorService semantics:
 *  - submit()               → hash callable bytes for partition
 *  - submitToKeyOwner()     → hash key bytes for partition
 *  - retrieveResult()       → await stored result by sequence
 *  - dispose()              → remove stored result
 *  - retrieveAndDispose()   → atomic retrieve + remove
 *
 * Port of com.hazelcast.durableexecutor.impl.DurableExecutorServiceProxy.
 */

import type { DurableExecutorService } from '@zenystx/helios-core/durableexecutor/impl/DurableExecutorService.js';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data.js';
import type { NodeEngine } from '@zenystx/helios-core/spi/NodeEngine.js';

export class DurableExecutorServiceProxy {
    private readonly _name: string;
    private readonly _service: DurableExecutorService;
    private readonly _nodeEngine: NodeEngine;
    private _shutdown = false;

    constructor(name: string, service: DurableExecutorService, nodeEngine: NodeEngine) {
        this._name = name;
        this._service = service;
        this._nodeEngine = nodeEngine;
    }

    getName(): string {
        return this._name;
    }

    /**
     * Returns the underlying DurableExecutorService for direct access.
     * Exposed for HeliosInstanceImpl wiring — not part of the public API.
     */
    getService(): DurableExecutorService {
        return this._service;
    }

    // ── Submission ─────────────────────────────────────────────────────────────

    /**
     * Submit a callable to the partition determined by hashing the callable data.
     *
     * @returns `{ sequence }` — monotonic sequence number for result retrieval.
     */
    submit(callable: Data): { sequence: number } {
        this._checkNotShutdown();
        const partitionId = this._partitionIdForData(callable);
        const sequence = this._service.submitToPartition(partitionId, callable);
        return { sequence };
    }

    /**
     * Submit a callable to the owner of the partition that owns the given key.
     *
     * @returns `{ sequence }` — monotonic sequence number for result retrieval.
     */
    submitToKeyOwner(callable: Data, key: Data): { sequence: number } {
        this._checkNotShutdown();
        const partitionId = this._partitionIdForData(key);
        const sequence = this._service.submitToPartition(partitionId, callable);
        return { sequence };
    }

    // ── Result access ──────────────────────────────────────────────────────────

    /**
     * Retrieve the stored result for the given sequence.
     *
     * The sequence encodes the partition: `partitionId = sequence % partitionCount`.
     *
     * Returns `{ completed: false, result: null }` while the task is in-flight.
     * Returns `{ completed: true, result: Data | null }` once the task finishes.
     */
    retrieveResult(sequence: number): { completed: boolean; result: Data | null } {
        const partitionId = this._partitionForSequence(sequence);
        return this._service.retrieveResult(partitionId, sequence);
    }

    /**
     * Remove the stored result for the given sequence.
     *
     * Must be called after retrieving a result to free the ringbuffer slot.
     */
    dispose(sequence: number): void {
        const partitionId = this._partitionForSequence(sequence);
        this._service.disposeResult(partitionId, sequence);
    }

    /**
     * Atomically retrieve and remove the stored result.
     */
    retrieveAndDispose(sequence: number): { completed: boolean; result: Data | null } {
        const partitionId = this._partitionForSequence(sequence);
        return this._service.retrieveAndDisposeResult(partitionId, sequence);
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────────

    /**
     * Shut down this proxy.
     *
     * Shuts down all partitions owned by this proxy's service instance.
     * Any pending submissions will be rejected on the next attempt.
     */
    shutdown(): void {
        this._shutdown = true;
        this._service.shutdownAll();
    }

    isShutdown(): boolean {
        return this._shutdown || this._service.isFullyShutdown();
    }

    // ── Private helpers ────────────────────────────────────────────────────────

    private _checkNotShutdown(): void {
        if (this._shutdown) {
            throw new Error(`DurableExecutor "${this._name}" is shut down`);
        }
    }

    private _partitionIdForData(data: Data): number {
        const ps = this._nodeEngine.getPartitionService();
        return ps.getPartitionId(data);
    }

    /**
     * Recover the partitionId from a sequence number.
     *
     * The durable executor protocol encodes partition as `sequence % partitionCount`.
     * Hazelcast uses 271 partitions by default.
     */
    private _partitionForSequence(sequence: number): number {
        const partitionCount = this._nodeEngine.getPartitionService().getPartitionCount();
        const pid = sequence % partitionCount;
        return pid < 0 ? pid + partitionCount : pid;
    }
}
