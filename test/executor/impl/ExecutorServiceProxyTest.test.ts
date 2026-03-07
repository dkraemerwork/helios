/**
 * Block 17.6 — ExecutorServiceProxy tests.
 *
 * Tests routing, result unwrapping, fan-out, local inline fast path,
 * CancellableFuture.cancel() routing, and error semantics.
 */
import type { Address } from '@zenystx/helios-core/cluster/Address.js';
import type { Member } from '@zenystx/helios-core/cluster/Member.js';
import { ExecutorConfig } from '@zenystx/helios-core/config/ExecutorConfig.js';
import type { ExecutorOperationResult } from '@zenystx/helios-core/executor/ExecutorOperationResult.js';
import { ExecutorServiceProxy } from '@zenystx/helios-core/executor/impl/ExecutorServiceProxy.js';
import { TaskTypeRegistry } from '@zenystx/helios-core/executor/impl/TaskTypeRegistry.js';
import type { InlineTaskCallable, TaskCallable } from '@zenystx/helios-core/executor/TaskCallable.js';
import { Bits } from '@zenystx/helios-core/internal/nio/Bits.js';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data.js';
import { HeapData } from '@zenystx/helios-core/internal/serialization/impl/HeapData.js';
import type { SerializationService } from '@zenystx/helios-core/internal/serialization/SerializationService.js';
import { InvocationFuture } from '@zenystx/helios-core/spi/impl/operationservice/InvocationFuture.js';
import type { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation.js';
import type { OperationService } from '@zenystx/helios-core/spi/impl/operationservice/OperationService.js';
import type { NodeEngine } from '@zenystx/helios-core/spi/NodeEngine.js';
import type { PartitionService } from '@zenystx/helios-core/spi/PartitionService.js';
import { beforeEach, describe, expect, test } from 'bun:test';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeAddress(host: string, port: number): Address {
    return {
        getHost: () => host,
        getPort: () => port,
        toString: () => `${host}:${port}`,
        equals: (other: Address) => other.getHost() === host && other.getPort() === port,
    } as Address;
}

function makeMember(uuid: string, address: Address, local = false): Member {
    return {
        getUuid: () => uuid,
        getAddress: () => address,
        localMember: () => local,
        isLiteMember: () => false,
        getAddressMap: () => new Map(),
        getAttributes: () => new Map(),
        getAttribute: () => null,
        getVersion: () => ({ getMajor: () => 1, getMinor: () => 0, getPatch: () => 0 }),
    } as unknown as Member;
}

function wrapAsHeapData(value: unknown): HeapData {
    const json = JSON.stringify(value);
    const payload = Buffer.from(json);
    const buf = Buffer.alloc(HeapData.HEAP_DATA_OVERHEAD + payload.length);
    Bits.writeIntB(buf, HeapData.PARTITION_HASH_OFFSET, 0);
    Bits.writeIntB(buf, HeapData.TYPE_OFFSET, -130);
    payload.copy(buf, HeapData.DATA_OFFSET);
    return new HeapData(buf);
}

function successEnvelope(taskUuid: string, value: unknown, originMember = 'member-1'): ExecutorOperationResult {
    return {
        taskUuid,
        status: 'success',
        originMemberUuid: originMember,
        resultData: wrapAsHeapData(value),
        errorName: null,
        errorMessage: null,
    };
}

function rejectedEnvelope(taskUuid: string, errorName: string, errorMessage: string): ExecutorOperationResult {
    return {
        taskUuid,
        status: 'rejected',
        originMemberUuid: '',
        resultData: null,
        errorName,
        errorMessage,
    };
}

// ── Mock infrastructure ─────────────────────────────────────────────────────

function createMockNodeEngine(opts: {
    members?: Member[];
    localAddress?: Address;
    localMemberUuid?: string;
}): NodeEngine & { lastInvokedOp: Operation | null; lastInvokedPartition: number; lastInvokedTarget: Address | null; invokeResult: ExecutorOperationResult | null } {
    const addr = opts.localAddress ?? makeAddress('127.0.0.1', 5701);
    const members = opts.members ?? [];

    const mockNe = {
        lastInvokedOp: null as Operation | null,
        lastInvokedPartition: -1,
        lastInvokedTarget: null as Address | null,
        invokeResult: null as ExecutorOperationResult | null,

        getOperationService(): OperationService {
            return {
                run: async () => {},
                execute: () => {},
                invokeOnPartition: <T>(_sn: string, op: Operation, partitionId: number): InvocationFuture<T> => {
                    mockNe.lastInvokedOp = op;
                    mockNe.lastInvokedPartition = partitionId;
                    const f = new InvocationFuture<T>();
                    if (mockNe.invokeResult) {
                        queueMicrotask(() => f.complete(mockNe.invokeResult as T));
                    }
                    return f;
                },
                invokeOnTarget: <T>(_sn: string, op: Operation, target: Address): InvocationFuture<T> => {
                    mockNe.lastInvokedOp = op;
                    mockNe.lastInvokedTarget = target;
                    const f = new InvocationFuture<T>();
                    if (mockNe.invokeResult) {
                        queueMicrotask(() => f.complete(mockNe.invokeResult as T));
                    }
                    return f;
                },
            };
        },
        getPartitionService(): PartitionService {
            return {
                getPartitionCount: () => 271,
                getPartitionId: (_key: Data) => 42,
                getPartitionOwner: (_id: number) => addr,
                isMigrating: () => false,
            };
        },
        getSerializationService(): SerializationService {
            return {
                toData: (obj: unknown): Data | null => {
                    if (obj === null || obj === undefined) return null;
                    return wrapAsHeapData(obj);
                },
                toObject: <T>(data: Data | null): T | null => {
                    if (!data) return null;
                    const buf = (data as HeapData).toByteArray()!;
                    const payload = buf.subarray(HeapData.DATA_OFFSET);
                    return JSON.parse(payload.toString('utf8')) as T;
                },
            } as SerializationService;
        },
        getClusterService() {
            return {
                getMembers: () => members.map(m => ({ address: () => m.getAddress() })),
            };
        },
        getLocalAddress: () => addr,
        getLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
        isRunning: () => true,
        isStartCompleted: () => true,
        getService: () => { throw new Error('not impl'); },
        getServiceOrNull: () => null,
        toData: (obj: unknown) => wrapAsHeapData(obj),
        toObject: <T>(data: Data | null): T | null => {
            if (!data) return null;
            const buf = (data as HeapData).toByteArray()!;
            const payload = buf.subarray(HeapData.DATA_OFFSET);
            return JSON.parse(payload.toString('utf8')) as T;
        },
        getProperties: () => ({ getBoolean: () => false, getInteger: () => 0, getString: () => '', getLong: () => 0n }),
    };
    return mockNe as unknown as NodeEngine & typeof mockNe;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('ExecutorServiceProxy', () => {
    const executorName = 'test-executor';
    let config: ExecutorConfig;
    let registry: TaskTypeRegistry;
    let localAddr: Address;
    let localMember: Member;
    let remoteMember: Member;

    beforeEach(() => {
        config = new ExecutorConfig(executorName).setPoolSize(4).setQueueCapacity(16);
        config.setExecutionBackend('inline');
        registry = new TaskTypeRegistry();
        localAddr = makeAddress('127.0.0.1', 5701);
        localMember = makeMember('local-uuid', localAddr, true);
        remoteMember = makeMember('remote-uuid', makeAddress('127.0.0.1', 5702), false);
    });

    test('submit routes to partition owner and returns typed result', async () => {
        registry.register('double', (n) => Number(n) * 2, { version: 'v1' });
        const ne = createMockNodeEngine({ localAddress: localAddr, localMemberUuid: 'local-uuid' });
        ne.invokeResult = successEnvelope('task-1', 84);

        const proxy = new ExecutorServiceProxy(executorName, ne, config, registry, 'local-uuid');
        const task: TaskCallable<number> = { taskType: 'double', input: 42 };
        const future = proxy.submit(task);
        const result = await future.get();

        expect(result).toBe(84);
        expect(ne.lastInvokedPartition).toBe(42); // partition from mock
    });

    test('submitToMember routes to fixed target member', async () => {
        registry.register('echo', (x) => x, { version: 'v1' });
        const ne = createMockNodeEngine({ localAddress: localAddr, members: [localMember, remoteMember] });
        ne.invokeResult = successEnvelope('task-2', 'hello');

        const proxy = new ExecutorServiceProxy(executorName, ne, config, registry, 'local-uuid');
        const future = proxy.submitToMember({ taskType: 'echo', input: 'hello' }, remoteMember);
        const result = await future.get();

        expect(result).toBe('hello');
        expect(ne.lastInvokedTarget!.getPort()).toBe(5702);
    });

    test('submitToKeyOwner routes to key owner partition', async () => {
        registry.register('echo', (x) => x, { version: 'v1' });
        const ne = createMockNodeEngine({ localAddress: localAddr });
        ne.invokeResult = successEnvelope('task-3', 'world');

        const proxy = new ExecutorServiceProxy(executorName, ne, config, registry, 'local-uuid');
        const future = proxy.submitToKeyOwner({ taskType: 'echo', input: 'world' }, 'my-key');
        const result = await future.get();

        expect(result).toBe('world');
        expect(ne.lastInvokedPartition).toBe(42);
    });

    test('submitToAllMembers fans out and collects results', async () => {
        registry.register('echo', (x) => x, { version: 'v1' });
        const ne = createMockNodeEngine({ localAddress: localAddr, members: [localMember, remoteMember] });
        ne.invokeResult = successEnvelope('task-fan', 'ok');

        const proxy = new ExecutorServiceProxy(executorName, ne, config, registry, 'local-uuid');
        const results = proxy.submitToAllMembers({ taskType: 'echo', input: 'broadcast' });

        expect(results.size).toBe(2);
        for (const [_member, future] of results) {
            const val = await future.get();
            expect(val).toBe('ok');
        }
    });

    test('submitToMembers fans out to selected members', async () => {
        registry.register('echo', (x) => x, { version: 'v1' });
        const ne = createMockNodeEngine({ localAddress: localAddr, members: [localMember, remoteMember] });
        ne.invokeResult = successEnvelope('task-sel', 'sel');

        const proxy = new ExecutorServiceProxy(executorName, ne, config, registry, 'local-uuid');
        const results = proxy.submitToMembers({ taskType: 'echo', input: 'select' }, [remoteMember]);

        expect(results.size).toBe(1);
        const [, future] = [...results.entries()][0];
        const val = await future.get();
        expect(val).toBe('sel');
    });

    test('proxy unwraps Data to T (deserialization)', async () => {
        registry.register('obj-task', (x) => ({ doubled: Number(x) * 2 }), { version: 'v1' });
        const ne = createMockNodeEngine({ localAddress: localAddr });
        ne.invokeResult = successEnvelope('task-deser', { doubled: 100 });

        const proxy = new ExecutorServiceProxy(executorName, ne, config, registry, 'local-uuid');
        const future = proxy.submit<{ doubled: number }>({ taskType: 'obj-task', input: 50 });
        const result = await future.get();

        expect(result).toEqual({ doubled: 100 });
    });

    test('registration mismatch surfaces clean error to caller', async () => {
        registry.register('task-a', (x) => x, { version: 'v1' });
        const ne = createMockNodeEngine({ localAddress: localAddr });
        ne.invokeResult = rejectedEnvelope('task-mm', 'TaskRegistrationMismatchException', 'Fingerprint mismatch');

        const proxy = new ExecutorServiceProxy(executorName, ne, config, registry, 'local-uuid');
        const future = proxy.submit({ taskType: 'task-a', input: 1 });

        await expect(future.get()).rejects.toThrow('Fingerprint mismatch');
    });

    test('unregistered task type rejects before sending operation', () => {
        const ne = createMockNodeEngine({ localAddress: localAddr });
        const proxy = new ExecutorServiceProxy(executorName, ne, config, registry, 'local-uuid');

        expect(() => proxy.submit({ taskType: 'nonexistent', input: 1 })).toThrow();
    });

    test('inline local path executes function locally', async () => {
        const ne = createMockNodeEngine({ localAddress: localAddr });
        const proxy = new ExecutorServiceProxy(executorName, ne, config, registry, 'local-uuid');

        const task: InlineTaskCallable<number> = {
            taskType: '__inline__',
            input: 21,
            fn: (n) => Number(n) * 2,
        };
        const future = proxy.submitLocal(task);
        const result = await future.get();
        expect(result).toBe(42);
    });

    test('executeLocal runs inline function fire-and-forget', async () => {
        const ne = createMockNodeEngine({ localAddress: localAddr });
        const proxy = new ExecutorServiceProxy(executorName, ne, config, registry, 'local-uuid');

        let called = false;
        const task: InlineTaskCallable<void> = {
            taskType: '__inline__',
            input: null,
            fn: () => { called = true; },
        };
        proxy.executeLocal(task);
        await Bun.sleep(10);
        expect(called).toBe(true);
    });

    test('distributed submit rejects inline tasks', () => {
        const ne = createMockNodeEngine({ localAddress: localAddr });
        const proxy = new ExecutorServiceProxy(executorName, ne, config, registry, 'local-uuid');

        const task = { taskType: '__inline__', input: 1, fn: () => 1 } as InlineTaskCallable<number>;
        expect(() => proxy.submit(task as unknown as TaskCallable<number>)).toThrow(/inline/i);
    });

    test('submitToMember rejects inline tasks', () => {
        const ne = createMockNodeEngine({ localAddress: localAddr, members: [remoteMember] });
        const proxy = new ExecutorServiceProxy(executorName, ne, config, registry, 'local-uuid');

        expect(() => proxy.submitToMember({ taskType: '__inline__', input: 1 } as TaskCallable<number>, remoteMember)).toThrow(/inline/i);
    });

    test('CancellableFuture.cancel() cancels the underlying future', async () => {
        registry.register('slow', async () => { await Bun.sleep(10_000); return 0; }, { version: 'v1' });
        const ne = createMockNodeEngine({ localAddress: localAddr });
        // Don't set invokeResult — future stays pending

        const proxy = new ExecutorServiceProxy(executorName, ne, config, registry, 'local-uuid');
        const future = proxy.submit({ taskType: 'slow', input: null });

        expect(future.cancel()).toBe(true);
        expect(future.isCancelled()).toBe(true);
        await expect(future.get()).rejects.toThrow('cancelled');
    });

    test('shutdown rejects new submissions', async () => {
        registry.register('echo', (x) => x, { version: 'v1' });
        const ne = createMockNodeEngine({ localAddress: localAddr });
        const proxy = new ExecutorServiceProxy(executorName, ne, config, registry, 'local-uuid');

        await proxy.shutdown();
        expect(proxy.isShutdown()).toBe(true);
        expect(() => proxy.submit({ taskType: 'echo', input: 1 })).toThrow(/shut.*down/i);
    });

    test('execute fires and forgets without returning future', () => {
        registry.register('echo', (x) => x, { version: 'v1' });
        const ne = createMockNodeEngine({ localAddress: localAddr });
        ne.invokeResult = successEnvelope('task-exec', 99);

        const proxy = new ExecutorServiceProxy(executorName, ne, config, registry, 'local-uuid');
        // execute should not throw and not return
        proxy.execute({ taskType: 'echo', input: 1 });
        expect(ne.lastInvokedPartition).toBe(42);
    });

    test('executeOnMember fires to specific member', () => {
        registry.register('echo', (x) => x, { version: 'v1' });
        const ne = createMockNodeEngine({ localAddress: localAddr, members: [localMember, remoteMember] });
        ne.invokeResult = successEnvelope('task-eom', 0);

        const proxy = new ExecutorServiceProxy(executorName, ne, config, registry, 'local-uuid');
        proxy.executeOnMember({ taskType: 'echo', input: 1 }, remoteMember);
        expect(ne.lastInvokedTarget!.getPort()).toBe(5702);
    });

    test('getLocalExecutorStats returns zeroed stats initially', () => {
        const ne = createMockNodeEngine({ localAddress: localAddr });
        const proxy = new ExecutorServiceProxy(executorName, ne, config, registry, 'local-uuid');

        const stats = proxy.getLocalExecutorStats();
        expect(stats.pending).toBe(0);
        expect(stats.started).toBe(0);
        expect(stats.completed).toBe(0);
        expect(stats.cancelled).toBe(0);
        expect(stats.rejected).toBe(0);
        expect(stats.timedOut).toBe(0);
        expect(stats.taskLost).toBe(0);
    });
});
