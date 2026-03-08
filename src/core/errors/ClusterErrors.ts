/**
 * Block B — Cluster Runtime Core
 *
 * Cluster-specific error classes used by the invocation monitor, backpressure,
 * and routing subsystems.
 *
 * All errors follow the Helios pattern: extend HeliosException with a
 * descriptive name so stack traces are identifiable.
 */

import { HeliosException } from '@zenystx/helios-core/core/exception/HeliosException.js';

// ── Invocation errors ────────────────────────────────────────────────────────

/**
 * Thrown when an invocation's target member has left the cluster.
 * Port of com.hazelcast.spi.exception.MemberLeftException.
 */
export class MemberLeftException extends HeliosException {
    readonly memberUuid: string;

    constructor(memberUuid: string, message?: string) {
        super(message ?? `Member ${memberUuid} has left the cluster`);
        this.name = 'MemberLeftException';
        this.memberUuid = memberUuid;
    }
}

/**
 * Thrown when an invocation times out before the target responds.
 * Port of com.hazelcast.core.OperationTimeoutException.
 */
export class InvocationTimeoutException extends HeliosException {
    readonly callId: bigint;
    readonly timeoutMs: number;

    constructor(callId: bigint, timeoutMs: number, message?: string) {
        super(message ?? `Invocation ${callId} timed out after ${timeoutMs}ms`);
        this.name = 'InvocationTimeoutException';
        this.callId = callId;
        this.timeoutMs = timeoutMs;
    }
}

// ── Backpressure errors ──────────────────────────────────────────────────────

/**
 * Thrown when all in-flight slots for a member are exhausted and the REJECT
 * policy is active, or the WAIT timeout expired.
 * Port of com.hazelcast.spi.impl.operationservice.impl.BackpressureRegulator.OverloadError.
 */
export class BackpressureRejectException extends HeliosException {
    readonly memberUuid: string;
    readonly maxConcurrent: number;
    readonly inFlight: number;

    constructor(memberUuid: string, maxConcurrent: number, inFlight: number) {
        super(
            `Backpressure REJECT for member ${memberUuid}: ` +
            `maxConcurrent=${maxConcurrent}, inFlight=${inFlight}`,
        );
        this.name = 'BackpressureRejectException';
        this.memberUuid = memberUuid;
        this.maxConcurrent = maxConcurrent;
        this.inFlight = inFlight;
    }
}

/**
 * Thrown when the WAIT backpressure policy times out waiting for a free slot.
 */
export class BackpressureWaitTimeoutException extends HeliosException {
    readonly memberUuid: string;
    readonly waitMs: number;

    constructor(memberUuid: string, waitMs: number) {
        super(`Backpressure WAIT timeout for member ${memberUuid} after ${waitMs}ms`);
        this.name = 'BackpressureWaitTimeoutException';
        this.memberUuid = memberUuid;
        this.waitMs = waitMs;
    }
}

// ── Routing errors ───────────────────────────────────────────────────────────

/**
 * Sent to a client when their partition-bound operation landed on the wrong owner.
 * The client must retry against the correct owner.
 * Port of com.hazelcast.spi.exception.WrongTargetException.
 */
export class WrongTargetException extends HeliosException {
    readonly partitionId: number;
    readonly expectedOwnerUuid: string | null;

    constructor(partitionId: number, expectedOwnerUuid: string | null = null) {
        super(
            `Wrong target for partition ${partitionId}` +
            (expectedOwnerUuid ? ` (correct owner: ${expectedOwnerUuid})` : ''),
        );
        this.name = 'WrongTargetException';
        this.partitionId = partitionId;
        this.expectedOwnerUuid = expectedOwnerUuid;
    }
}

/**
 * Sent to a client when their operation targeted a member that has since left.
 * The error is retryable: the client must re-connect to the new member topology.
 * Port of com.hazelcast.spi.exception.TargetNotMemberException.
 */
export class TargetNotMemberException extends HeliosException {
    readonly targetAddress: string;

    constructor(targetAddress: string) {
        super(`Target ${targetAddress} is not a cluster member`);
        this.name = 'TargetNotMemberException';
        this.targetAddress = targetAddress;
    }
}

// ── Replica sync errors ──────────────────────────────────────────────────────

/**
 * Thrown when a replica sync request is rejected because it is stale (the sync
 * epoch no longer matches the current cluster epoch, or the request ID is
 * unknown).
 */
export class StaleReplicaSyncException extends HeliosException {
    readonly correlationId: string;

    constructor(correlationId: string, reason: string) {
        super(`Stale replica sync response ${correlationId}: ${reason}`);
        this.name = 'StaleReplicaSyncException';
        this.correlationId = correlationId;
    }
}

/**
 * Thrown when a replica sync response chunk is a duplicate of one already received.
 */
export class DuplicateSyncChunkException extends HeliosException {
    readonly correlationId: string;
    readonly chunkIndex: number;

    constructor(correlationId: string, chunkIndex: number) {
        super(`Duplicate sync chunk ${chunkIndex} for ${correlationId}`);
        this.name = 'DuplicateSyncChunkException';
        this.correlationId = correlationId;
        this.chunkIndex = chunkIndex;
    }
}
