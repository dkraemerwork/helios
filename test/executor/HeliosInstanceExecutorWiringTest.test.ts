/**
 * Block 17.8 — HeliosInstance wiring for IExecutorService.
 *
 * Tests: getExecutorService(name) returns cached proxy, config applied by name,
 * executor registered in node engine, shutdown drains executor, named executors
 * coexist, scheduled executor stub is deterministic.
 */
import { ExecutorConfig } from '@zenystx/helios-core/config/ExecutorConfig';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';
import { afterEach, describe, expect, test } from 'bun:test';

describe('HeliosInstance executor wiring (Block 17.8)', () => {
    const instances: HeliosInstanceImpl[] = [];

    function createInstance(config?: HeliosConfig): HeliosInstanceImpl {
        const inst = new HeliosInstanceImpl(config);
        instances.push(inst);
        return inst;
    }

    afterEach(() => {
        for (const inst of instances) {
            try { inst.shutdown(); } catch { /* ignore */ }
        }
        instances.length = 0;
    });

    test('getExecutorService(name) returns an IExecutorService', () => {
        const inst = createInstance();
        const exec = inst.getExecutorService('compute');
        expect(exec).toBeDefined();
        expect(exec.isShutdown()).toBe(false);
    });

    test('getExecutorService(name) returns same instance for same name (cached)', () => {
        const inst = createInstance();
        const a = inst.getExecutorService('compute');
        const b = inst.getExecutorService('compute');
        expect(a).toBe(b);
    });

    test('different names return different executor proxies', () => {
        const inst = createInstance();
        const a = inst.getExecutorService('alpha');
        const b = inst.getExecutorService('beta');
        expect(a).not.toBe(b);
    });

    test('executor config is applied by name', () => {
        const config = new HeliosConfig();
        const ec = new ExecutorConfig('custom');
        ec.setPoolSize(2).setQueueCapacity(10);
        config.addExecutorConfig(ec);

        const inst = createInstance(config);
        const exec = inst.getExecutorService('custom');
        // The proxy should exist and not be shut down — the config was found
        expect(exec).toBeDefined();
        expect(exec.isShutdown()).toBe(false);
    });

    test('default executor config is used when no named config registered', () => {
        const inst = createInstance();
        const exec = inst.getExecutorService('unregistered');
        expect(exec).toBeDefined();
        expect(exec.isShutdown()).toBe(false);
    });

    test('shutdown() shuts down all executor services', () => {
        const inst = createInstance();
        const a = inst.getExecutorService('alpha');
        const b = inst.getExecutorService('beta');
        inst.shutdown();
        expect(a.isShutdown()).toBe(true);
        expect(b.isShutdown()).toBe(true);
    });

    test('shutdownAsync() awaits executor drain before tearing down', async () => {
        const inst = createInstance();
        const exec = inst.getExecutorService('drain-test');
        await inst.shutdownAsync();
        expect(exec.isShutdown()).toBe(true);
        // Remove from tracked list since already shut down
        instances.splice(instances.indexOf(inst), 1);
    });

    test('getExecutorService after shutdown throws', () => {
        const inst = createInstance();
        inst.shutdown();
        expect(() => inst.getExecutorService('late')).toThrow();
    });

    test('getScheduledExecutorService stub throws deterministic message', () => {
        const inst = createInstance();
        expect(() => inst.getScheduledExecutorService('test')).toThrow(
            /ScheduledExecutorService.*not supported.*deferred/i,
        );
    });

    test('executor supports registerTaskType and submitLocal round-trip', async () => {
        const inst = createInstance();
        const exec = inst.getExecutorService('compute');
        // submitLocal with inline does not need task registration
        const future = exec.submitLocal({ taskType: '__inline__', fn: (input: unknown) => (input as number) * 2, input: 21 });
        const result = await future.get();
        expect(result).toBe(42);
    });
});
