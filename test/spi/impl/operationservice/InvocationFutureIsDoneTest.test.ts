/**
 * Port of {@code com.hazelcast.spi.impl.AbstractInvocationFuture_IsDoneTest}.
 *
 * Tests for InvocationFuture.isDone() state management.
 */
import { describe, it, expect } from 'bun:test';
import { InvocationFuture } from '@zenystx/core/spi/impl/operationservice/InvocationFuture';

describe('InvocationFuture.isDone()', () => {
    it('isDone is false when future is newly created (no result yet)', () => {
        const future = new InvocationFuture<string>();
        expect(future.isDone()).toBe(false);
    });

    it('isDone is true after complete with null', () => {
        const future = new InvocationFuture<string | null>();
        future.complete(null);
        expect(future.isDone()).toBe(true);
    });

    it('isDone is true after complete with a non-null value', () => {
        const future = new InvocationFuture<string>();
        future.complete('hello');
        expect(future.isDone()).toBe(true);
    });

    it('isDone is true after completeExceptionally', () => {
        const future = new InvocationFuture<string>();
        future.completeExceptionally(new Error('boom'));
        // suppress unhandled-rejection noise
        void future.get().catch(() => { /* expected */ });
        expect(future.isDone()).toBe(true);
    });

    it('isDone is true after cancel()', () => {
        const future = new InvocationFuture<string>();
        future.cancel();
        void future.get().catch(() => { /* expected */ });
        expect(future.isDone()).toBe(true);
    });
});
