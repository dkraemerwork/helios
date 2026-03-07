import { ExecutorConfig } from '@zenystx/helios-core/config/ExecutorConfig.js';
import type { ExecutionBackend } from '@zenystx/helios-core/executor/impl/ExecutionBackend.js';
import { ExecutorContainerService } from '@zenystx/helios-core/executor/impl/ExecutorContainerService.js';
import { InlineExecutionBackend } from '@zenystx/helios-core/executor/impl/InlineExecutionBackend.js';
import { TaskTypeRegistry } from '@zenystx/helios-core/executor/impl/TaskTypeRegistry.js';
import { beforeEach, describe, expect, test } from 'bun:test';

describe('Block 17.9E — Execution Backend Seam', () => {
    let config: ExecutorConfig;
    let registry: TaskTypeRegistry;

    beforeEach(() => {
        config = new ExecutorConfig('test-exec');
        config.setExecutionBackend('inline');
        registry = new TaskTypeRegistry();
        registry.register('echo', (input: unknown) => Promise.resolve(input), { version: 'fp-echo' });
    });

    test('container runs tasks through the inline backend via the seam', async () => {
        const container = new ExecutorContainerService('test-exec', config, registry);
        const result = await container.executeTask({
            taskUuid: 'u1',
            taskType: 'echo',
            registrationFingerprint: 'fp-echo',
            inputData: Buffer.from(JSON.stringify({ msg: 'hello' })),
            executorName: 'test-exec',
            submitterMemberUuid: 'member-1',
            timeoutMillis: 5000,
        });
        expect(result.status).toBe('success');
    });

    test('backend selection is config-driven and deterministic', () => {
        // Default should be 'scatter' (production default)
        const freshConfig = new ExecutorConfig('test-backend');
        expect(freshConfig.getExecutionBackend()).toBe('scatter');
        freshConfig.setExecutionBackend('inline');
        expect(freshConfig.getExecutionBackend()).toBe('inline');
        freshConfig.setExecutionBackend('scatter');
        expect(freshConfig.getExecutionBackend()).toBe('scatter');
    });

    test('unsupported backend values fail fast', () => {
        expect(() => config.setExecutionBackend('bogus' as any)).toThrow();
    });

    test('stats snapshots remain stable across backend choice', async () => {
        const container = new ExecutorContainerService('test-exec', config, registry);
        await container.executeTask({
            taskUuid: 'u2',
            taskType: 'echo',
            registrationFingerprint: 'fp-echo',
            inputData: Buffer.from(JSON.stringify(42)),
            executorName: 'test-exec',
            submitterMemberUuid: 'member-1',
            timeoutMillis: 5000,
        });
        const stats = container.getStats();
        expect(stats.started).toBe(1);
        expect(stats.completed).toBe(1);
        expect(stats.rejected).toBe(0);
        expect(stats.activeWorkers).toBe(0);
    });

    test('lifecycle behavior (shutdown) is backend-independent', async () => {
        const container = new ExecutorContainerService('test-exec', config, registry);
        await container.shutdown();
        expect(container.isShutdown()).toBe(true);
        const result = await container.executeTask({
            taskUuid: 'u3',
            taskType: 'echo',
            registrationFingerprint: 'fp-echo',
            inputData: Buffer.from(JSON.stringify('data')),
            executorName: 'test-exec',
            submitterMemberUuid: 'member-1',
            timeoutMillis: 5000,
        });
        expect(result.status).toBe('rejected');
    });

    test('rejection after close is backend-independent', async () => {
        const container = new ExecutorContainerService('test-exec', config, registry);
        await container.shutdown();
        const result = await container.executeTask({
            taskUuid: 'u4',
            taskType: 'echo',
            registrationFingerprint: 'fp-echo',
            inputData: Buffer.from(JSON.stringify(null)),
            executorName: 'test-exec',
            submitterMemberUuid: 'member-1',
            timeoutMillis: 5000,
        });
        expect(result.errorName).toBe('ExecutorRejectedExecutionException');
    });

    test('parity flag defaults to scatter for production', () => {
        const freshConfig = new ExecutorConfig('fresh');
        expect(freshConfig.getExecutionBackend()).toBe('scatter');
    });

    test('InlineExecutionBackend executes factory directly', async () => {
        const backend: ExecutionBackend = new InlineExecutionBackend();
        const result = await backend.execute(
            (input: unknown) => Promise.resolve({ doubled: (input as number) * 2 }),
            Buffer.from(JSON.stringify(21)),
        );
        expect(result).toEqual({ doubled: 42 });
    });

    test('container getBackend returns the configured backend instance', () => {
        const container = new ExecutorContainerService('test-exec', config, registry);
        const backend = container.getBackend();
        expect(backend).toBeInstanceOf(InlineExecutionBackend);
    });
});
