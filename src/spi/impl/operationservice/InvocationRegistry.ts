/**
 * Port of {@code com.hazelcast.spi.impl.operationservice.impl.InvocationRegistry}.
 *
 * Tracks all active invocations by callId. Provides backpressure by capping
 * the number of concurrent invocations and correlates responses to their
 * originating invocation via callId lookup.
 *
 * Single-threaded (Bun) — no synchronization needed.
 */
import type { Operation } from '@helios/spi/impl/operationservice/Operation';
import type { InvocationFuture } from '@helios/spi/impl/operationservice/InvocationFuture';

/**
 * Minimal contract an invocation must satisfy for registry tracking.
 * The full Invocation class (Block C.2) will implement this.
 */
export interface Invocable {
    readonly op: Operation;
    readonly future: InvocationFuture<unknown>;
}

export class InvocationRegistry {
    private readonly invocations = new Map<bigint, Invocable>();
    private callIdSequence: bigint = 0n;
    private readonly maxConcurrentInvocations: number;
    private _alive = true;

    constructor(maxConcurrentInvocations: number) {
        this.maxConcurrentInvocations = maxConcurrentInvocations;
    }

    /** Whether the registry is still accepting registrations. */
    get alive(): boolean {
        return this._alive;
    }

    /** Number of currently registered invocations. */
    get size(): number {
        return this.invocations.size;
    }

    /**
     * Register an invocation: assign a callId and track it.
     * @throws Error if registry is shut down or backpressure limit reached.
     */
    register(invocation: Invocable): void {
        if (!this._alive) {
            throw new Error('InvocationRegistry is not alive (shut down)');
        }
        if (this.invocations.size >= this.maxConcurrentInvocations) {
            throw new Error(
                `Backpressure: max concurrent invocations reached (${this.maxConcurrentInvocations})`,
            );
        }
        const callId = ++this.callIdSequence;
        invocation.op.setCallId(callId);
        this.invocations.set(callId, invocation);
    }

    /**
     * Remove an invocation from the registry and deactivate its operation.
     * Idempotent — safe to call multiple times.
     */
    deregister(invocation: Invocable): void {
        const callId = invocation.op.getCallId();
        if (callId === 0n) return; // already deactivated
        this.invocations.delete(callId);
        invocation.op.deactivate();
    }

    /** Look up an invocation by callId. */
    get(callId: bigint): Invocable | undefined {
        return this.invocations.get(callId);
    }

    /**
     * Notify all pending invocations with the given error and clear the registry.
     * Used on member departure or shutdown.
     */
    reset(cause: Error): void {
        for (const inv of this.invocations.values()) {
            inv.future.completeExceptionally(cause);
        }
        this.invocations.clear();
    }

    /** Mark the registry as shut down. No new registrations accepted. */
    shutdown(): void {
        this._alive = false;
    }
}
