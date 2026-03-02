/**
 * Port of {@code com.hazelcast.spi.impl.AbstractInvocationFuture_JoinTest}.
 *
 * Tests for InvocationFuture.join(), which wraps non-cancellation exceptions
 * in CompletionException (matching Java CompletableFuture.join() semantics).
 */
import { describe, it, expect } from 'bun:test';
import {
    InvocationFuture,
    CancellationException,
    CompletionException,
} from '@helios/spi/impl/operationservice/InvocationFuture';

describe('InvocationFuture.join()', () => {
    it('join() returns the value on normal completion', async () => {
        const future = new InvocationFuture<string>();
        future.complete('ok');
        const result = await future.join();
        expect(result).toBe('ok');
    });

    it('join() wraps Error in CompletionException', async () => {
        const future = new InvocationFuture<string>();
        const cause = new Error('something went wrong');
        future.completeExceptionally(cause);
        try {
            await future.join();
            expect(true).toBe(false); // must not reach here
        } catch (e) {
            expect(e).toBeInstanceOf(CompletionException);
            expect((e as CompletionException).cause).toBe(cause);
        }
    });

    it('join() does NOT wrap CancellationException (thrown as-is)', async () => {
        const future = new InvocationFuture<string>();
        future.cancel();
        try {
            await future.join();
            expect(true).toBe(false);
        } catch (e) {
            expect(e).toBeInstanceOf(CancellationException);
            expect(e).not.toBeInstanceOf(CompletionException);
        }
    });

    it('join() resolves with null on complete(null)', async () => {
        const future = new InvocationFuture<string | null>();
        future.complete(null);
        const result = await future.join();
        expect(result).toBeNull();
    });
});
