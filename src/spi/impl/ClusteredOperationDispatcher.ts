/**
 * Block B.6 — Clustered Operation Dispatcher
 *
 * Port of {@code com.hazelcast.spi.impl.operationservice.impl.OperationServiceImpl}
 * (routing logic only).
 *
 * ALL distributed operations go through this dispatcher. Protocol handlers are
 * thin: decode request → call dispatcher → encode response.
 *
 * Routing rules:
 *   1. Partition-bound ops → look up partition owner via partition table.
 *      - If owner is self: run locally.
 *      - If owner is remote: forward via inter-member transport.
 *   2. Target-bound ops (specific member UUID) → route to that member.
 *   3. Fan-out ops (MapSize, MapClear, etc.) → dispatch to ALL partition owners
 *      and merge results.
 *
 * Error semantics:
 *   - WrongTargetException → caller must retry against correct owner.
 *   - MemberLeftException → caller must retry after topology stabilizes.
 *   - BackpressureRejectException → caller should back off.
 *
 * Lifecycle: start() → active → stop().
 */

import type { Address } from '@zenystx/helios-core/cluster/Address.js';
import type { Member } from '@zenystx/helios-core/cluster/Member.js';
import { TargetNotMemberException, WrongTargetException } from '@zenystx/helios-core/core/errors/ClusterErrors.js';
import type { ILogger } from '@zenystx/helios-core/logging/Logger.js';
import type { InvocationFuture } from '@zenystx/helios-core/spi/impl/operationservice/InvocationFuture.js';
import { InvocationFuture as InvocationFutureImpl } from '@zenystx/helios-core/spi/impl/operationservice/InvocationFuture.js';
import type { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation.js';

// ── Operation types ───────────────────────────────────────────────────────────

/**
 * Tag for partition-bound operations. The dispatcher routes them to the
 * current partition owner.
 */
export interface PartitionBoundOperation {
    readonly partitionId: number;
    readonly serviceName: string;
}

/**
 * Tag for target-bound operations. Routed to a specific member UUID.
 */
export interface TargetBoundOperation {
    readonly targetMemberUuid: string;
    readonly serviceName: string;
}

/**
 * Tag for fan-out operations. Dispatched to all partition owners; results merged.
 */
export interface FanOutOperation {
    readonly serviceName: string;
    /** Merge N results from partition owners into one. */
    merge(results: unknown[]): unknown;
}

/** Distinguishes the routing kind. */
export type OperationRouting =
    | { kind: 'partition'; partitionId: number }
    | { kind: 'target'; memberUuid: string }
    | { kind: 'fanout' };

// ── Transport abstraction ─────────────────────────────────────────────────────

/**
 * Abstraction over the inter-member transport layer.
 * Implemented by the TCP cluster transport or test doubles.
 */
export interface ClusterTransport {
    /**
     * Send an operation to a remote member and return a future for its result.
     *
     * @param op         The operation to send.
     * @param target     The member to send to.
     * @returns          A future that resolves with the remote result.
     */
    invokeRemote<T>(op: Operation, target: Member): InvocationFuture<T>;

    /**
     * Execute an operation locally and return a future for its result.
     *
     * @param op   The operation to run locally.
     * @returns    A future that resolves with the local result.
     */
    invokeLocal<T>(op: Operation): InvocationFuture<T>;
}

/**
 * Provides the current cluster topology (member list + partition ownership).
 */
export interface ClusterTopologyView {
    /** Returns the local member. */
    getLocalMember(): Member;

    /** Returns all non-local members. */
    getRemoteMembers(): Member[];

    /** Returns all members (local + remote). */
    getAllMembers(): Member[];

    /**
     * Returns the current owner member for a partition.
     * Returns null if the partition is unassigned.
     */
    getPartitionOwner(partitionId: number): Member | null;

    /** Returns the total number of partitions. */
    getPartitionCount(): number;
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

export interface ClusteredOperationDispatcherOptions {
    logger?: ILogger;
}

export class ClusteredOperationDispatcher {
    private readonly _transport: ClusterTransport;
    private readonly _topology: ClusterTopologyView;
    private readonly _logger: ILogger | null;

    private _running = false;

    constructor(
        transport: ClusterTransport,
        topology: ClusterTopologyView,
        options?: ClusteredOperationDispatcherOptions,
    ) {
        this._transport = transport;
        this._topology = topology;
        this._logger = options?.logger ?? null;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    start(): void {
        this._running = true;
    }

    stop(): void {
        this._running = false;
    }

    // ── Core dispatch ─────────────────────────────────────────────────────────

    /**
     * Dispatch an operation with explicit routing metadata.
     *
     * @param op      The operation to dispatch.
     * @param routing Routing instruction (partition / target / fanout).
     * @returns       A future resolving with the operation result.
     */
    dispatch<T>(op: Operation, routing: OperationRouting): InvocationFuture<T> {
        if (!this._running) {
            const future = new InvocationFutureImpl<T>();
            future.completeExceptionally(new Error('ClusteredOperationDispatcher is not running'));
            return future;
        }

        switch (routing.kind) {
            case 'partition':
                return this._dispatchToPartition<T>(op, routing.partitionId);
            case 'target':
                return this._dispatchToTarget<T>(op, routing.memberUuid);
            case 'fanout':
                return this._dispatchFanOut<T>(op);
        }
    }

    /**
     * Dispatch a partition-bound operation.
     * Looks up the current partition owner and routes accordingly.
     *
     * @param op          The operation to dispatch.
     * @param partitionId The target partition.
     */
    dispatchToPartition<T>(op: Operation, partitionId: number): InvocationFuture<T> {
        return this._dispatchToPartition<T>(op, partitionId);
    }

    /**
     * Dispatch a target-bound operation to a specific member UUID.
     *
     * @param op         The operation to dispatch.
     * @param memberUuid UUID of the target member.
     */
    dispatchToMember<T>(op: Operation, memberUuid: string): InvocationFuture<T> {
        return this._dispatchToTarget<T>(op, memberUuid);
    }

    /**
     * Fan-out: dispatch an operation to all partition owners and merge results.
     *
     * Used for operations like MapSize and MapClear that must aggregate
     * data from all partitions.
     *
     * @param op  The fan-out operation (must implement FanOutOperation).
     */
    dispatchFanOut<T>(op: Operation): InvocationFuture<T> {
        return this._dispatchFanOut<T>(op);
    }

    // ── Internal routing ──────────────────────────────────────────────────────

    private _dispatchToPartition<T>(op: Operation, partitionId: number): InvocationFuture<T> {
        const owner = this._topology.getPartitionOwner(partitionId);
        if (owner === null) {
            const future = new InvocationFutureImpl<T>();
            future.completeExceptionally(
                new WrongTargetException(partitionId, null),
            );
            return future;
        }

        const local = this._topology.getLocalMember();
        if (owner.getUuid() === local.getUuid()) {
            // Local execution
            return this._transport.invokeLocal<T>(op);
        }

        // Remote execution
        return this._transport.invokeRemote<T>(op, owner);
    }

    private _dispatchToTarget<T>(op: Operation, memberUuid: string): InvocationFuture<T> {
        const local = this._topology.getLocalMember();
        if (memberUuid === local.getUuid()) {
            return this._transport.invokeLocal<T>(op);
        }

        const remote = this._topology.getRemoteMembers().find(m => m.getUuid() === memberUuid);
        if (remote === undefined) {
            const future = new InvocationFutureImpl<T>();
            future.completeExceptionally(
                new TargetNotMemberException(memberUuid),
            );
            return future;
        }

        return this._transport.invokeRemote<T>(op, remote);
    }

    private _dispatchFanOut<T>(op: Operation): InvocationFuture<T> {
        const fanOp = op as unknown as FanOutOperation;
        const partitionCount = this._topology.getPartitionCount();
        const local = this._topology.getLocalMember();

        // Group partitions by owner to avoid sending multiple messages to the same member
        const ownerToPartitions = new Map<string, { member: Member; partitions: number[] }>();

        for (let pid = 0; pid < partitionCount; pid++) {
            const owner = this._topology.getPartitionOwner(pid);
            if (owner === null) continue;

            const uuid = owner.getUuid();
            let entry = ownerToPartitions.get(uuid);
            if (entry === undefined) {
                entry = { member: owner, partitions: [] };
                ownerToPartitions.set(uuid, entry);
            }
            entry.partitions.push(pid);
        }

        const futures: Promise<unknown>[] = [];

        for (const { member, partitions } of ownerToPartitions.values()) {
            const isLocal = member.getUuid() === local.getUuid();

            if (isLocal) {
                const partFuture = this._transport.invokeLocal<unknown>(op);
                futures.push(partFuture.get());
            } else {
                const partFuture = this._transport.invokeRemote<unknown>(op, member);
                futures.push(partFuture.get());
            }

            // Log which partitions went to which member (at fine level)
            if (this._logger !== null && this._logger.isFineEnabled()) {
                this._logger.fine(
                    `[ClusteredOperationDispatcher] Fan-out: ${partitions.length} partition(s) → ${member.getUuid()} ` +
                    `(${isLocal ? 'local' : 'remote'})`,
                );
            }
        }

        const result = new InvocationFutureImpl<T>();

        Promise.all(futures)
            .then((results) => {
                if (typeof (fanOp as FanOutOperation).merge === 'function') {
                    const merged = (fanOp as FanOutOperation).merge(results);
                    result.complete(merged as T);
                } else {
                    // Default merge: return results array
                    result.complete(results as unknown as T);
                }
            })
            .catch((err) => {
                result.completeExceptionally(err instanceof Error ? err : new Error(String(err)));
            });

        return result;
    }

    // ── Topology helpers ──────────────────────────────────────────────────────

    /**
     * Validate that a partition-bound operation is arriving at the correct owner.
     * Throws WrongTargetException if this node is NOT the owner.
     *
     * Call this at the top of every partition-bound operation handler.
     *
     * @param partitionId The claimed partition.
     * @throws WrongTargetException if local node is not the owner.
     */
    validatePartitionOwnership(partitionId: number): void {
        const owner = this._topology.getPartitionOwner(partitionId);
        const local = this._topology.getLocalMember();

        if (owner === null || owner.getUuid() !== local.getUuid()) {
            throw new WrongTargetException(partitionId, owner?.getUuid() ?? null);
        }
    }

    /**
     * Returns the local member's address (convenience accessor).
     */
    getLocalAddress(): Address {
        return this._topology.getLocalMember().getAddress();
    }
}
