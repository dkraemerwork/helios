/**
 * Port of {@code com.hazelcast.spi.impl.operationservice.impl.Invocation}.
 *
 * Manages the lifecycle of a single operation invocation: registration,
 * target resolution, retry with backoff, backup ack tracking, and timeout.
 */
import type { NodeEngine } from '@helios/spi/NodeEngine';
import type { Invocable } from '@helios/spi/impl/operationservice/InvocationRegistry';
import { InvocationRegistry } from '@helios/spi/impl/operationservice/InvocationRegistry';
import { InvocationFuture } from '@helios/spi/impl/operationservice/InvocationFuture';
import { Operation } from '@helios/spi/impl/operationservice/Operation';
import { RetryableException } from '@helios/spi/impl/operationservice/RetryableException';
import { Address } from '@helios/cluster/Address';

/** First N retries are immediate (no delay). Matches Java MAX_FAST_INVOCATION_COUNT. */
const MAX_FAST_INVOCATION_COUNT = 5;

export interface InvocationOptions {
    tryCount?: number;
    tryPauseMillis?: number;
    callTimeoutMillis?: number;
    backupAckTimeoutMillis?: number;
}

export class Invocation implements Invocable {
    readonly op: Operation;
    readonly future: InvocationFuture<unknown> = new InvocationFuture<unknown>();
    readonly registry: InvocationRegistry;
    readonly nodeEngine: NodeEngine;
    readonly localAddress: Address;

    invokeCount: number = 0;
    readonly tryCount: number;
    readonly tryPauseMillis: number;
    readonly callTimeoutMillis: number;
    readonly backupAckTimeoutMillis: number;

    targetAddress: Address | null = null;

    backupsAcksExpected: number = 0;
    backupsAcksReceived: number = 0;
    pendingResponse: unknown = undefined;
    private _backupTimeoutHandle: ReturnType<typeof setTimeout> | null = null;

    constructor(
        op: Operation,
        registry: InvocationRegistry,
        nodeEngine: NodeEngine,
        localAddress: Address,
        options?: InvocationOptions,
    ) {
        this.op = op;
        this.registry = registry;
        this.nodeEngine = nodeEngine;
        this.localAddress = localAddress;
        this.tryCount = options?.tryCount ?? 250;
        this.tryPauseMillis = options?.tryPauseMillis ?? 500;
        this.callTimeoutMillis = options?.callTimeoutMillis ?? 120_000;
        this.backupAckTimeoutMillis = options?.backupAckTimeoutMillis ?? 5000;
    }

    /**
     * Resolve the invocation target. Base class is a no-op.
     * Subclasses (PartitionInvocation, TargetInvocation) override this.
     */
    initInvocationTarget(): void {
        // no-op in base — subclasses override
    }

    /**
     * Complete the future with a normal response.
     * If backup acks are expected, defers completion until all acks arrive.
     */
    notifyNormalResponse(value: unknown, backupAcks: number): void {
        if (backupAcks === 0) {
            this._complete(value);
            return;
        }
        this.backupsAcksExpected = backupAcks;
        this.pendingResponse = value;
        this._armBackupAckTimeout();
        this._tryCompleteAfterBackupAcks();
    }

    /** Acknowledge a backup completion. */
    notifyBackupComplete(): void {
        this.backupsAcksReceived++;
        this._tryCompleteAfterBackupAcks();
    }

    /** Handle an error — retry if retryable and under limit, else reject. */
    notifyError(cause: Error): void {
        if (cause instanceof RetryableException && this.invokeCount < this.tryCount) {
            this._handleRetry();
            return;
        }
        this._completeExceptionally(cause);
    }

    /**
     * Compute the retry delay for the current invokeCount.
     * First MAX_FAST_INVOCATION_COUNT retries are immediate (0ms).
     */
    getRetryDelayMs(): number {
        if (this.invokeCount <= MAX_FAST_INVOCATION_COUNT) {
            return 0;
        }
        const exp = Math.min(
            Math.pow(2, this.invokeCount - MAX_FAST_INVOCATION_COUNT),
            this.tryPauseMillis,
        );
        return exp;
    }

    /** Deregister this invocation from the registry. */
    deregister(): void {
        this.registry.deregister(this);
    }

    // ── private ──────────────────────────────────────────────────────────

    private _handleRetry(): void {
        this.invokeCount++;
        this.op.deactivate();
        const delay = this.getRetryDelayMs();
        if (delay === 0) {
            this._doReInvoke();
        } else {
            setTimeout(() => this._doReInvoke(), delay);
        }
    }

    private _doReInvoke(): void {
        this.initInvocationTarget();
        this.registry.register(this);
    }

    private _tryCompleteAfterBackupAcks(): void {
        if (this.backupsAcksExpected > 0 && this.backupsAcksReceived >= this.backupsAcksExpected) {
            this._clearBackupTimeout();
            this._complete(this.pendingResponse);
        }
    }

    private _armBackupAckTimeout(): void {
        this._backupTimeoutHandle = setTimeout(() => {
            this._onBackupAckTimeout();
        }, this.backupAckTimeoutMillis);
    }

    private _clearBackupTimeout(): void {
        if (this._backupTimeoutHandle !== null) {
            clearTimeout(this._backupTimeoutHandle);
            this._backupTimeoutHandle = null;
        }
    }

    /**
     * Backup ack timeout handler.
     * If the primary target is still alive (local), resolve with pending response.
     * If the primary is gone, re-invoke from scratch.
     */
    private _onBackupAckTimeout(): void {
        if (this._isPrimaryAlive()) {
            // Primary is alive — safe to complete without all backup acks
            this._complete(this.pendingResponse);
        } else {
            // Primary is gone — resetAndReInvoke
            this._resetAndReInvoke();
        }
    }

    private _isPrimaryAlive(): boolean {
        if (this.targetAddress === null) return false;
        return this.targetAddress.equals(this.localAddress);
    }

    private _resetAndReInvoke(): void {
        this.backupsAcksExpected = 0;
        this.backupsAcksReceived = 0;
        this.pendingResponse = undefined;
        this.invokeCount++;
        this.op.deactivate();
        this.initInvocationTarget();
        this.registry.register(this);
    }

    private _complete(value: unknown): void {
        this._clearBackupTimeout();
        this.registry.deregister(this);
        this.future.complete(value);
    }

    private _completeExceptionally(cause: Error): void {
        this._clearBackupTimeout();
        this.registry.deregister(this);
        this.future.completeExceptionally(cause);
    }
}
