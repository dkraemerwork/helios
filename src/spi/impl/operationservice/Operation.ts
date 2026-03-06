/**
 * Port of {@code com.hazelcast.spi.impl.operationservice.Operation}.
 *
 * Abstract base class for all distributed operations in Helios.
 * In single-node in-process mode, operations execute locally via OperationServiceImpl.
 *
 * Java uses VarHandle for thread-safe callId management; TypeScript uses plain fields
 * since Bun is single-threaded.
 */
import type { NodeEngine } from '@zenystx/core/spi/NodeEngine';

/** Partition ID for generic (non-partition-specific) operations. */
export const GENERIC_PARTITION_ID = -1;

/**
 * Handler invoked by an Operation to send its response back to the caller.
 */
export interface ResponseHandler {
    sendResponse(op: Operation, response: unknown): void;
}

export abstract class Operation {
    static readonly GENERIC_PARTITION_ID: number = GENERIC_PARTITION_ID;

    /** Service that owns this operation. */
    serviceName: string = '';

    /** Target partition. -1 means generic (no partition affinity). */
    partitionId: number = GENERIC_PARTITION_ID;

    /** Replica index for backup operations. */
    replicaIndex: number = 0;

    /** Timestamp when the invocation was submitted (ms since epoch). */
    invocationTime: number = -1;

    /** Call timeout in milliseconds. -1 = use default. */
    callTimeout: number = -1;

    /** Unique call ID assigned by OperationService. 0 = not yet active. */
    private _callId: bigint = 0n;

    /** Injected by OperationService before run(). */
    private _nodeEngine: NodeEngine | null = null;

    /** Injected by OperationService; receives the operation result. */
    private _responseHandler: ResponseHandler | null = null;

    // ── lifecycle ──────────────────────────────────────────────────────────

    /**
     * Execute the operation's logic.
     * Implementations should call sendResponse(result) when done.
     */
    abstract run(): Promise<void>;

    /** Optional pre-run hook. Default: no-op. */
    beforeRun(): Promise<void> {
        return Promise.resolve();
    }

    /** True when the operation has been submitted (callId assigned). */
    isUrgent(): boolean { return false; }

    // ── callId management ─────────────────────────────────────────────────

    getCallId(): bigint { return this._callId; }

    /**
     * Assign a call ID, marking the operation as active.
     * @throws Error if callId <= 0 or operation is already active.
     */
    setCallId(callId: bigint): void {
        if (callId <= 0n) {
            throw new Error(`callId must be positive, got: ${callId}`);
        }
        if (this._callId !== 0n) {
            throw new Error(`Operation is already active (callId=${this._callId}); cannot re-assign callId=${callId}`);
        }
        this._callId = callId;
    }

    /** True if a callId has been assigned (operation is active). */
    isActive(): boolean {
        return this._callId !== 0n;
    }

    /**
     * Reset callId to 0 (mark operation as inactive).
     * Safe to call even when already inactive.
     */
    deactivate(): void {
        this._callId = 0n;
    }

    // ── injection ─────────────────────────────────────────────────────────

    getNodeEngine(): NodeEngine | null { return this._nodeEngine; }
    setNodeEngine(nodeEngine: NodeEngine): void { this._nodeEngine = nodeEngine; }

    getResponseHandler(): ResponseHandler | null { return this._responseHandler; }
    setResponseHandler(handler: ResponseHandler | null): void { this._responseHandler = handler; }

    // ── replica index ─────────────────────────────────────────────────────

    /**
     * Set the replica index.
     * @throws Error if replicaIndex < 0.
     */
    setReplicaIndex(replicaIndex: number): void {
        if (replicaIndex < 0) {
            throw new Error(`replicaIndex must be >= 0, got: ${replicaIndex}`);
        }
        this.replicaIndex = replicaIndex;
    }

    // ── response ──────────────────────────────────────────────────────────

    /**
     * Send the operation result back to the caller.
     * Null-safe: does nothing if no response handler is set.
     */
    sendResponse(value: unknown): void {
        if (this._responseHandler === null) return;
        this._responseHandler.sendResponse(this, value);
    }
}
