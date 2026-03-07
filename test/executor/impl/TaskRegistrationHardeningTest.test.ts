import { TaskRegistrationMismatchException } from '@zenystx/helios-core/executor/ExecutorExceptions.js';
import { TaskTypeRegistry } from '@zenystx/helios-core/executor/impl/TaskTypeRegistry.js';
import { describe, expect, test } from 'bun:test';

describe('TaskRegistrationHardening (Block 17.9C)', () => {
    // ── Worker materialization metadata ──────────────────────────────────

    test('module-backed registration stores worker materialization metadata', () => {
        const registry = new TaskTypeRegistry();
        registry.register('fibonacci', (n: unknown) => Number(n), {
            version: 'v1',
            modulePath: './tasks/fibonacci.ts',
            exportName: 'fibonacci',
        });

        const desc = registry.get('fibonacci')!;
        expect(desc.workerMeta).toBeDefined();
        expect(desc.workerMeta!.modulePath).toBe('./tasks/fibonacci.ts');
        expect(desc.workerMeta!.exportName).toBe('fibonacci');
    });

    test('fingerprint changes when worker materialization metadata changes', () => {
        const registry = new TaskTypeRegistry();
        const factory = (n: unknown) => Number(n);

        registry.register('task', factory, {
            modulePath: './tasks/a.ts',
            exportName: 'run',
        });
        const fp1 = registry.get('task')!.fingerprint;

        registry.register('task', factory, {
            modulePath: './tasks/b.ts',
            exportName: 'run',
        });
        const fp2 = registry.get('task')!.fingerprint;

        expect(fp1).not.toBe(fp2);
    });

    test('fingerprint changes when export name changes', () => {
        const registry = new TaskTypeRegistry();
        const factory = (n: unknown) => Number(n);

        registry.register('task', factory, {
            modulePath: './tasks/a.ts',
            exportName: 'run',
        });
        const fp1 = registry.get('task')!.fingerprint;

        registry.register('task', factory, {
            modulePath: './tasks/a.ts',
            exportName: 'execute',
        });
        const fp2 = registry.get('task')!.fingerprint;

        expect(fp1).not.toBe(fp2);
    });

    // ── Closure rejection ────────────────────────────────────────────────

    test('closure-dependent distributed registration is rejected when no module path', () => {
        const registry = new TaskTypeRegistry();
        // A bare factory with no modulePath is closure-dependent (not worker-safe)
        expect(() => {
            registry.registerDistributed('closureTask', (n: unknown) => Number(n));
        }).toThrow(/worker-safe/i);
    });

    test('registerDistributed requires modulePath for worker materialization', () => {
        const registry = new TaskTypeRegistry();
        expect(() => {
            registry.registerDistributed('task', (n: unknown) => Number(n), {
                exportName: 'run',
                // missing modulePath
            });
        }).toThrow(/modulePath/i);
    });

    test('registerDistributed accepts valid module-backed registration', () => {
        const registry = new TaskTypeRegistry();
        registry.registerDistributed('task', (n: unknown) => Number(n), {
            modulePath: './tasks/task.ts',
            exportName: 'run',
        });

        const desc = registry.get('task')!;
        expect(desc.workerMeta).toBeDefined();
        expect(desc.workerMeta!.modulePath).toBe('./tasks/task.ts');
    });

    // ── Local inline path preserved ──────────────────────────────────────

    test('register() still works for local-capable tasks without modulePath', () => {
        const registry = new TaskTypeRegistry();
        // Plain register (non-distributed-hardened) still works for backward compat
        registry.register('localCapable', (n: unknown) => Number(n));

        const desc = registry.get('localCapable')!;
        expect(desc).toBeDefined();
        expect(desc.workerMeta).toBeUndefined();
    });

    test('isWorkerSafe returns true only for module-backed registrations', () => {
        const registry = new TaskTypeRegistry();
        registry.register('plain', (n: unknown) => Number(n));
        registry.register('modBacked', (n: unknown) => Number(n), {
            modulePath: './tasks/mod.ts',
            exportName: 'run',
        });

        expect(registry.isWorkerSafe('plain')).toBe(false);
        expect(registry.isWorkerSafe('modBacked')).toBe(true);
        expect(registry.isWorkerSafe('nonexistent')).toBe(false);
    });

    // ── Fingerprint contract with stronger metadata ─────────────────────

    test('registration mismatch still rejects with the stronger fingerprint contract', () => {
        const registry = new TaskTypeRegistry();
        registry.register('task', (n: unknown) => Number(n), {
            modulePath: './tasks/a.ts',
            exportName: 'run',
        });

        const localFp = registry.get('task')!.fingerprint;
        // A different fingerprint from a remote node must still be rejected
        expect(() => registry.validateFingerprint('task', 'wrong-fp')).toThrow(TaskRegistrationMismatchException);
        // Matching fingerprint passes
        registry.validateFingerprint('task', localFp);
    });
});
