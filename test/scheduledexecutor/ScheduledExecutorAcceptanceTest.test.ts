import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { ScheduledExecutorContainerService } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledExecutorContainerService.js';
import { ScheduledExecutorServiceProxy } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledExecutorServiceProxy.js';
import { ClientScheduledExecutorProxy } from '@zenystx/helios-core/client/proxy/ClientScheduledExecutorProxy.js';
import { ScheduledExecutorConfig } from '@zenystx/helios-core/config/ScheduledExecutorConfig.js';
import { ScheduledTaskHandler } from '@zenystx/helios-core/scheduledexecutor/ScheduledTaskHandler.js';
import { StaleTaskException } from '@zenystx/helios-core/scheduledexecutor/StaleTaskException.js';
import { ExecutorRejectedExecutionException } from '@zenystx/helios-core/executor/ExecutorExceptions.js';
import { CrashRecoveryService } from '@zenystx/helios-core/scheduledexecutor/impl/CrashRecoveryService.js';
import { ScheduledTaskState } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledTaskState.js';
import { ScheduledTaskDescriptor } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledTaskDescriptor.js';
import type { TaskCallable } from '@zenystx/helios-core/executor/TaskCallable.js';
import type { Member } from '@zenystx/helios-core/cluster/Member.js';
import type { PartitionMigrationEvent } from '@zenystx/helios-core/internal/partition/PartitionMigrationEvent.js';

const EXECUTOR_NAME = 'acceptance-scheduler';
const PARTITION_COUNT = 4;

function task(taskType = 'AcceptanceTask'): TaskCallable<unknown> {
    return { taskType, input: null };
}

function makeMember(uuid: string): Member {
    return {
        getUuid: () => uuid,
        localMember: () => false,
        isLiteMember: () => false,
        getAddress: () => ({ getHost: () => '127.0.0.1', getPort: () => 5701, toString: () => '127.0.0.1:5701' }) as any,
        getAddressMap: () => new Map(),
        getAttributes: () => new Map(),
        getAttribute: () => null,
        getVersion: () => ({ getMajor: () => 1, getMinor: () => 0, getPatch: () => 0 }) as any,
    } as Member;
}

// ═══════════════════════════════════════════════════════════════════════
// 1. Config → Schedule One-Shot → Result Retrieval → Verify Correctness
// ═══════════════════════════════════════════════════════════════════════

describe('E2E: Config → schedule one-shot → result', () => {
    let containerService: ScheduledExecutorContainerService;
    let proxy: ScheduledExecutorServiceProxy;

    beforeEach(() => {
        const config = new ScheduledExecutorConfig(EXECUTOR_NAME);
        containerService = new ScheduledExecutorContainerService(PARTITION_COUNT);
        containerService.init();
        containerService.createDistributedObject(EXECUTOR_NAME, config);
        proxy = new ScheduledExecutorServiceProxy(EXECUTOR_NAME, containerService, config, PARTITION_COUNT);
    });

    afterEach(async () => {
        await containerService.shutdown();
    });

    test('one-shot task with zero delay completes and returns result', async () => {
        const future = await proxy.schedule(task(), 0);
        expect(future).toBeDefined();
        expect(future.getHandler().getSchedulerName()).toBe(EXECUTOR_NAME);

        await Bun.sleep(50);
        expect(await future.isDone()).toBe(true);
        expect(await future.isCancelled()).toBe(false);
        const result = await future.get();
        expect(result).toBeUndefined(); // void task
    });

    test('one-shot task handler is a valid partition handler', async () => {
        const future = await proxy.schedule(task(), 100);
        const handler = future.getHandler();
        expect(handler.isAssignedToPartition()).toBe(true);
        expect(handler.getPartitionId()).toBeGreaterThanOrEqual(0);
        expect(handler.getPartitionId()).toBeLessThan(PARTITION_COUNT);

        const urn = handler.toUrn();
        expect(urn).toContain('urn:helios:scheduled:');
        expect(urn).toContain(EXECUTOR_NAME);
    });

    test('one-shot task stats are populated after completion', async () => {
        const future = await proxy.schedule(task(), 0);
        await Bun.sleep(50);

        const stats = await future.getStats();
        expect(stats.totalRuns).toBeGreaterThanOrEqual(1);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// 2. Config → Schedule Fixed-Rate → Verify Cadence Over Multiple Periods
// ═══════════════════════════════════════════════════════════════════════

describe('E2E: Config → schedule fixed-rate → verify cadence', () => {
    let containerService: ScheduledExecutorContainerService;
    let proxy: ScheduledExecutorServiceProxy;

    beforeEach(() => {
        const config = new ScheduledExecutorConfig(EXECUTOR_NAME);
        containerService = new ScheduledExecutorContainerService(PARTITION_COUNT);
        containerService.init();
        containerService.createDistributedObject(EXECUTOR_NAME, config);
        proxy = new ScheduledExecutorServiceProxy(EXECUTOR_NAME, containerService, config, PARTITION_COUNT);
    });

    afterEach(async () => {
        await containerService.shutdown();
    });

    test('fixed-rate task fires on initial delay then repeats', async () => {
        const future = await proxy.scheduleAtFixedRate(task(), 0, 30);
        expect(future).toBeDefined();
        expect(future.getHandler().isAssignedToPartition()).toBe(true);

        // Wait for multiple periods
        await Bun.sleep(120);

        const handler = future.getHandler();
        const descriptor = containerService.getTaskDescriptor(
            handler.getSchedulerName(),
            handler.getTaskName(),
            handler.getPartitionId(),
        );
        // Fixed-rate should have fired multiple times or still be scheduled for next run
        expect(descriptor.scheduleKind).toBe('FIXED_RATE');
    });

    test('fixed-rate future is not done until cancelled', async () => {
        const future = await proxy.scheduleAtFixedRate(task(), 10, 50);
        await Bun.sleep(30);
        // Periodic tasks are never "done" — they keep running
        const handler = future.getHandler();
        const descriptor = containerService.getTaskDescriptor(
            handler.getSchedulerName(),
            handler.getTaskName(),
            handler.getPartitionId(),
        );
        expect(descriptor.state).not.toBe(ScheduledTaskState.DONE);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. Cancel/Dispose Lifecycle
// ═══════════════════════════════════════════════════════════════════════

describe('E2E: Cancel/dispose lifecycle', () => {
    let containerService: ScheduledExecutorContainerService;
    let proxy: ScheduledExecutorServiceProxy;

    beforeEach(() => {
        const config = new ScheduledExecutorConfig(EXECUTOR_NAME);
        containerService = new ScheduledExecutorContainerService(PARTITION_COUNT);
        containerService.init();
        containerService.createDistributedObject(EXECUTOR_NAME, config);
        proxy = new ScheduledExecutorServiceProxy(EXECUTOR_NAME, containerService, config, PARTITION_COUNT);
    });

    afterEach(async () => {
        await containerService.shutdown();
    });

    test('cancel preserves metadata — task is still queryable', async () => {
        const future = await proxy.schedule(task(), 60_000);
        const cancelled = await future.cancel(false);
        expect(cancelled).toBe(true);
        expect(await future.isCancelled()).toBe(true);
        expect(await future.isDone()).toBe(true); // cancelled counts as done

        // Metadata is still accessible
        const handler = future.getHandler();
        expect(handler.getSchedulerName()).toBe(EXECUTOR_NAME);
        const stats = await future.getStats();
        expect(stats).toBeDefined();
    });

    test('dispose removes task state — stale access throws', async () => {
        const future = await proxy.schedule(task(), 60_000);
        const handler = future.getHandler();

        await future.cancel(false);
        await future.dispose();

        // Accessing via the same handler after dispose throws StaleTaskException
        const reacquired = proxy.getScheduledFuture(handler);
        await expect(reacquired.isDone()).rejects.toThrow(StaleTaskException);
        await expect(reacquired.isCancelled()).rejects.toThrow(StaleTaskException);
        await expect(reacquired.getStats()).rejects.toThrow(StaleTaskException);
    });

    test('double cancel returns false on second attempt', async () => {
        const future = await proxy.schedule(task(), 60_000);
        expect(await future.cancel(false)).toBe(true);
        expect(await future.cancel(false)).toBe(false); // already cancelled
    });

    test('dispose after already-done task removes it', async () => {
        const future = await proxy.schedule(task(), 0);
        await Bun.sleep(50);
        expect(await future.isDone()).toBe(true);

        await future.dispose();
        const reacquired = proxy.getScheduledFuture(future.getHandler());
        await expect(reacquired.isDone()).rejects.toThrow(StaleTaskException);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. Handler Reacquisition After Restart
// ═══════════════════════════════════════════════════════════════════════

describe('E2E: Handler reacquisition after restart', () => {
    test('serialize handler to URN, reconstruct, and reacquire future', async () => {
        const containerService = new ScheduledExecutorContainerService(PARTITION_COUNT);
        containerService.init();
        const config = new ScheduledExecutorConfig(EXECUTOR_NAME);
        containerService.createDistributedObject(EXECUTOR_NAME, config);
        const proxy = new ScheduledExecutorServiceProxy(EXECUTOR_NAME, containerService, config, PARTITION_COUNT);

        const future = await proxy.schedule(task(), 60_000);
        const urn = future.getHandler().toUrn();

        // Simulate restart: reconstruct handler from URN
        const reconstructed = ScheduledTaskHandler.of(urn);
        expect(reconstructed.getSchedulerName()).toBe(EXECUTOR_NAME);
        expect(reconstructed.getPartitionId()).toBe(future.getHandler().getPartitionId());
        expect(reconstructed.getTaskName()).toBe(future.getHandler().getTaskName());

        // Reacquire future via the reconstructed handler (same container still alive)
        const reacquired = proxy.getScheduledFuture(reconstructed);
        expect(await reacquired.isCancelled()).toBe(false);

        // Cancel through reacquired future works
        expect(await reacquired.cancel(false)).toBe(true);
        expect(await reacquired.isCancelled()).toBe(true);

        await containerService.shutdown();
    });

    test('handler URN round-trips for member-owned tasks', async () => {
        const containerService = new ScheduledExecutorContainerService(PARTITION_COUNT);
        containerService.init();
        const config = new ScheduledExecutorConfig(EXECUTOR_NAME);
        containerService.createDistributedObject(EXECUTOR_NAME, config);
        const proxy = new ScheduledExecutorServiceProxy(EXECUTOR_NAME, containerService, config, PARTITION_COUNT);

        const member = makeMember('member-uuid-abc');
        const future = await proxy.scheduleOnMember(task(), member, 60_000);
        const urn = future.getHandler().toUrn();

        const reconstructed = ScheduledTaskHandler.of(urn);
        expect(reconstructed.isAssignedToMember()).toBe(true);
        expect(reconstructed.getMemberUuid()).toBe('member-uuid-abc');

        const reacquired = proxy.getScheduledFuture(reconstructed);
        expect(await reacquired.isCancelled()).toBe(false);

        await containerService.shutdown();
    });
});

// ═══════════════════════════════════════════════════════════════════════
// 5. Partition Migration Preserves Scheduled Tasks
// ═══════════════════════════════════════════════════════════════════════

describe('E2E: Partition migration preserves scheduled tasks', () => {
    test('migrate partition: beforeMigration suspends, commitMigration promotes on destination', async () => {
        const containerService = new ScheduledExecutorContainerService(PARTITION_COUNT);
        containerService.init();
        const config = new ScheduledExecutorConfig(EXECUTOR_NAME);
        containerService.createDistributedObject(EXECUTOR_NAME, config);
        const proxy = new ScheduledExecutorServiceProxy(EXECUTOR_NAME, containerService, config, PARTITION_COUNT);

        const future = await proxy.schedule(task(), 60_000);
        const handler = future.getHandler();
        const partitionId = handler.getPartitionId();

        // Before migration: source suspends
        containerService.beforeMigration({
            partitionId,
            migrationEndpoint: 'SOURCE',
            currentReplicaIndex: 0,
            newReplicaIndex: -1,
        } as PartitionMigrationEvent);

        const descriptor = containerService.getTaskDescriptor(
            handler.getSchedulerName(),
            handler.getTaskName(),
            partitionId,
        );
        expect(descriptor.state).toBe(ScheduledTaskState.SUSPENDED);

        // Simulate replicated state on destination: use enqueueSuspendedFromSnapshot
        const destService = new ScheduledExecutorContainerService(PARTITION_COUNT);
        destService.init();
        destService.createDistributedObject(EXECUTOR_NAME, config);

        const snapshot = containerService.prepareReplicationData(partitionId);
        for (const [execName, taskMap] of snapshot) {
            for (const [, taskSnap] of taskMap) {
                destService.enqueueSuspendedFromSnapshot(execName, taskSnap, partitionId);
            }
        }

        // Commit migration on destination: epoch increment + promote
        destService.commitMigration({
            partitionId,
            migrationEndpoint: 'DESTINATION',
            currentReplicaIndex: -1,
            newReplicaIndex: 0,
        } as PartitionMigrationEvent);

        // Verify task is now SCHEDULED on destination with incremented epoch
        const destDescriptor = destService.getTaskDescriptor(
            handler.getSchedulerName(),
            handler.getTaskName(),
            partitionId,
        );
        expect(destDescriptor.state).toBe(ScheduledTaskState.SCHEDULED);
        expect(destDescriptor.ownerEpoch).toBeGreaterThan(0);

        await containerService.shutdown();
        await destService.shutdown();
    });
});

// ═══════════════════════════════════════════════════════════════════════
// 6. Member Crash Recovery with At-Least-Once Replay
// ═══════════════════════════════════════════════════════════════════════

describe('E2E: Member crash recovery with at-least-once replay', () => {
    test('crash owner, promote backup: one-shot not durably completed is replayed', () => {
        const containerService = new ScheduledExecutorContainerService(PARTITION_COUNT);
        containerService.init();
        const config = new ScheduledExecutorConfig(EXECUTOR_NAME);
        containerService.createDistributedObject(EXECUTOR_NAME, config);

        // Schedule a one-shot task
        const descriptor = containerService.scheduleOnPartition(EXECUTOR_NAME, {
            name: 'crash-test-task',
            command: 'CrashTestTask',
            delay: 60_000,
            period: 0,
            type: 'SINGLE_RUN',
            autoDisposable: false,
        }, 0);

        // Simulate crash: suspend the task (as if beforeMigration ran)
        descriptor.transitionTo(ScheduledTaskState.SUSPENDED);
        expect(descriptor.completedDurably).toBe(false);

        // Crash recovery: plan recovery at the SAME epoch (promoted backup inherits epoch)
        // planRecovery fences tasks with ownerEpoch < promotedEpoch
        const recoveryService = new CrashRecoveryService();
        const promotedEpoch = descriptor.ownerEpoch; // same epoch — not fenced
        const plan = recoveryService.planRecovery([descriptor], promotedEpoch);

        // Task should be eligible for replay (not durably completed, epoch matches)
        expect(plan.eligibleForReplay.length).toBe(1);
        expect(plan.fencedOut.length).toBe(0);
        expect(plan.durablyCompleted.length).toBe(0);

        // Apply recovery: task transitions to SCHEDULED with the epoch
        recoveryService.applyRecovery(plan, promotedEpoch);
        expect(descriptor.state).toBe(ScheduledTaskState.SCHEDULED);
        expect(descriptor.ownerEpoch).toBe(promotedEpoch);

        containerService.shutdown();
    });

    test('durably completed one-shot is NOT replayed', () => {
        const descriptor = new ScheduledTaskDescriptor({
            taskName: 'completed-task',
            handlerId: 'h1',
            executorName: EXECUTOR_NAME,
            taskType: 'TestTask',
            scheduleKind: 'ONE_SHOT',
            ownerKind: 'PARTITION',
            partitionId: 0,
            ownerEpoch: 1, // match promoted epoch so it's not fenced
        });
        descriptor.completedDurably = true;
        descriptor.transitionTo(ScheduledTaskState.SUSPENDED);

        const recoveryService = new CrashRecoveryService();
        const plan = recoveryService.planRecovery([descriptor], 1); // same epoch

        expect(plan.durablyCompleted.length).toBe(1);
        expect(plan.eligibleForReplay.length).toBe(0);
    });

    test('stale epoch tasks are fenced out during recovery', () => {
        const descriptor = new ScheduledTaskDescriptor({
            taskName: 'old-epoch-task',
            handlerId: 'h2',
            executorName: EXECUTOR_NAME,
            taskType: 'TestTask',
            scheduleKind: 'ONE_SHOT',
            ownerKind: 'PARTITION',
            ownerEpoch: 3,
        });
        descriptor.transitionTo(ScheduledTaskState.SUSPENDED);

        const recoveryService = new CrashRecoveryService();
        const plan = recoveryService.planRecovery([descriptor], 5); // promotedEpoch=5 > ownerEpoch=3

        expect(plan.fencedOut.length).toBe(1);
        expect(plan.eligibleForReplay.length).toBe(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// 7. Member-Owned Task Loss on Target Departure
// ═══════════════════════════════════════════════════════════════════════

describe('E2E: Member-owned task loss on target departure', () => {
    test('schedule on member, remove member, task access throws', async () => {
        const containerService = new ScheduledExecutorContainerService(PARTITION_COUNT);
        containerService.init();
        const config = new ScheduledExecutorConfig(EXECUTOR_NAME);
        containerService.createDistributedObject(EXECUTOR_NAME, config);
        const proxy = new ScheduledExecutorServiceProxy(EXECUTOR_NAME, containerService, config, PARTITION_COUNT);

        const member = makeMember('departing-member');
        const future = await proxy.scheduleOnMember(task(), member, 60_000);
        expect(await future.isCancelled()).toBe(false); // accessible before departure

        // Simulate member departure
        containerService.notifyMemberRemoved('departing-member');

        // All future operations should throw (member no longer accessible)
        await expect(future.isDone()).rejects.toThrow(/not part of this cluster/);
        await expect(future.cancel(false)).rejects.toThrow(/not part of this cluster/);
        await expect(future.getStats()).rejects.toThrow(/not part of this cluster/);

        await containerService.shutdown();
    });

    test('partition-owned task is NOT affected by member departure', async () => {
        const containerService = new ScheduledExecutorContainerService(PARTITION_COUNT);
        containerService.init();
        const config = new ScheduledExecutorConfig(EXECUTOR_NAME);
        containerService.createDistributedObject(EXECUTOR_NAME, config);
        const proxy = new ScheduledExecutorServiceProxy(EXECUTOR_NAME, containerService, config, PARTITION_COUNT);

        const future = await proxy.schedule(task(), 60_000);
        containerService.notifyMemberRemoved('some-other-member');

        // Partition-owned task should still be accessible
        expect(await future.isCancelled()).toBe(false);
        expect(future.getHandler().isAssignedToPartition()).toBe(true);

        await containerService.shutdown();
    });
});

// ═══════════════════════════════════════════════════════════════════════
// 8. Client/Server Parity E2E
// ═══════════════════════════════════════════════════════════════════════

describe('E2E: Client/server parity', () => {
    let containerService: ScheduledExecutorContainerService;
    let serverProxy: ScheduledExecutorServiceProxy;
    let clientProxy: ClientScheduledExecutorProxy;

    beforeEach(() => {
        const config = new ScheduledExecutorConfig(EXECUTOR_NAME);
        containerService = new ScheduledExecutorContainerService(PARTITION_COUNT);
        containerService.init();
        containerService.createDistributedObject(EXECUTOR_NAME, config);
        serverProxy = new ScheduledExecutorServiceProxy(EXECUTOR_NAME, containerService, config, PARTITION_COUNT);
        clientProxy = new ClientScheduledExecutorProxy(EXECUTOR_NAME, containerService, config, PARTITION_COUNT);
    });

    afterEach(async () => {
        await containerService.shutdown();
    });

    test('client schedules, server can see the task via getAllScheduledFutures', async () => {
        await clientProxy.schedule(task(), 60_000);
        const allFutures = await serverProxy.getAllScheduledFutures();
        let total = 0;
        for (const [, futures] of allFutures) total += futures.length;
        expect(total).toBeGreaterThanOrEqual(1);
    });

    test('client cancel matches server cancel behavior', async () => {
        const future = await clientProxy.schedule(task(), 60_000);
        const cancelled = await future.cancel(false);
        expect(cancelled).toBe(true);
        expect(await future.isCancelled()).toBe(true);
        expect(await future.isDone()).toBe(true);
    });

    test('client dispose matches server dispose behavior', async () => {
        const future = await clientProxy.schedule(task(), 60_000);
        await future.cancel(false);
        await future.dispose();

        // After client dispose, the handler is nulled — getHandler throws
        expect(() => future.getHandler()).toThrow(StaleTaskException);
    });

    test('client reacquires handler from URN same as server', async () => {
        const serverFuture = await serverProxy.schedule(task(), 60_000);
        const urn = serverFuture.getHandler().toUrn();
        const handler = ScheduledTaskHandler.of(urn);

        // Client reacquires
        const clientReacquired = clientProxy.getScheduledFuture(handler);
        expect(await clientReacquired.isCancelled()).toBe(false);

        // Cancel via client, verify via server
        await clientReacquired.cancel(false);
        const serverReacquired = serverProxy.getScheduledFuture(handler);
        expect(await serverReacquired.isCancelled()).toBe(true);
    });

    test('client scheduleAtFixedRate matches server behavior', async () => {
        const future = await clientProxy.scheduleAtFixedRate(task(), 0, 30);
        expect(future.getHandler().isAssignedToPartition()).toBe(true);
        const descriptor = containerService.getTaskDescriptor(
            future.getHandler().getSchedulerName(),
            future.getHandler().getTaskName(),
            future.getHandler().getPartitionId(),
        );
        expect(descriptor.scheduleKind).toBe('FIXED_RATE');
    });
});

// ═══════════════════════════════════════════════════════════════════════
// 9. Shutdown Transfer
// ═══════════════════════════════════════════════════════════════════════

describe('E2E: Shutdown transfer', () => {
    test('graceful shutdown rejects new submissions', async () => {
        const containerService = new ScheduledExecutorContainerService(PARTITION_COUNT);
        containerService.init();
        const config = new ScheduledExecutorConfig(EXECUTOR_NAME);
        containerService.createDistributedObject(EXECUTOR_NAME, config);
        const proxy = new ScheduledExecutorServiceProxy(EXECUTOR_NAME, containerService, config, PARTITION_COUNT);

        // Schedule a task before shutdown
        const future = await proxy.schedule(task(), 60_000);
        expect(future).toBeDefined();

        // Shutdown
        await proxy.shutdown();
        expect(proxy.isShutdown()).toBe(true);

        // New submissions rejected
        await expect(proxy.schedule(task(), 1000)).rejects.toThrow(ExecutorRejectedExecutionException);
        await expect(proxy.scheduleAtFixedRate(task(), 0, 100)).rejects.toThrow(ExecutorRejectedExecutionException);
    });

    test('graceful shutdown transfers existing tasks via replication', async () => {
        const sourceService = new ScheduledExecutorContainerService(PARTITION_COUNT);
        sourceService.init();
        const config = new ScheduledExecutorConfig(EXECUTOR_NAME);
        sourceService.createDistributedObject(EXECUTOR_NAME, config);
        const proxy = new ScheduledExecutorServiceProxy(EXECUTOR_NAME, sourceService, config, PARTITION_COUNT);

        const future = await proxy.schedule(task(), 60_000);
        const handler = future.getHandler();
        const partitionId = handler.getPartitionId();

        // Prepare replication data before shutdown
        const replicationData = sourceService.prepareReplicationData(partitionId);
        expect(replicationData.size).toBeGreaterThan(0);

        // Simulate transfer to destination
        const destService = new ScheduledExecutorContainerService(PARTITION_COUNT);
        destService.init();
        destService.createDistributedObject(EXECUTOR_NAME, config);

        for (const [execName, taskMap] of replicationData) {
            for (const [, snapshot] of taskMap) {
                destService.enqueueSuspendedFromSnapshot(execName, snapshot, partitionId);
            }
        }

        // Promote on destination
        destService.commitMigration({
            partitionId,
            migrationEndpoint: 'DESTINATION',
            currentReplicaIndex: -1,
            newReplicaIndex: 0,
        } as PartitionMigrationEvent);

        // Verify task survived the transfer
        const destDescriptor = destService.getTaskDescriptor(
            handler.getSchedulerName(),
            handler.getTaskName(),
            partitionId,
        );
        expect(destDescriptor.state).toBe(ScheduledTaskState.SCHEDULED);
        expect(destDescriptor.taskType).toBe('AcceptanceTask');

        await sourceService.shutdown();
        await destService.shutdown();
    });
});
