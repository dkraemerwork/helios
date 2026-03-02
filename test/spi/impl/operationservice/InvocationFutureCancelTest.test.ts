/**
 * Port of {@code com.hazelcast.spi.impl.AbstractInvocationFuture_CancelTest}.
 *
 * Tests for InvocationFuture cancellation semantics.
 */
import { describe, it, expect } from 'bun:test';
import { InvocationFuture, CancellationException } from '@helios/spi/impl/operationservice/InvocationFuture';

describe('InvocationFuture.cancel()', () => {
    it('cancel returns true when future is not yet done', () => {
        const future = new InvocationFuture<string>();
        const result = future.cancel();
        void future.get().catch(() => { /* expected */ });
        expect(result).toBe(true);
    });

    it('cancel marks future as cancelled and done', () => {
        const future = new InvocationFuture<string>();
        future.cancel();
        void future.get().catch(() => { /* expected */ });
        expect(future.isCancelled()).toBe(true);
        expect(future.isDone()).toBe(true);
    });

    it('second cancel returns false (already done)', () => {
        const future = new InvocationFuture<string>();
        future.cancel();
        void future.get().catch(() => { /* expected */ });
        const second = future.cancel();
        expect(second).toBe(false);
    });

    it('cancel returns false when future is already normally completed', () => {
        const future = new InvocationFuture<string>();
        future.complete('value');
        const result = future.cancel();
        expect(result).toBe(false);
        expect(future.isCancelled()).toBe(false);
    });

    it('get() rejects with CancellationException after cancel', async () => {
        const future = new InvocationFuture<string>();
        future.cancel();
        await expect(future.get()).rejects.toBeInstanceOf(CancellationException);
    });

    it('complete() after cancel has no effect — get still rejects', async () => {
        const future = new InvocationFuture<string>();
        future.cancel();
        const completedLate = future.complete('too late');
        expect(completedLate).toBe(false);
        await expect(future.get()).rejects.toBeInstanceOf(CancellationException);
    });
});
