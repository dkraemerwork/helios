/**
 * Tests for {@code InvocationRegistry} — Block 16.C1.
 *
 * Covers: register, deregister, get, reset, backpressure, alive flag.
 */
import { InvocationFuture } from '@zenystx/helios-core/spi/impl/operationservice/InvocationFuture';
import { InvocationRegistry, type Invocable } from '@zenystx/helios-core/spi/impl/operationservice/InvocationRegistry';
import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import { beforeEach, describe, expect, test } from 'bun:test';

/** Minimal concrete Operation for testing. */
class NoopOperation extends Operation {
    async run(): Promise<void> {
        this.sendResponse(null);
    }
}

/** Minimal Invocable for testing. */
function makeInvocable(op?: Operation): Invocable {
    return {
        op: op ?? new NoopOperation(),
        future: new InvocationFuture<unknown>(),
    };
}

describe('InvocationRegistry', () => {
    let registry: InvocationRegistry;

    beforeEach(() => {
        registry = new InvocationRegistry(100);
    });

    // ── register / get / deregister ────────────────────────────

    test('register assigns monotonically increasing callIds', () => {
        const inv1 = makeInvocable();
        const inv2 = makeInvocable();
        registry.register(inv1);
        registry.register(inv2);
        expect(inv1.op.getCallId()).toBe(1n);
        expect(inv2.op.getCallId()).toBe(2n);
    });

    test('get returns registered invocation by callId', () => {
        const inv = makeInvocable();
        registry.register(inv);
        const callId = inv.op.getCallId();
        expect(registry.get(callId)).toBe(inv);
    });

    test('get returns undefined for unknown callId', () => {
        expect(registry.get(999n)).toBeUndefined();
    });

    test('deregister removes invocation and deactivates operation', () => {
        const inv = makeInvocable();
        registry.register(inv);
        const callId = inv.op.getCallId();
        registry.deregister(inv);
        expect(registry.get(callId)).toBeUndefined();
        expect(inv.op.isActive()).toBe(false);
    });

    test('deregister is idempotent (no error on double-deregister)', () => {
        const inv = makeInvocable();
        registry.register(inv);
        registry.deregister(inv);
        registry.deregister(inv); // should not throw
    });

    test('size tracks registered invocations', () => {
        expect(registry.size).toBe(0);
        const inv1 = makeInvocable();
        const inv2 = makeInvocable();
        registry.register(inv1);
        expect(registry.size).toBe(1);
        registry.register(inv2);
        expect(registry.size).toBe(2);
        registry.deregister(inv1);
        expect(registry.size).toBe(1);
    });

    // ── backpressure ───────────────────────────────────────────

    test('register throws when backpressure limit is reached', () => {
        const small = new InvocationRegistry(2);
        small.register(makeInvocable());
        small.register(makeInvocable());
        expect(() => small.register(makeInvocable())).toThrow(/backpressure/i);
    });

    test('deregister frees a permit so next register succeeds', () => {
        const small = new InvocationRegistry(1);
        const inv = makeInvocable();
        small.register(inv);
        expect(() => small.register(makeInvocable())).toThrow(/backpressure/i);
        small.deregister(inv);
        // Now should succeed
        const inv2 = makeInvocable();
        small.register(inv2);
        expect(inv2.op.getCallId()).toBeGreaterThan(0n);
    });

    // ── reset ──────────────────────────────────────────────────

    test('reset completes all futures exceptionally and clears the registry', async () => {
        const inv1 = makeInvocable();
        const inv2 = makeInvocable();
        registry.register(inv1);
        registry.register(inv2);

        const cause = new Error('member left');
        registry.reset(cause);

        expect(registry.size).toBe(0);
        expect(inv1.future.isDone()).toBe(true);
        expect(inv2.future.isDone()).toBe(true);
        // Consume rejections to avoid unhandled promise warnings
        await expect(inv1.future.get()).rejects.toThrow('member left');
        await expect(inv2.future.get()).rejects.toThrow('member left');
    });

    test('reset causes futures to reject with the provided error', async () => {
        const inv = makeInvocable();
        registry.register(inv);
        const cause = new Error('shutdown');
        registry.reset(cause);

        await expect(inv.future.get()).rejects.toThrow('shutdown');
    });

    // ── alive flag ─────────────────────────────────────────────

    test('registry is alive by default', () => {
        expect(registry.alive).toBe(true);
    });

    test('shutdown marks registry as not alive', () => {
        registry.shutdown();
        expect(registry.alive).toBe(false);
    });

    test('register throws after shutdown', () => {
        registry.shutdown();
        expect(() => registry.register(makeInvocable())).toThrow(/not alive|shut.*down/i);
    });
});
