/**
 * Port of {@code com.hazelcast.spi.impl.AbstractInvocationFuture_AndThenTest}
 * and {@code AbstractInvocationFuture_MiscTest}.
 *
 * Tests for InvocationFuture callback registration (whenComplete, thenApply).
 */
import { describe, it, expect } from 'bun:test';
import { InvocationFuture } from '@zenystx/core/spi/impl/operationservice/InvocationFuture';

describe('InvocationFuture.whenComplete()', () => {
    it('null callback throws', () => {
        const future = new InvocationFuture<string>();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(() => future.whenComplete(null as any)).toThrow();
    });

    it('callback is invoked with value when future completes normally', async () => {
        const future = new InvocationFuture<string>();
        let receivedValue: unknown = undefined;
        let receivedError: unknown = undefined;

        future.whenComplete((v, e) => {
            receivedValue = v;
            receivedError = e;
        });

        future.complete('hello');
        await Promise.resolve(); // flush microtasks

        expect(receivedValue).toBe('hello');
        expect(receivedError).toBeNull();
    });

    it('callback is invoked with error when future completes exceptionally', async () => {
        const future = new InvocationFuture<string>();
        const err = new Error('oops');
        let receivedValue: unknown = undefined;
        let receivedError: unknown = undefined;

        future.whenComplete((v, e) => {
            receivedValue = v;
            receivedError = e;
        });

        future.completeExceptionally(err);
        await Promise.resolve();

        expect(receivedValue).toBeNull();
        expect(receivedError).toBe(err);
    });

    it('callback is invoked even if registered after completion', async () => {
        const future = new InvocationFuture<number>();
        future.complete(99);

        let called = false;
        future.whenComplete(() => { called = true; });
        await Promise.resolve();

        expect(called).toBe(true);
    });
});

describe('InvocationFuture.thenApply()', () => {
    it('thenApply transforms the result value', async () => {
        const future = new InvocationFuture<number>();
        const mapped = future.thenApply(n => n * 2);

        future.complete(21);
        const result = await mapped.get();
        expect(result).toBe(42);
    });

    it('thenApply propagates exceptions from the mapper', async () => {
        const future = new InvocationFuture<number>();
        const mapped = future.thenApply(() => { throw new Error('mapper error'); });

        future.complete(1);
        await expect(mapped.get()).rejects.toThrow('mapper error');
    });
});
