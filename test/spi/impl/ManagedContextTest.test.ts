/**
 * Port of ManagedContext behavior tests (adapted from Hazelcast Jet ManagedContextTest).
 *
 * ManagedContext is a simple functional interface for initializing deserialized objects.
 */
import { describe, it, expect } from 'bun:test';
import type { ManagedContext } from '@helios/spi/impl/ManagedContext';

describe('ManagedContext', () => {
    it('pass-through implementation returns the same object', () => {
        const ctx: ManagedContext = { initialize: obj => obj };
        const original = { id: 1 };
        expect(ctx.initialize(original)).toBe(original);
    });

    it('implementation can return a different (proxy) object', () => {
        class Proxy {
            constructor(public readonly wrapped: unknown) {}
        }
        const ctx: ManagedContext = { initialize: obj => new Proxy(obj) };
        const original = { id: 2 };
        const result = ctx.initialize(original) as Proxy;
        expect(result).toBeInstanceOf(Proxy);
        expect(result.wrapped).toBe(original);
    });

    it('can be implemented as a lambda function (functional interface)', () => {
        let initCalled = false;
        const ctx: ManagedContext = {
            initialize(obj: unknown): unknown {
                initCalled = true;
                return obj;
            },
        };
        ctx.initialize({});
        expect(initCalled).toBe(true);
    });

    it('null input returns null when implementation passes through null', () => {
        const ctx: ManagedContext = { initialize: obj => obj };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(ctx.initialize(null as any)).toBeNull();
    });
});
