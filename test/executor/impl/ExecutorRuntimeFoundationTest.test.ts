/**
 * Block 17.0 — Executor Runtime Foundation Tests
 *
 * Tests the runtime gaps that must be closed before the executor API layers:
 * - PartitionService extended with getPartitionOwner()
 * - NodeEngine extended with getLocalAddress(), getClusterService()
 * - OperationServiceImpl remote invocation path
 * - HeliosInstance async shutdown with graceful drain hooks
 * - Binary operation payload round-trip over transport
 */
import { Address } from '@zenystx/helios-core/cluster/Address';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';
import { NodeEngineImpl } from '@zenystx/helios-core/spi/impl/NodeEngineImpl';
import { OperationServiceImpl } from '@zenystx/helios-core/spi/impl/operationservice/impl/OperationServiceImpl';
import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import type { NodeEngine } from '@zenystx/helios-core/spi/NodeEngine';
import type { PartitionService } from '@zenystx/helios-core/spi/PartitionService';
import { describe, expect, test } from 'bun:test';

// ── Test helpers ────────────────────────────────────────────────────────────

class EchoOperation extends Operation {
    result: unknown;

    constructor(private readonly _value: unknown) {
        super();
    }

    async run(): Promise<void> {
        this.result = this._value;
        this.sendResponse(this._value);
    }
}

class FailingOperation extends Operation {
    constructor(private readonly _errorMessage: string) {
        super();
    }

    async run(): Promise<void> {
        throw new Error(this._errorMessage);
    }
}

class SlowOperation extends Operation {
    constructor(private readonly _delayMs: number, private readonly _value: unknown) {
        super();
    }

    async run(): Promise<void> {
        await new Promise(r => setTimeout(r, this._delayMs));
        this.sendResponse(this._value);
    }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('ExecutorRuntimeFoundation', () => {

    describe('PartitionService extended interface', () => {
        test('getPartitionOwner() returns owner address for partition', () => {
            const ps = createTestPartitionService();
            const owner = ps.getPartitionOwner(0);
            expect(owner).toBeInstanceOf(Address);
            expect(owner).not.toBeNull();
        });

        test('isMigrating() returns boolean for partition', () => {
            const ps = createTestPartitionService();
            expect(typeof ps.isMigrating(0)).toBe('boolean');
        });
    });

    describe('NodeEngine extended interface', () => {
        test('getLocalAddress() returns the node address', () => {
            const ne = createTestNodeEngine();
            const addr = ne.getLocalAddress();
            expect(addr).toBeInstanceOf(Address);
        });

        test('getClusterService() returns a cluster service with getMembers()', () => {
            const ne = createTestNodeEngine();
            const cs = ne.getClusterService();
            expect(cs).toBeDefined();
            expect(typeof cs.getMembers).toBe('function');
        });
    });

    describe('OperationServiceImpl remote invocation path', () => {
        test('invokeOnTarget succeeds for local address target', async () => {
            const localAddr = new Address('127.0.0.1', 5701);
            const ne = createTestNodeEngine(localAddr);
            const os = new OperationServiceImpl(ne, {
                localMode: false,
                localAddress: localAddr,
            });

            const op = new EchoOperation('hello');
            const future = os.invokeOnTarget<string>('test:service', op, localAddr);
            const result = await future.get();
            expect(result).toBe('hello');
        });

        test('invokeOnPartition routes to partition owner and returns result', async () => {
            const localAddr = new Address('127.0.0.1', 5701);
            const ne = createTestNodeEngine(localAddr);
            const os = new OperationServiceImpl(ne, {
                localMode: false,
                localAddress: localAddr,
            });

            const op = new EchoOperation(42);
            const future = os.invokeOnPartition<number>('test:service', op, 0);
            const result = await future.get();
            expect(result).toBe(42);
        });

        test('response correlates by callId', async () => {
            const localAddr = new Address('127.0.0.1', 5701);
            const ne = createTestNodeEngine(localAddr);
            const os = new OperationServiceImpl(ne, {
                localMode: false,
                localAddress: localAddr,
            });

            // Launch two concurrent operations
            const op1 = new EchoOperation('first');
            const op2 = new EchoOperation('second');
            const f1 = os.invokeOnTarget<string>('test:service', op1, localAddr);
            const f2 = os.invokeOnTarget<string>('test:service', op2, localAddr);

            const [r1, r2] = await Promise.all([f1.get(), f2.get()]);
            expect(r1).toBe('first');
            expect(r2).toBe('second');
        });

        test('remote error propagation preserves error message', async () => {
            const localAddr = new Address('127.0.0.1', 5701);
            const ne = createTestNodeEngine(localAddr);
            const os = new OperationServiceImpl(ne, {
                localMode: false,
                localAddress: localAddr,
            });

            const op = new FailingOperation('computation failed');
            const future = os.invokeOnTarget<void>('test:service', op, localAddr);

            await expect(future.get()).rejects.toThrow('computation failed');
        });

        test('migration guard rejects during partition migration', async () => {
            const localAddr = new Address('127.0.0.1', 5701);
            const ne = createTestNodeEngine(localAddr, { migratingPartitions: new Set([5]) });
            const os = new OperationServiceImpl(ne, {
                localMode: false,
                localAddress: localAddr,
                invocationTryCount: 1,
            });

            const op = new EchoOperation('should-not-reach');
            op.partitionId = 5;
            const future = os.invokeOnPartition<string>('test:service', op, 5);

            await expect(future.get()).rejects.toThrow();
        });
    });

    describe('Graceful shutdown hooks', () => {
        test('shutdownAsync() awaits registered shutdown hooks', async () => {
            const config = new HeliosConfig();
            const instance = new HeliosInstanceImpl(config);

            let hookCalled = false;
            instance.registerShutdownHook(async () => {
                await new Promise(r => setTimeout(r, 10));
                hookCalled = true;
            });

            await instance.shutdownAsync();
            expect(hookCalled).toBe(true);
            expect(instance.isRunning()).toBe(false);
        });

        test('shutdown() still works as sync compatibility wrapper', () => {
            const config = new HeliosConfig();
            const instance = new HeliosInstanceImpl(config);
            instance.shutdown();
            expect(instance.isRunning()).toBe(false);
        });

        test('multiple shutdown hooks are all awaited', async () => {
            const config = new HeliosConfig();
            const instance = new HeliosInstanceImpl(config);

            const order: number[] = [];
            instance.registerShutdownHook(async () => {
                await new Promise(r => setTimeout(r, 5));
                order.push(1);
            });
            instance.registerShutdownHook(async () => {
                order.push(2);
            });

            await instance.shutdownAsync();
            expect(order).toContain(1);
            expect(order).toContain(2);
        });
    });

    describe('Binary operation payload round-trip', () => {
        test('operation payload survives serialization through toData/toObject', () => {
            const config = new HeliosConfig();
            const instance = new HeliosInstanceImpl(config);
            const ne = instance.getNodeEngine();
            const ss = ne.getSerializationService();

            const payload = { taskType: 'fibonacci', input: 42, version: 'v1' };
            const data = ss.toData(payload);
            expect(data).not.toBeNull();

            const restored = ss.toObject<typeof payload>(data!);
            expect(restored).toEqual(payload);

            instance.shutdown();
        });
    });
});

// ── Factory helpers ─────────────────────────────────────────────────────────

function createTestPartitionService(opts?: { migratingPartitions?: Set<number> }): PartitionService & { getPartitionOwner(id: number): Address; isMigrating(id: number): boolean } {
    const { NodeEngineImpl: NEI } = require('@zenystx/helios-core/spi/impl/NodeEngineImpl');
    const { SerializationServiceImpl: SSI } = require('@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl');
    const { SerializationConfig: SC } = require('@zenystx/helios-core/internal/serialization/impl/SerializationConfig');
    const ne = new NEI(new SSI(new SC())) as NodeEngineImpl;

    const localAddr = new Address('127.0.0.1', 5701);

    // Set local address on NodeEngine so partition service can resolve ownership
    if (typeof (ne as any).setLocalAddress === 'function') {
        (ne as any).setLocalAddress(localAddr);
    }

    const ps = ne.getPartitionService() as any;
    return ps;
}

function createTestNodeEngine(localAddr?: Address, opts?: { migratingPartitions?: Set<number> }): NodeEngine & { getLocalAddress(): Address; getClusterService(): { getMembers(): unknown[] } } {
    const { SerializationServiceImpl: SSI } = require('@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl');
    const { SerializationConfig: SC } = require('@zenystx/helios-core/internal/serialization/impl/SerializationConfig');
    const ne = new NodeEngineImpl(new SSI(new SC()), {
        localAddress: localAddr ?? new Address('127.0.0.1', 5701),
        migratingPartitions: opts?.migratingPartitions,
    }) as any;
    return ne;
}
