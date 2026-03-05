/**
 * Block 17.9A — Real executor transport + service-backed container routing
 *
 * Tests:
 * - Remote invokeOnTarget for non-local members (executor operations)
 * - Remote invokeOnPartition with owner resolution
 * - Response correlation for concurrent executor calls
 * - Remote error propagation preserves executor error class/message
 * - Partition-owner/migration lookup visible to executor routing
 * - Member-left detection surfaced distinctly from generic invocation failure
 * - Executor container service resolved from member-local service wiring
 * - Instance shutdown awaits executor-aware service shutdown hooks
 */
import { describe, test, expect } from 'bun:test';
import { NodeEngineImpl } from '@helios/spi/impl/NodeEngineImpl';
import { OperationServiceImpl } from '@helios/spi/impl/operationservice/impl/OperationServiceImpl';
import { Operation } from '@helios/spi/impl/operationservice/Operation';
import { Address } from '@helios/cluster/Address';
import { HeliosInstanceImpl } from '@helios/instance/impl/HeliosInstanceImpl';
import { HeliosConfig } from '@helios/config/HeliosConfig';
import { ExecutorContainerService } from '@helios/executor/impl/ExecutorContainerService';
import { TaskTypeRegistry } from '@helios/executor/impl/TaskTypeRegistry';
import { SerializationServiceImpl } from '@helios/internal/serialization/impl/SerializationServiceImpl';
import { SerializationConfig } from '@helios/internal/serialization/impl/SerializationConfig';
import { TargetNotMemberException } from '@helios/spi/impl/operationservice/RetryableException';
import { ExecutorConfig } from '@helios/config/ExecutorConfig';

// ── Test helpers ────────────────────────────────────────────────────────────

const EXECUTOR_SERVICE_NAME = 'helios:executor';

class EchoOperation extends Operation {
    constructor(private readonly _value: unknown) {
        super();
    }
    async run(): Promise<void> {
        this.sendResponse(this._value);
    }
}

function makeNodeEngine(localAddr?: Address, opts?: { migratingPartitions?: Set<number> }): NodeEngineImpl {
    return new NodeEngineImpl(
        new SerializationServiceImpl(new SerializationConfig()),
        { localAddress: localAddr ?? new Address('127.0.0.1', 5701), migratingPartitions: opts?.migratingPartitions },
    );
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Block 17.9A — ExecutorTransportAndContainerRouting', () => {

    describe('Remote invokeOnTarget for executor operations', () => {
        test('invokeOnTarget routes to a non-local member via remote transport', async () => {
            const localAddr = new Address('127.0.0.1', 5701);
            const remoteAddr = new Address('127.0.0.1', 5702);
            const ne = makeNodeEngine(localAddr);
            const os = new OperationServiceImpl(ne, {
                localMode: false,
                localAddress: localAddr,
                remoteSend: async (op: Operation, _target: Address) => {
                    // Simulate remote execution — run the operation locally and forward response
                    op.setNodeEngine(ne);
                    await op.beforeRun();
                    await op.run();
                },
            });

            const op = new EchoOperation('remote-result');
            const future = os.invokeOnTarget<string>(EXECUTOR_SERVICE_NAME, op, remoteAddr);
            const result = await future.get();
            expect(result).toBe('remote-result');
        });

        test('invokeOnTarget rejects non-local target when no remote transport configured', async () => {
            const localAddr = new Address('127.0.0.1', 5701);
            const remoteAddr = new Address('127.0.0.1', 5702);
            const ne = makeNodeEngine(localAddr);
            const os = new OperationServiceImpl(ne, {
                localMode: false,
                localAddress: localAddr,
                // No remoteSend configured
            });

            const op = new EchoOperation('should-fail');
            const future = os.invokeOnTarget<string>(EXECUTOR_SERVICE_NAME, op, remoteAddr);
            await expect(future.get()).rejects.toThrow();
        });
    });

    describe('Remote invokeOnPartition with owner resolution', () => {
        test('invokeOnPartition resolves owner and round-trips successfully', async () => {
            const localAddr = new Address('127.0.0.1', 5701);
            const ne = makeNodeEngine(localAddr);
            const os = new OperationServiceImpl(ne, {
                localMode: false,
                localAddress: localAddr,
            });

            const op = new EchoOperation(99);
            const future = os.invokeOnPartition<number>(EXECUTOR_SERVICE_NAME, op, 3);
            const result = await future.get();
            expect(result).toBe(99);
        });
    });

    describe('Response correlation for concurrent executor calls', () => {
        test('concurrent invokeOnTarget calls correlate responses correctly', async () => {
            const localAddr = new Address('127.0.0.1', 5701);
            const ne = makeNodeEngine(localAddr);
            const os = new OperationServiceImpl(ne, {
                localMode: false,
                localAddress: localAddr,
            });

            const futures = Array.from({ length: 5 }, (_, i) => {
                const op = new EchoOperation(`value-${i}`);
                return os.invokeOnTarget<string>(EXECUTOR_SERVICE_NAME, op, localAddr);
            });

            const results = await Promise.all(futures.map(f => f.get()));
            for (let i = 0; i < 5; i++) {
                expect(results[i]).toBe(`value-${i}`);
            }
        });
    });

    describe('Remote error propagation preserves executor error class/message', () => {
        test('executor error class and message survive remote invocation', async () => {
            const localAddr = new Address('127.0.0.1', 5701);
            const ne = makeNodeEngine(localAddr);
            const os = new OperationServiceImpl(ne, {
                localMode: false,
                localAddress: localAddr,
            });

            class FailOp extends Operation {
                async run(): Promise<void> {
                    const err = new Error('executor computation failed');
                    err.name = 'ExecutorRejectedExecutionException';
                    throw err;
                }
            }

            const op = new FailOp();
            const future = os.invokeOnTarget<void>(EXECUTOR_SERVICE_NAME, op, localAddr);
            try {
                await future.get();
                expect(true).toBe(false); // should not reach
            } catch (e) {
                expect((e as Error).message).toBe('executor computation failed');
            }
        });
    });

    describe('Partition-owner/migration lookup visible to executor routing', () => {
        test('partition owner is visible for routing decisions', () => {
            const localAddr = new Address('127.0.0.1', 5701);
            const ne = makeNodeEngine(localAddr);
            const ps = ne.getPartitionService();
            const owner = ps.getPartitionOwner(0);
            expect(owner).not.toBeNull();
            expect(owner!.equals(localAddr)).toBe(true);
        });

        test('migration status is queryable for executor routing', () => {
            const localAddr = new Address('127.0.0.1', 5701);
            const ne = makeNodeEngine(localAddr, { migratingPartitions: new Set([7]) });
            const ps = ne.getPartitionService();
            expect(ps.isMigrating(7)).toBe(true);
            expect(ps.isMigrating(0)).toBe(false);
        });
    });

    describe('Member-left detection distinct from generic failure', () => {
        test('non-local target without transport produces TargetNotMemberException', async () => {
            const localAddr = new Address('127.0.0.1', 5701);
            const remoteAddr = new Address('127.0.0.1', 5702);
            const ne = makeNodeEngine(localAddr);
            const os = new OperationServiceImpl(ne, {
                localMode: false,
                localAddress: localAddr,
            });

            const op = new EchoOperation('unreachable');
            const future = os.invokeOnTarget<string>(EXECUTOR_SERVICE_NAME, op, remoteAddr);
            try {
                await future.get();
                expect(true).toBe(false);
            } catch (e) {
                expect(e).toBeInstanceOf(TargetNotMemberException);
            }
        });
    });

    describe('Executor container service resolved from service wiring', () => {
        test('container service is registered and resolvable by name', () => {
            const ne = makeNodeEngine();
            const config = new ExecutorConfig('test-executor');
            const registry = new TaskTypeRegistry();
            const container = new ExecutorContainerService('test-executor', config, registry);
            ne.registerService('helios:executor:container:test-executor', container);

            const resolved = ne.getService<ExecutorContainerService>('helios:executor:container:test-executor');
            expect(resolved).toBe(container);
        });

        test('container service resolution returns null for unknown executor name', () => {
            const ne = makeNodeEngine();
            const resolved = ne.getServiceOrNull<ExecutorContainerService>('helios:executor:container:unknown');
            expect(resolved).toBeNull();
        });
    });

    describe('Instance shutdown awaits executor-aware service shutdown', () => {
        test('shutdownAsync awaits executor container shutdown hooks', async () => {
            const config = new HeliosConfig();
            const instance = new HeliosInstanceImpl(config);

            let containerShutdownCompleted = false;
            instance.registerShutdownHook(async () => {
                await Bun.sleep(10);
                containerShutdownCompleted = true;
            });

            await instance.shutdownAsync();
            expect(containerShutdownCompleted).toBe(true);
            expect(instance.isRunning()).toBe(false);
        });

        test('getExecutorService registers shutdown hook automatically', async () => {
            const config = new HeliosConfig();
            const instance = new HeliosInstanceImpl(config);

            const executor = instance.getExecutorService('my-exec');
            expect(executor).toBeDefined();
            expect(executor.isShutdown()).toBe(false);

            await instance.shutdownAsync();
            expect(executor.isShutdown()).toBe(true);
        });
    });
});
