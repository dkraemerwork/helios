/**
 * Port of {@code com.hazelcast.spi.impl.AbstractInvocationFuture_GetTest}.
 *
 * Tests for InvocationFuture.get() resolution behavior.
 */
import { describe, it, expect } from 'bun:test';
import { InvocationFuture, CancellationException } from '@zenystx/helios-core/spi/impl/operationservice/InvocationFuture';

describe('InvocationFuture.get()', () => {
    it('get() resolves immediately when already complete', async () => {
        const future = new InvocationFuture<string>();
        future.complete('hello');
        const result = await future.get();
        expect(result).toBe('hello');
    });

    it('get() resolves after complete() is called asynchronously', async () => {
        const future = new InvocationFuture<number>();
        setTimeout(() => future.complete(42), 1);
        const result = await future.get();
        expect(result).toBe(42);
    });

    it('get() rejects when completeExceptionally is called', async () => {
        const future = new InvocationFuture<string>();
        const err = new Error('test error');
        future.completeExceptionally(err);
        await expect(future.get()).rejects.toBe(err);
    });

    it('get() rejects with CancellationException when cancelled', async () => {
        const future = new InvocationFuture<string>();
        future.cancel();
        await expect(future.get()).rejects.toBeInstanceOf(CancellationException);
    });

    it('get() resolves with null when complete(null) is called', async () => {
        const future = new InvocationFuture<string | null>();
        future.complete(null);
        const result = await future.get();
        expect(result).toBeNull();
    });
});
