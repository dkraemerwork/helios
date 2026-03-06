import { describe, test, expect } from 'bun:test';
import { TaskTypeRegistry, type TaskTypeDescriptor } from '@zenystx/helios-core/executor/impl/TaskTypeRegistry.js';
import { UnknownTaskTypeException, TaskRegistrationMismatchException } from '@zenystx/helios-core/executor/ExecutorExceptions.js';

describe('TaskTypeRegistry', () => {
    test('register and get round-trip', () => {
        const registry = new TaskTypeRegistry();
        const factory = (input: unknown) => (input as number) * 2;

        registry.register('multiply', factory);

        const desc = registry.get('multiply');
        expect(desc).toBeDefined();
        expect(desc!.taskType).toBe('multiply');
        expect(desc!.factory).toBe(factory);
        expect(desc!.fingerprint).toBeTypeOf('string');
        expect(desc!.fingerprint.length).toBeGreaterThan(0);
    });

    test('unregister removes descriptor', () => {
        const registry = new TaskTypeRegistry();
        registry.register('tmp', () => 42);

        expect(registry.unregister('tmp')).toBe(true);
        expect(registry.get('tmp')).toBeUndefined();
        expect(registry.unregister('tmp')).toBe(false);
    });

    test('duplicate register replaces existing descriptor', () => {
        const registry = new TaskTypeRegistry();
        const factoryV1 = (input: unknown) => 1;
        const factoryV2 = (input: unknown) => 2;

        registry.register('task', factoryV1);
        const fp1 = registry.get('task')!.fingerprint;

        registry.register('task', factoryV2);
        const desc = registry.get('task')!;
        expect(desc.factory).toBe(factoryV2);
        // different factory → different fallback fingerprint
        expect(desc.fingerprint).not.toBe(fp1);
    });

    test('explicit version becomes fingerprint seed', () => {
        const registry = new TaskTypeRegistry();
        registry.register('task', () => 1, { version: '2.0.0' });

        const desc = registry.get('task')!;
        expect(desc.fingerprint).toBe('2.0.0');
    });

    test('fallback fingerprint derived deterministically from factory source', () => {
        const registry1 = new TaskTypeRegistry();
        const registry2 = new TaskTypeRegistry();
        const factory = (input: unknown) => (input as number) + 1;

        registry1.register('add', factory);
        registry2.register('add', factory);

        expect(registry1.get('add')!.fingerprint).toBe(registry2.get('add')!.fingerprint);
    });

    test('different factories produce different fallback fingerprints', () => {
        const registry = new TaskTypeRegistry();
        registry.register('a', (x: unknown) => (x as number) + 1);
        registry.register('b', (x: unknown) => (x as number) + 2);

        expect(registry.get('a')!.fingerprint).not.toBe(registry.get('b')!.fingerprint);
    });

    test('getRegisteredTypes returns all names', () => {
        const registry = new TaskTypeRegistry();
        registry.register('alpha', () => 1);
        registry.register('beta', () => 2);

        const types = registry.getRegisteredTypes();
        expect(types).toEqual(new Set(['alpha', 'beta']));
    });

    test('validateFingerprint passes for matching fingerprint', () => {
        const registry = new TaskTypeRegistry();
        registry.register('task', () => 1, { version: '1.0' });

        // Should not throw
        registry.validateFingerprint('task', '1.0');
    });

    test('validateFingerprint throws UnknownTaskTypeException for unregistered type', () => {
        const registry = new TaskTypeRegistry();

        expect(() => registry.validateFingerprint('nope', 'abc')).toThrow(UnknownTaskTypeException);
    });

    test('validateFingerprint throws TaskRegistrationMismatchException for wrong fingerprint', () => {
        const registry = new TaskTypeRegistry();
        registry.register('task', () => 1, { version: '1.0' });

        expect(() => registry.validateFingerprint('task', '2.0')).toThrow(TaskRegistrationMismatchException);
    });

    test('pool overrides stored in descriptor', () => {
        const registry = new TaskTypeRegistry();
        registry.register('task', () => 1, { poolSize: 4 });

        expect(registry.get('task')!.poolSize).toBe(4);
    });
});
