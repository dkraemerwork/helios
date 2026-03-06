/**
 * Tests for NestManagedContext — ManagedContext implementation using NestJS ModuleRef.
 * Corresponds to hazelcast-spring SpringManagedContext (Block 6.1).
 */

import { describe, it, expect, mock } from 'bun:test';
import { NestManagedContext } from '@zenystx/nestjs/context/NestManagedContext';
import { NestAware } from '@zenystx/nestjs/context/NestAware';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a minimal mock ModuleRef */
function makeModuleRef(resolveImpl: (token: unknown) => unknown = () => null) {
    return {
        resolve: mock(resolveImpl),
        get: mock((token: unknown) => resolveImpl(token)),
    };
}

// ---------------------------------------------------------------------------
// Plain objects (no @NestAware) — must be returned unchanged
// ---------------------------------------------------------------------------

describe('NestManagedContext — non-NestAware objects', () => {
    it('returns null unchanged', () => {
        const ctx = new NestManagedContext();
        expect(ctx.initialize(null)).toBeNull();
    });

    it('returns undefined unchanged', () => {
        const ctx = new NestManagedContext();
        expect(ctx.initialize(undefined)).toBeUndefined();
    });

    it('returns a plain object unchanged (no injection)', () => {
        const ctx = new NestManagedContext();
        const obj = { foo: 'bar' };
        expect(ctx.initialize(obj)).toBe(obj);
    });

    it('returns a class instance without @NestAware unchanged', () => {
        class Plain {}
        const ctx = new NestManagedContext();
        const obj = new Plain();
        expect(ctx.initialize(obj)).toBe(obj);
    });
});

// ---------------------------------------------------------------------------
// @NestAware objects — injection via ModuleRef
// ---------------------------------------------------------------------------

describe('NestManagedContext — @NestAware objects', () => {
    it('@NestAware object is returned (pass-through, same reference)', () => {
        @NestAware()
        class MyTask {
            dep: object | null = null;
        }

        const ctx = new NestManagedContext();
        const task = new MyTask();
        const result = ctx.initialize(task);
        expect(result).toBe(task);
    });

    it('injects dependency into @NestAware object when ModuleRef is set', () => {
        const TOKEN = 'SOME_SERVICE';
        const service = { doWork: () => 42 };

        @NestAware()
        class MyTask {
            dep: typeof service | null = null;
        }

        const moduleRef = makeModuleRef((t) => (t === TOKEN ? service : null));
        const ctx = new NestManagedContext(moduleRef as never);

        const task = new MyTask();
        task.dep = null;

        // set dep via property injection using token mapping on the context
        // NestManagedContext.inject(task, TOKEN, 'dep') pattern
        ctx.inject(task, TOKEN, 'dep');
        expect(task.dep as unknown).toBe(service);
    });

    it('initialize() with no ModuleRef set just returns the object', () => {
        @NestAware()
        class MyTask {}

        const ctx = new NestManagedContext();
        const task = new MyTask();
        expect(ctx.initialize(task)).toBe(task);
    });
});

// ---------------------------------------------------------------------------
// setModuleRef
// ---------------------------------------------------------------------------

describe('NestManagedContext.setModuleRef', () => {
    it('can set ModuleRef after construction', () => {
        const ctx = new NestManagedContext();
        const ref = makeModuleRef();
        ctx.setModuleRef(ref as never);
        // no error thrown
        expect(true).toBe(true);
    });
});
