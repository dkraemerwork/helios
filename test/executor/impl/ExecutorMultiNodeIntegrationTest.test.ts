/**
 * Block 17.10 — Live multi-node executor integration over the real TCP runtime path.
 *
 * Proves distributed executor work crosses the actual transport/operation wire,
 * executes through the runtime container/backend path, and marks in-flight work
 * task-lost when the submitter member really departs the cluster.
 */
import { Helios } from '@zenystx/helios-core/Helios';
import { Address } from '@zenystx/helios-core/cluster/Address';
import type { Member } from '@zenystx/helios-core/cluster/Member';
import { ExecutorConfig } from '@zenystx/helios-core/config/ExecutorConfig';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import { ExecutorContainerService } from '@zenystx/helios-core/executor/impl/ExecutorContainerService';
import type { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';
import { afterEach, describe, expect, test } from 'bun:test';

const EXECUTOR_NAME = 'default';
const BASE_PORT = 18620;

let nextPort = BASE_PORT;

interface LiveNode {
    readonly instance: HeliosInstanceImpl;
    readonly container: ExecutorContainerService;
}

function allocatePorts(count: number): number[] {
    const start = nextPort;
    nextPort += count + 10;
    return Array.from({ length: count }, (_, index) => start + index);
}

async function waitUntil(predicate: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!(await predicate())) {
        if (Date.now() >= deadline) {
            throw new Error(`waitUntil timed out after ${timeoutMs}ms`);
        }
        await Bun.sleep(20);
    }
}

function createExecutorConfig(overrides?: Partial<{
    poolSize: number;
    queueCapacity: number;
    taskTimeoutMillis: number;
    shutdownTimeoutMillis: number;
}>): ExecutorConfig {
    const config = new ExecutorConfig(EXECUTOR_NAME);
    config.setExecutionBackend('scatter');
    if (overrides?.poolSize != null) config.setPoolSize(overrides.poolSize);
    if (overrides?.queueCapacity != null) config.setQueueCapacity(overrides.queueCapacity);
    if (overrides?.taskTimeoutMillis != null) config.setTaskTimeoutMillis(overrides.taskTimeoutMillis);
    if (overrides?.shutdownTimeoutMillis != null) config.setShutdownTimeoutMillis(overrides.shutdownTimeoutMillis);
    return config;
}

async function startNode(name: string, port: number, peerPorts: number[], executorConfig: ExecutorConfig): Promise<HeliosInstanceImpl> {
    const config = new HeliosConfig(name);
    config.addExecutorConfig(executorConfig);
    config.getNetworkConfig().setPort(port).getJoin().getTcpIpConfig().setEnabled(true);
    for (const peerPort of peerPorts) {
        config.getNetworkConfig().getJoin().getTcpIpConfig().addMember(`localhost:${peerPort}`);
    }
    return Helios.newInstance(config);
}

function getContainer(instance: HeliosInstanceImpl): ExecutorContainerService {
    return instance.getNodeEngine().getService<ExecutorContainerService>(`helios:executor:container:${EXECUTOR_NAME}`);
}

async function startCluster(
    nodeCount: number,
    overrides?: Partial<{
        poolSize: number;
        queueCapacity: number;
        taskTimeoutMillis: number;
        shutdownTimeoutMillis: number;
    }>,
): Promise<LiveNode[]> {
    const ports = allocatePorts(nodeCount);
    const instances: HeliosInstanceImpl[] = [];

    for (let index = 0; index < nodeCount; index++) {
        const instance = await startNode(
            `executor-node-${ports[index]}`,
            ports[index],
            ports.slice(0, index),
            createExecutorConfig(overrides),
        );
        instance.getExecutorService(EXECUTOR_NAME);
        instances.push(instance);
    }

    await Promise.all(instances.map((instance) => waitUntil(() => instance.getCluster().getMembers().length === nodeCount)));

    return instances.map((instance) => ({
        instance,
        container: getContainer(instance),
    }));
}

function registerDistributedTask(
    nodes: LiveNode[],
    taskType: string,
    modulePath: string,
    version: string,
): void {
    for (const node of nodes) {
        node.instance.getExecutorService(EXECUTOR_NAME).registerTaskType(taskType, () => {
            throw new Error('module-backed distributed task should not execute on the main thread');
        }, {
            version,
            modulePath,
            exportName: 'default',
        });
    }
}

function makeGhostMember(port: number, uuid: string): Member {
    const address = new Address('127.0.0.1', port);
    return {
        getAddress: () => address,
        getUuid: () => uuid,
        localMember: () => false,
        isLiteMember: () => false,
        getAddressMap: () => new Map(),
        getAttributes: () => new Map(),
        getAttribute: () => null,
        getVersion: () => ({ getMajor: () => 1, getMinor: () => 0, getPatch: () => 0 }),
    } as unknown as Member;
}

function rejectPendingOperationResponses(instance: HeliosInstanceImpl, errorMessage: string): void {
    const pendingResponses = (instance as unknown as {
        _pendingResponses: Map<number, { reject: (error: Error) => void }> | null;
    })._pendingResponses;

    if (!pendingResponses) {
        return;
    }

    for (const [callId, pending] of pendingResponses) {
        pendingResponses.delete(callId);
        pending.reject(new Error(errorMessage));
    }
}

describe('Block 17.10 - Executor Multi-Node Integration', () => {
    const cluster: HeliosInstanceImpl[] = [];

    afterEach(async () => {
        for (const instance of cluster.splice(0)) {
            if (instance.isRunning()) {
                instance.shutdown();
            }
        }
        Helios.shutdownAll();
        await Bun.sleep(50);
    });

    test('submit() routes over the live runtime transport path', async () => {
        const nodes = await startCluster(3);
        cluster.push(...nodes.map((node) => node.instance));
        registerDistributedTask(nodes, 'double', import.meta.resolve('./fixtures/double-task.ts'), 'double-v1');

        const submitter = nodes[0].instance.getExecutorService(EXECUTOR_NAME);
        const result = await submitter.submit({ taskType: 'double', input: 21 }).get();
        expect(result).toBe(42);

        await waitUntil(() => nodes.reduce((sum, node) => sum + node.container.getStats().completed, 0) === 1);
    });

    test('submitToMember() executes only on the requested live member', async () => {
        const nodes = await startCluster(3);
        cluster.push(...nodes.map((node) => node.instance));
        registerDistributedTask(nodes, 'echo', import.meta.resolve('./fixtures/echo-task.ts'), 'echo-v1');

        const target = nodes[2].instance.getCluster().getLocalMember();
        const result = await nodes[0].instance.getExecutorService(EXECUTOR_NAME)
            .submitToMember({ taskType: 'echo', input: 'member-only' }, target)
            .get();

        expect(result).toBe('member-only');
        await waitUntil(() => nodes[2].container.getStats().completed === 1);
        expect(nodes[0].container.getStats().completed).toBe(0);
        expect(nodes[1].container.getStats().completed).toBe(0);
    });

    test('submitToMembers() fans out over the live runtime path', async () => {
        const nodes = await startCluster(3);
        cluster.push(...nodes.map((node) => node.instance));
        registerDistributedTask(nodes, 'echo', import.meta.resolve('./fixtures/echo-task.ts'), 'echo-v1');

        const futureMap = nodes[0].instance.getExecutorService(EXECUTOR_NAME)
            .submitToMembers({ taskType: 'echo', input: 'broadcast' }, nodes[0].instance.getCluster().getMembers());

        expect(futureMap.size).toBe(3);
        const results = await Promise.all(Array.from(futureMap.values(), (future) => future.get()));
        expect(results).toEqual(['broadcast', 'broadcast', 'broadcast']);

        await waitUntil(() => nodes.every((node) => node.container.getStats().completed === 1));
    });

    test('member-targeted submission fails when the live target is unreachable', async () => {
        const nodes = await startCluster(2);
        cluster.push(...nodes.map((node) => node.instance));
        registerDistributedTask(nodes, 'echo', import.meta.resolve('./fixtures/echo-task.ts'), 'echo-v1');

        const ghost = makeGhostMember(19999, 'ghost-member');
        await expect(
            nodes[0].instance.getExecutorService(EXECUTOR_NAME)
                .submitToMember({ taskType: 'echo', input: 'hi' }, ghost)
                .get(),
        ).rejects.toBeInstanceOf(Error);
    });

    test('registration mismatch rejects before remote execution on the live path', async () => {
        const nodes = await startCluster(2);
        cluster.push(...nodes.map((node) => node.instance));

        nodes[0].instance.getExecutorService(EXECUTOR_NAME).registerTaskType('compute', () => 0, {
            version: 'v1',
            modulePath: import.meta.resolve('./fixtures/echo-task.ts'),
            exportName: 'default',
        });
        nodes[1].instance.getExecutorService(EXECUTOR_NAME).registerTaskType('compute', () => 0, {
            version: 'v2',
            modulePath: import.meta.resolve('./fixtures/echo-task.ts'),
            exportName: 'default',
        });

        await expect(
            nodes[0].instance.getExecutorService(EXECUTOR_NAME)
                .submitToMember({ taskType: 'compute', input: 42 }, nodes[1].instance.getCluster().getLocalMember())
                .get(),
        ).rejects.toMatchObject({ name: 'TaskRegistrationMismatchException' });
    });

    test('queue full rejection stays fail-closed across the live path', async () => {
        const nodes = await startCluster(2, {
            poolSize: 1,
            queueCapacity: 1,
            shutdownTimeoutMillis: 100,
        });
        cluster.push(...nodes.map((node) => node.instance));
        registerDistributedTask(nodes, 'sleep', import.meta.resolve('./fixtures/sleep-task.ts'), 'sleep-v1');

        const submitter = nodes[0].instance.getExecutorService(EXECUTOR_NAME);
        const target = nodes[1].instance.getCluster().getLocalMember();

        const first = submitter.submitToMember({ taskType: 'sleep', input: { delayMs: 250, result: 'a' } }, target).get();
        await waitUntil(() => nodes[1].container.getStats().started === 1);

        const second = submitter.submitToMember({ taskType: 'sleep', input: { delayMs: 250, result: 'b' } }, target).get();
        await waitUntil(() => nodes[1].container.getStats().pending === 1);

        await expect(
            submitter.submitToMember({ taskType: 'sleep', input: { delayMs: 250, result: 'c' } }, target).get(),
        ).rejects.toMatchObject({
            name: 'ExecutorRejectedExecutionException',
            message: expect.stringContaining('Queue full'),
        });

        expect(await first).toBe('a');
        expect(await second).toBe('b');
    });

    test('submitter departure triggers live task-lost handling', async () => {
        const nodes = await startCluster(2, { shutdownTimeoutMillis: 100 });
        cluster.push(...nodes.map((node) => node.instance));
        registerDistributedTask(nodes, 'sleep', import.meta.resolve('./fixtures/sleep-task.ts'), 'sleep-v1');

        const submitterInstance = nodes[0].instance;
        const workerNode = nodes[1];
        const resultPromise = submitterInstance.getExecutorService(EXECUTOR_NAME)
            .submitToMember(
                { taskType: 'sleep', input: { delayMs: 300, result: 'done' } },
                workerNode.instance.getCluster().getLocalMember(),
            )
            .get();

        await waitUntil(() => workerNode.container.getStats().started === 1);
        submitterInstance.shutdown();

        await waitUntil(() => workerNode.instance.getCluster().getMembers().length === 1);
        await waitUntil(() => workerNode.container.getStats().taskLost === 1);
        await waitUntil(() => workerNode.container.getStats().lateResultsDropped === 1, 2_000);

        rejectPendingOperationResponses(submitterInstance, 'submitter shut down during member-loss test');
        await expect(resultPromise).rejects.toBeInstanceOf(Error);
    });
});
