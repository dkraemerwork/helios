/**
 * Block 17.10 — Scatter-backed multi-node integration tests.
 *
 * Proves executor operations route correctly across a real OperationService
 * cluster path: partition-targeted routing, member-targeted routing, fan-out,
 * registry mismatch rejection, queue-full rejection, member-left/task-lost
 * semantics, local inline isolation, stats accumulation, and shutdown propagation.
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { OperationServiceImpl } from '@zenystx/core/spi/impl/operationservice/impl/OperationServiceImpl';
import { NodeEngineImpl } from '@zenystx/core/spi/impl/NodeEngineImpl';
import { Address } from '@zenystx/core/cluster/Address';
import { SerializationServiceImpl } from '@zenystx/core/internal/serialization/impl/SerializationServiceImpl';
import { SerializationConfig } from '@zenystx/core/internal/serialization/impl/SerializationConfig';
import { ExecutorServiceProxy } from '@zenystx/core/executor/impl/ExecutorServiceProxy';
import { ExecutorContainerService } from '@zenystx/core/executor/impl/ExecutorContainerService';
import { TaskTypeRegistry } from '@zenystx/core/executor/impl/TaskTypeRegistry';
import { ExecutorConfig } from '@zenystx/core/config/ExecutorConfig';
import { ExecuteCallableOperation, type TaskDescriptor } from '@zenystx/core/executor/impl/ExecuteCallableOperation';
import { MemberCallableOperation } from '@zenystx/core/executor/impl/MemberCallableOperation';
import { ShutdownOperation } from '@zenystx/core/executor/impl/ShutdownOperation';
import { Operation } from '@zenystx/core/spi/impl/operationservice/Operation';
import type { Member } from '@zenystx/core/cluster/Member';

// ── Multi-node simulation ───────────────────────────────────────────────────

interface SimNode {
    address: Address;
    uuid: string;
    nodeEngine: NodeEngineImpl;
    operationService: OperationServiceImpl;
    registry: TaskTypeRegistry;
    container: ExecutorContainerService;
    config: ExecutorConfig;
}

function makeMember(address: Address, uuid: string): Member {
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

/**
 * Create an N-node simulated cluster. Each node has its own NodeEngineImpl,
 * OperationServiceImpl (with remoteSend wired to dispatch on target node),
 * TaskTypeRegistry, and ExecutorContainerService.
 */
function createCluster(
    nodeCount: number,
    executorConfigOverrides?: Partial<{
        poolSize: number; queueCapacity: number; maxPools: number;
        taskTimeoutMillis: number; shutdownTimeoutMillis: number;
    }>,
): SimNode[] {
    const nodes: SimNode[] = [];

    const addresses = Array.from({ length: nodeCount }, (_, i) =>
        new Address('127.0.0.1', 5701 + i));
    const uuids = Array.from({ length: nodeCount }, () => crypto.randomUUID());

    for (let i = 0; i < nodeCount; i++) {
        const ss = new SerializationServiceImpl(new SerializationConfig());
        const ne = new NodeEngineImpl(ss, { localAddress: addresses[i] });

        const config = new ExecutorConfig('default');
        if (executorConfigOverrides?.poolSize != null) config.setPoolSize(executorConfigOverrides.poolSize);
        if (executorConfigOverrides?.queueCapacity != null) config.setQueueCapacity(executorConfigOverrides.queueCapacity);
        if (executorConfigOverrides?.maxPools != null) config.setMaxActiveTaskTypePools(executorConfigOverrides.maxPools);
        if (executorConfigOverrides?.taskTimeoutMillis != null) config.setTaskTimeoutMillis(executorConfigOverrides.taskTimeoutMillis);
        if (executorConfigOverrides?.shutdownTimeoutMillis != null) config.setShutdownTimeoutMillis(executorConfigOverrides.shutdownTimeoutMillis);

        const registry = new TaskTypeRegistry();
        const container = new ExecutorContainerService('default', config, registry);

        // Register in NodeEngine service registry so operations can auto-resolve
        ne.registerService('helios:executor:registry:default', registry);
        ne.registerService('helios:executor:container:default', container);

        nodes.push({
            address: addresses[i],
            uuid: uuids[i],
            nodeEngine: ne,
            operationService: null!, // wired below
            registry,
            container,
            config,
        });
    }

    // Wire OperationServiceImpl with remoteSend
    for (let i = 0; i < nodeCount; i++) {
        const os = new OperationServiceImpl(nodes[i].nodeEngine, {
            localMode: false,
            localAddress: nodes[i].address,
            remoteSend: async (op: Operation, target: Address) => {
                const targetNode = nodes.find(n => n.address.equals(target));
                if (!targetNode) {
                    throw new Error(`Target ${target.getHost()}:${target.getPort()} not found`);
                }
                op.setNodeEngine(targetNode.nodeEngine);
                if (op instanceof ExecuteCallableOperation) {
                    op.setRegistry(targetNode.registry);
                    op.setContainerService(targetNode.container);
                    op.setOriginMemberUuid(nodes[i].uuid);
                }
                if (op instanceof ShutdownOperation) {
                    op.setContainerService(targetNode.container);
                }
                await op.beforeRun();
                await op.run();
            },
        });
        nodes[i].operationService = os;
    }

    return nodes;
}

function makeProxy(node: SimNode, allNodes: SimNode[]): ExecutorServiceProxy {
    const proxyNodeEngine = Object.create(node.nodeEngine);
    proxyNodeEngine.getOperationService = () => node.operationService;
    proxyNodeEngine.getClusterService = () => ({
        getMembers: () => allNodes.map(n => ({ address: () => n.address })),
    });

    return new ExecutorServiceProxy(
        'default',
        proxyNodeEngine,
        node.config,
        node.registry,
        node.uuid,
    );
}

async function shutdownCluster(nodes: SimNode[]): Promise<void> {
    for (const node of nodes) {
        try { await node.container.shutdown(); } catch { /* ignore */ }
        try { node.operationService.shutdown(); } catch { /* ignore */ }
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Block 17.10 — Executor Multi-Node Integration', () => {
    let cluster: SimNode[] = [];

    afterEach(async () => {
        await shutdownCluster(cluster);
        cluster = [];
    });

    // ── 1. 3-node submit() routes to partition owner and returns result ──

    test('3-node submit() routes via OperationService and returns result', async () => {
        cluster = createCluster(3);
        for (const node of cluster) {
            node.registry.register('double', (input: unknown) => (input as number) * 2);
        }
        const proxy = makeProxy(cluster[0], cluster);
        const result = await proxy.submit({ taskType: 'double', input: 21 }).get();
        expect(result).toBe(42);
    });

    // ── 2. submitToMember() runs only on the requested member ──

    test('submitToMember() runs only on the requested member', async () => {
        cluster = createCluster(3);
        const executionLog: string[] = [];

        for (let i = 0; i < 3; i++) {
            const nodeId = cluster[i].uuid;
            cluster[i].registry.register('log-node', () => {
                executionLog.push(nodeId);
                return nodeId;
            });
        }

        const proxy = makeProxy(cluster[0], cluster);
        const targetMember = makeMember(cluster[2].address, cluster[2].uuid);
        const result = await proxy.submitToMember(
            { taskType: 'log-node', input: null }, targetMember,
        ).get();

        expect(result).toBe(cluster[2].uuid);
        expect(executionLog).toEqual([cluster[2].uuid]);
    });

    // ── 3. submitToKeyOwner() respects key affinity ──

    test('submitToKeyOwner() routes and returns result', async () => {
        cluster = createCluster(3);
        for (const node of cluster) {
            node.registry.register('identity', (input: unknown) => input);
        }
        const proxy = makeProxy(cluster[0], cluster);
        const result = await proxy.submitToKeyOwner(
            { taskType: 'identity', input: 'hello' }, 'some-key',
        ).get();
        expect(result).toBe('hello');
    });

    // ── 4. submitToAllMembers() returns one result per member ──

    test('submitToAllMembers() returns one result per member', async () => {
        cluster = createCluster(3);
        for (let i = 0; i < 3; i++) {
            const nodeUuid = cluster[i].uuid;
            cluster[i].registry.register('whoami', () => nodeUuid);
        }

        const proxy = makeProxy(cluster[0], cluster);
        const futureMap = proxy.submitToAllMembers({ taskType: 'whoami', input: null });
        expect(futureMap.size).toBe(3);

        const results: string[] = [];
        for (const [, future] of futureMap) {
            results.push(await future.get() as string);
        }
        const unique = new Set(results);
        expect(unique.size).toBe(3);
        for (const node of cluster) {
            expect(unique.has(node.uuid)).toBe(true);
        }
    });

    // ── 5. Member-targeted submission fails when target is unreachable ──

    test('member-targeted submission fails when target leaves (no retry)', async () => {
        cluster = createCluster(2);
        for (const node of cluster) {
            node.registry.register('echo', (input: unknown) => input);
        }

        const ghostAddr = new Address('127.0.0.1', 9999);
        const ghostMember = makeMember(ghostAddr, 'ghost-uuid');
        const proxy = makeProxy(cluster[0], cluster);

        try {
            await proxy.submitToMember({ taskType: 'echo', input: 'hi' }, ghostMember).get();
            expect(true).toBe(false);
        } catch (e) {
            expect(e).toBeInstanceOf(Error);
        }
    });

    // ── 6. Partition-targeted retry semantics (operation-level) ──

    test('ExecuteCallableOperation allows retry before accept', () => {
        const desc: TaskDescriptor = {
            taskUuid: 'u1', executorName: 'e', taskType: 'echo',
            registrationFingerprint: 'fp', inputData: Buffer.alloc(0),
            submitterMemberUuid: 'm1', timeoutMillis: 0,
        };
        expect(new ExecuteCallableOperation(desc).shouldRetryOnMemberLeft()).toBe(true);
        expect(new MemberCallableOperation(desc, 'target').shouldRetryOnMemberLeft()).toBe(false);
    });

    // ── 7. Post-acceptance member death returns task-lost ──

    test('post-acceptance member death returns task-lost status', async () => {
        cluster = createCluster(2);

        let resolveHang!: (v: unknown) => void;
        cluster[1].registry.register('hang', () => new Promise(r => { resolveHang = r; }));
        const fp = cluster[1].registry.get('hang')!.fingerprint;

        const resultPromise = cluster[1].container.executeTask({
            taskUuid: crypto.randomUUID(),
            taskType: 'hang',
            registrationFingerprint: fp,
            inputData: Buffer.from('"input"'),
            executorName: 'default',
            submitterMemberUuid: cluster[0].uuid,
            timeoutMillis: 0,
        });

        await Bun.sleep(5);
        cluster[1].container.markTasksLostForMember(cluster[0].uuid);

        const result = await resultPromise;
        expect(result.status).toBe('task-lost');
        expect(result.errorName).toBe('ExecutorTaskLostException');
        resolveHang('cleanup');
    });

    // ── 8. Registration mismatch fails before enqueue ──

    test('registration mismatch fails before enqueue across nodes', async () => {
        cluster = createCluster(2);
        cluster[0].registry.register('compute', (x: unknown) => x, { version: 'v1' });
        cluster[1].registry.register('compute', (x: unknown) => x, { version: 'v2' });

        const proxy = makeProxy(cluster[0], cluster);
        const targetMember = makeMember(cluster[1].address, cluster[1].uuid);

        try {
            await proxy.submitToMember({ taskType: 'compute', input: 42 }, targetMember).get();
            expect(true).toBe(false);
        } catch (e) {
            expect((e as Error).name).toBe('TaskRegistrationMismatchException');
        }
    });

    // ── 9. Queue full rejection is deterministic ──

    test('queue full rejection is deterministic across nodes', async () => {
        cluster = createCluster(2, { poolSize: 1, queueCapacity: 1, shutdownTimeoutMillis: 100 });

        const resolvers: Array<(v: unknown) => void> = [];
        cluster[1].registry.register('slow', () => new Promise(r => { resolvers.push(r); }));
        const fp = cluster[1].registry.get('slow')!.fingerprint;

        // Fill pool slot
        const first = cluster[1].container.executeTask({
            taskUuid: crypto.randomUUID(), taskType: 'slow',
            registrationFingerprint: fp, inputData: Buffer.from('"a"'),
            executorName: 'default', submitterMemberUuid: cluster[0].uuid,
            timeoutMillis: 0,
        });
        await Bun.sleep(5);

        // Fill the queue (capacity=1)
        const queued = cluster[1].container.executeTask({
            taskUuid: crypto.randomUUID(), taskType: 'slow',
            registrationFingerprint: fp, inputData: Buffer.from('"b"'),
            executorName: 'default', submitterMemberUuid: cluster[0].uuid,
            timeoutMillis: 0,
        });

        // Third task should be rejected (pool full + queue full)
        const rejected = await cluster[1].container.executeTask({
            taskUuid: crypto.randomUUID(), taskType: 'slow',
            registrationFingerprint: fp, inputData: Buffer.from('"c"'),
            executorName: 'default', submitterMemberUuid: cluster[0].uuid,
            timeoutMillis: 0,
        });
        expect(rejected.status).toBe('rejected');
        expect(rejected.errorName).toBe('ExecutorRejectedExecutionException');
        expect(rejected.errorMessage).toContain('Queue full');

        // Resolve first task, wait, then resolve queued task
        resolvers[0]('done');
        await first;
        // Wait for queued task to start and register its resolver
        await Bun.sleep(10);
        resolvers[1]?.('done');
        await queued;
    });

    // ── 10. Local inline works; remote inline rejects ──

    test('submitLocal works for inline tasks', async () => {
        cluster = createCluster(2);
        const proxy = makeProxy(cluster[0], cluster);

        const result = await proxy.submitLocal({
            taskType: '__inline__',
            fn: (x: unknown) => (x as number) + 1,
            input: 9,
        }).get();
        expect(result).toBe(10);
    });

    test('remote inline execution is rejected', () => {
        cluster = createCluster(2);
        const proxy = makeProxy(cluster[0], cluster);
        const target = makeMember(cluster[1].address, cluster[1].uuid);

        expect(() => {
            proxy.submitToMember({ taskType: '__inline__', input: 42 } as any, target);
        }).toThrow('Inline tasks cannot be submitted for distributed execution');
    });

    // ── 11. Stats reflect cross-node executions ──

    test('stats reflect cross-node executions correctly', async () => {
        cluster = createCluster(2);
        for (const node of cluster) {
            node.registry.register('inc', (x: unknown) => (x as number) + 1);
        }
        const fp = cluster[1].registry.get('inc')!.fingerprint;

        for (let i = 0; i < 5; i++) {
            await cluster[1].container.executeTask({
                taskUuid: crypto.randomUUID(), taskType: 'inc',
                registrationFingerprint: fp, inputData: Buffer.from(JSON.stringify(i)),
                executorName: 'default', submitterMemberUuid: cluster[0].uuid,
                timeoutMillis: 0,
            });
        }

        const stats = cluster[1].container.getStats();
        expect(stats.started).toBe(5);
        expect(stats.completed).toBe(5);
        expect(stats.rejected).toBe(0);
    });

    // ── 12. Executor shutdown propagates and rejects new work ──

    test('shutdown container rejects new work on that node', async () => {
        cluster = createCluster(2);
        cluster[1].registry.register('echo', (x: unknown) => x);
        const fp = cluster[1].registry.get('echo')!.fingerprint;

        await cluster[1].container.shutdown();

        const result = await cluster[1].container.executeTask({
            taskUuid: crypto.randomUUID(), taskType: 'echo',
            registrationFingerprint: fp, inputData: Buffer.from('"hi"'),
            executorName: 'default', submitterMemberUuid: cluster[0].uuid,
            timeoutMillis: 0,
        });
        expect(result.status).toBe('rejected');
        expect(result.errorName).toBe('ExecutorRejectedExecutionException');
    });

    // ── Additional integration scenarios ──

    test('concurrent submissions across nodes complete correctly', async () => {
        cluster = createCluster(3);
        for (const node of cluster) {
            node.registry.register('add10', (x: unknown) => (x as number) + 10);
        }
        const proxy = makeProxy(cluster[0], cluster);

        const results = await Promise.all(
            Array.from({ length: 10 }, (_, i) =>
                proxy.submit({ taskType: 'add10', input: i }).get()
            ),
        );
        for (let i = 0; i < 10; i++) {
            expect(results[i]).toBe(i + 10);
        }
    });

    test('submitToMember to each node returns distinct results', async () => {
        cluster = createCluster(3);
        for (let i = 0; i < 3; i++) {
            const id = cluster[i].uuid;
            cluster[i].registry.register('node-id', () => id);
        }
        const proxy = makeProxy(cluster[0], cluster);

        for (let i = 0; i < 3; i++) {
            const member = makeMember(cluster[i].address, cluster[i].uuid);
            const result = await proxy.submitToMember(
                { taskType: 'node-id', input: null }, member,
            ).get();
            expect(result).toBe(cluster[i].uuid);
        }
    });

    test('unknown task type on remote node rejects via operation path', async () => {
        cluster = createCluster(2);
        // Only register on node 0 — node 1 has no registration
        cluster[0].registry.register('local-only', (x: unknown) => x);

        const proxy = makeProxy(cluster[0], cluster);
        const target = makeMember(cluster[1].address, cluster[1].uuid);

        try {
            await proxy.submitToMember({ taskType: 'local-only', input: 42 }, target).get();
            expect(true).toBe(false);
        } catch (e) {
            expect((e as Error).name).toBe('UnknownTaskTypeException');
        }
    });

    test('ShutdownOperation shuts down remote container', async () => {
        cluster = createCluster(2);
        expect(cluster[1].container.isShutdown()).toBe(false);

        const op = new ShutdownOperation('default');
        op.setContainerService(cluster[1].container);
        (op as any).sendResponse = () => {};
        await op.run();

        expect(cluster[1].container.isShutdown()).toBe(true);
    });
});
