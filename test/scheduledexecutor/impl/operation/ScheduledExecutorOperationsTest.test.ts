import { describe, test, expect, beforeEach } from 'bun:test';
import { ScheduledExecutorContainerService } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledExecutorContainerService';
import { ScheduledTaskHandler } from '@zenystx/helios-core/scheduledexecutor/ScheduledTaskHandler';
import { ScheduledTaskState } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledTaskState';
import { StaleTaskException } from '@zenystx/helios-core/scheduledexecutor/StaleTaskException';
import { SubmitToPartitionOperation } from '@zenystx/helios-core/scheduledexecutor/impl/operation/SubmitToPartitionOperation';
import { SubmitToMemberOperation } from '@zenystx/helios-core/scheduledexecutor/impl/operation/SubmitToMemberOperation';
import { CancelTaskOperation } from '@zenystx/helios-core/scheduledexecutor/impl/operation/CancelTaskOperation';
import { DisposeTaskOperation } from '@zenystx/helios-core/scheduledexecutor/impl/operation/DisposeTaskOperation';
import { GetTaskStateOperation } from '@zenystx/helios-core/scheduledexecutor/impl/operation/GetTaskStateOperation';
import { GetScheduledFutureOperation } from '@zenystx/helios-core/scheduledexecutor/impl/operation/GetScheduledFutureOperation';
import type { TaskDefinition } from '@zenystx/helios-core/scheduledexecutor/impl/TaskDefinition';
import { OperationServiceImpl } from '@zenystx/helios-core/spi/impl/operationservice/impl/OperationServiceImpl';
import { Address } from '@zenystx/helios-core/cluster/Address';

const EXECUTOR_NAME = 'test-scheduler';
const PARTITION_COUNT = 4;

function makeDefinition(name = '', delay = 1000): TaskDefinition {
    return {
        name,
        command: 'TestTask',
        delay,
        period: 0,
        type: 'SINGLE_RUN',
        autoDisposable: false,
    };
}

function createNodeEngine(containerService: ScheduledExecutorContainerService): any {
    return {
        getPartitionService: () => ({
            getPartitionCount: () => PARTITION_COUNT,
            getPartitionOwner: () => null,
            isMigrating: () => false,
        }),
        getService: (serviceName: string) => {
            if (serviceName === ScheduledExecutorContainerService.SERVICE_NAME) {
                return containerService;
            }
            return null;
        },
        getOperationService: () => null,
        getLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
    };
}

describe('ScheduledExecutor Operations — Block 22.6', () => {
    let containerService: ScheduledExecutorContainerService;
    let operationService: OperationServiceImpl;

    beforeEach(() => {
        containerService = new ScheduledExecutorContainerService(PARTITION_COUNT);
        containerService.init();
        containerService.createDistributedObject(EXECUTOR_NAME, {
            getName: () => EXECUTOR_NAME,
            getPoolSize: () => 4,
            getDurability: () => 1,
            getCapacity: () => 100,
            getCapacityPolicy: () => 'PER_NODE',
            getMaxHistoryEntriesPerTask: () => 100,
        } as any);

        const nodeEngine = createNodeEngine(containerService);
        operationService = new OperationServiceImpl(nodeEngine, {
            localMode: true,
            localAddress: new Address('127.0.0.1', 5701),
        });
    });

    // ── SubmitToPartitionOperation ───────────────────────────────────────

    test('SubmitToPartitionOperation creates task descriptor in target partition store', async () => {
        const op = new SubmitToPartitionOperation(EXECUTOR_NAME, makeDefinition('task-1', 5000), containerService);
        const partitionId = 2;

        const future = operationService.invokeOnPartition<ScheduledTaskHandler>(
            ScheduledExecutorContainerService.SERVICE_NAME, op, partitionId,
        );
        const handler = await future.get();

        expect(handler).toBeDefined();
        expect(handler.getSchedulerName()).toBe(EXECUTOR_NAME);
        expect(handler.getTaskName()).toBe('task-1');
        expect(handler.getPartitionId()).toBe(partitionId);
        expect(handler.isAssignedToPartition()).toBe(true);

        // Verify the descriptor is in the correct partition store
        const store = containerService.getPartition(partitionId).getOrCreateContainer(EXECUTOR_NAME);
        expect(store.get('task-1')).toBeDefined();
        expect(store.get('task-1')!.state).toBe(ScheduledTaskState.SCHEDULED);
    });

    test('SubmitToPartitionOperation assigns UUID for unnamed tasks', async () => {
        const op = new SubmitToPartitionOperation(EXECUTOR_NAME, makeDefinition('', 1000), containerService);
        const future = operationService.invokeOnPartition<ScheduledTaskHandler>(
            ScheduledExecutorContainerService.SERVICE_NAME, op, 0,
        );
        const handler = await future.get();
        expect(handler.getTaskName()).not.toBe('');
        expect(handler.getTaskName().length).toBeGreaterThan(0);
    });

    test('SubmitToPartitionOperation routes to correct partition deterministically', async () => {
        // Submit to partition 1 and partition 3, verify each is in the right store
        const op1 = new SubmitToPartitionOperation(EXECUTOR_NAME, makeDefinition('p1-task'), containerService);
        const op2 = new SubmitToPartitionOperation(EXECUTOR_NAME, makeDefinition('p3-task'), containerService);

        await operationService.invokeOnPartition(ScheduledExecutorContainerService.SERVICE_NAME, op1, 1).get();
        await operationService.invokeOnPartition(ScheduledExecutorContainerService.SERVICE_NAME, op2, 3).get();

        expect(containerService.getPartition(1).getOrCreateContainer(EXECUTOR_NAME).get('p1-task')).toBeDefined();
        expect(containerService.getPartition(3).getOrCreateContainer(EXECUTOR_NAME).get('p3-task')).toBeDefined();
        // Not in other partitions
        expect(containerService.getPartition(0).getOrCreateContainer(EXECUTOR_NAME).get('p1-task')).toBeUndefined();
        expect(containerService.getPartition(2).getOrCreateContainer(EXECUTOR_NAME).get('p3-task')).toBeUndefined();
    });

    // ── SubmitToMemberOperation ─────────────────────────────────────────

    test('SubmitToMemberOperation creates task descriptor in member bin', async () => {
        const memberUuid = 'member-abc-123';
        const op = new SubmitToMemberOperation(EXECUTOR_NAME, makeDefinition('member-task', 2000), memberUuid, containerService);

        const future = operationService.invokeOnPartition<ScheduledTaskHandler>(
            ScheduledExecutorContainerService.SERVICE_NAME, op, -1,
        );
        const handler = await future.get();

        expect(handler).toBeDefined();
        expect(handler.getSchedulerName()).toBe(EXECUTOR_NAME);
        expect(handler.getTaskName()).toBe('member-task');
        expect(handler.isAssignedToMember()).toBe(true);
        expect(handler.getMemberUuid()).toBe(memberUuid);

        // Verify in member bin store
        const store = containerService.getMemberBin().getOrCreateContainer(EXECUTOR_NAME);
        expect(store.get('member-task')).toBeDefined();
    });

    // ── CancelTaskOperation ─────────────────────────────────────────────

    test('CancelTaskOperation cancels a scheduled task via handler', async () => {
        // First create a task
        const submitOp = new SubmitToPartitionOperation(EXECUTOR_NAME, makeDefinition('cancel-me'), containerService);
        const submitFuture = operationService.invokeOnPartition<ScheduledTaskHandler>(
            ScheduledExecutorContainerService.SERVICE_NAME, submitOp, 1,
        );
        const handler = await submitFuture.get();

        // Now cancel it
        const cancelOp = new CancelTaskOperation(handler, containerService);
        const cancelFuture = operationService.invokeOnPartition<boolean>(
            ScheduledExecutorContainerService.SERVICE_NAME, cancelOp, handler.getPartitionId(),
        );
        const cancelled = await cancelFuture.get();

        expect(cancelled).toBe(true);

        const descriptor = containerService.getPartition(1).getOrCreateContainer(EXECUTOR_NAME).get('cancel-me');
        expect(descriptor!.state).toBe(ScheduledTaskState.CANCELLED);
    });

    test('CancelTaskOperation returns false for already-cancelled task', async () => {
        const submitOp = new SubmitToPartitionOperation(EXECUTOR_NAME, makeDefinition('cancel-twice'), containerService);
        const handler = await operationService.invokeOnPartition<ScheduledTaskHandler>(
            ScheduledExecutorContainerService.SERVICE_NAME, submitOp, 0,
        ).get();

        // Cancel first time
        const op1 = new CancelTaskOperation(handler, containerService);
        await operationService.invokeOnPartition<boolean>(
            ScheduledExecutorContainerService.SERVICE_NAME, op1, 0,
        ).get();

        // Cancel second time
        const op2 = new CancelTaskOperation(handler, containerService);
        const result = await operationService.invokeOnPartition<boolean>(
            ScheduledExecutorContainerService.SERVICE_NAME, op2, 0,
        ).get();

        expect(result).toBe(false);
    });

    test('CancelTaskOperation reaches correct store via partition routing', async () => {
        const submitOp = new SubmitToPartitionOperation(EXECUTOR_NAME, makeDefinition('cancel-routed'), containerService);
        const handler = await operationService.invokeOnPartition<ScheduledTaskHandler>(
            ScheduledExecutorContainerService.SERVICE_NAME, submitOp, 2,
        ).get();

        const cancelOp = new CancelTaskOperation(handler, containerService);
        await operationService.invokeOnPartition<boolean>(
            ScheduledExecutorContainerService.SERVICE_NAME, cancelOp, 2,
        ).get();

        const descriptor = containerService.getPartition(2).getOrCreateContainer(EXECUTOR_NAME).get('cancel-routed');
        expect(descriptor!.state).toBe(ScheduledTaskState.CANCELLED);
    });

    // ── DisposeTaskOperation ────────────────────────────────────────────

    test('DisposeTaskOperation removes task from store', async () => {
        const submitOp = new SubmitToPartitionOperation(EXECUTOR_NAME, makeDefinition('dispose-me'), containerService);
        const handler = await operationService.invokeOnPartition<ScheduledTaskHandler>(
            ScheduledExecutorContainerService.SERVICE_NAME, submitOp, 1,
        ).get();

        const disposeOp = new DisposeTaskOperation(handler, containerService);
        await operationService.invokeOnPartition<void>(
            ScheduledExecutorContainerService.SERVICE_NAME, disposeOp, 1,
        ).get();

        const store = containerService.getPartition(1).getOrCreateContainer(EXECUTOR_NAME);
        expect(store.get('dispose-me')).toBeUndefined();
    });

    test('DisposeTaskOperation throws StaleTaskException for already-disposed task', async () => {
        const submitOp = new SubmitToPartitionOperation(EXECUTOR_NAME, makeDefinition('dispose-twice'), containerService);
        const handler = await operationService.invokeOnPartition<ScheduledTaskHandler>(
            ScheduledExecutorContainerService.SERVICE_NAME, submitOp, 0,
        ).get();

        // Dispose first time
        const op1 = new DisposeTaskOperation(handler, containerService);
        await operationService.invokeOnPartition<void>(
            ScheduledExecutorContainerService.SERVICE_NAME, op1, 0,
        ).get();

        // Dispose second time should throw
        const op2 = new DisposeTaskOperation(handler, containerService);
        const future = operationService.invokeOnPartition<void>(
            ScheduledExecutorContainerService.SERVICE_NAME, op2, 0,
        );
        expect(future.get()).rejects.toThrow(StaleTaskException);
    });

    // ── GetTaskStateOperation ───────────────────────────────────────────

    test('GetTaskStateOperation returns current task state', async () => {
        const submitOp = new SubmitToPartitionOperation(EXECUTOR_NAME, makeDefinition('state-task'), containerService);
        const handler = await operationService.invokeOnPartition<ScheduledTaskHandler>(
            ScheduledExecutorContainerService.SERVICE_NAME, submitOp, 0,
        ).get();

        const stateOp = new GetTaskStateOperation(handler, containerService);
        const future = operationService.invokeOnPartition<ScheduledTaskState>(
            ScheduledExecutorContainerService.SERVICE_NAME, stateOp, 0,
        );
        const state = await future.get();

        expect(state).toBe(ScheduledTaskState.SCHEDULED);
    });

    test('GetTaskStateOperation returns CANCELLED state after cancel', async () => {
        const submitOp = new SubmitToPartitionOperation(EXECUTOR_NAME, makeDefinition('state-cancel'), containerService);
        const handler = await operationService.invokeOnPartition<ScheduledTaskHandler>(
            ScheduledExecutorContainerService.SERVICE_NAME, submitOp, 1,
        ).get();

        containerService.cancelTask(EXECUTOR_NAME, 'state-cancel', 1);

        const stateOp = new GetTaskStateOperation(handler, containerService);
        const state = await operationService.invokeOnPartition<ScheduledTaskState>(
            ScheduledExecutorContainerService.SERVICE_NAME, stateOp, 1,
        ).get();

        expect(state).toBe(ScheduledTaskState.CANCELLED);
    });

    // ── GetScheduledFutureOperation ─────────────────────────────────────

    test('GetScheduledFutureOperation returns task descriptor for handler reacquisition', async () => {
        const submitOp = new SubmitToPartitionOperation(EXECUTOR_NAME, makeDefinition('future-task', 3000), containerService);
        const handler = await operationService.invokeOnPartition<ScheduledTaskHandler>(
            ScheduledExecutorContainerService.SERVICE_NAME, submitOp, 2,
        ).get();

        const getOp = new GetScheduledFutureOperation(handler, containerService);
        const future = operationService.invokeOnPartition<ScheduledTaskHandler>(
            ScheduledExecutorContainerService.SERVICE_NAME, getOp, 2,
        );
        const reacquiredHandler = await future.get();

        expect(reacquiredHandler.getSchedulerName()).toBe(EXECUTOR_NAME);
        expect(reacquiredHandler.getTaskName()).toBe('future-task');
        expect(reacquiredHandler.getPartitionId()).toBe(2);
    });

    // ── Handler validation ──────────────────────────────────────────────

    test('handler lookup validation rejects mismatched scheduler name', async () => {
        const submitOp = new SubmitToPartitionOperation(EXECUTOR_NAME, makeDefinition('valid-task'), containerService);
        await operationService.invokeOnPartition<ScheduledTaskHandler>(
            ScheduledExecutorContainerService.SERVICE_NAME, submitOp, 0,
        ).get();

        // Create a handler with wrong scheduler name
        const badHandler = ScheduledTaskHandler.ofPartition('wrong-scheduler', 'valid-task', 0);

        const stateOp = new GetTaskStateOperation(badHandler, containerService);
        const future = operationService.invokeOnPartition<ScheduledTaskState>(
            ScheduledExecutorContainerService.SERVICE_NAME, stateOp, 0,
        );
        // Should throw because the handler's scheduler name doesn't match
        expect(future.get()).rejects.toThrow();
    });

    // ── Operations route through OperationService ───────────────────────

    test('all operations route through OperationService', async () => {
        // Verify that operations have serviceName set by OperationService
        const submitOp = new SubmitToPartitionOperation(EXECUTOR_NAME, makeDefinition('routed-task'), containerService);
        const handler = await operationService.invokeOnPartition<ScheduledTaskHandler>(
            ScheduledExecutorContainerService.SERVICE_NAME, submitOp, 0,
        ).get();

        expect(submitOp.serviceName).toBe(ScheduledExecutorContainerService.SERVICE_NAME);

        const cancelOp = new CancelTaskOperation(handler, containerService);
        await operationService.invokeOnPartition<boolean>(
            ScheduledExecutorContainerService.SERVICE_NAME, cancelOp, 0,
        ).get();
        expect(cancelOp.serviceName).toBe(ScheduledExecutorContainerService.SERVICE_NAME);
    });

    // ── Member routing ──────────────────────────────────────────────────

    test('member-owned tasks use member bin, not partition stores', async () => {
        const memberUuid = 'member-xyz';
        const submitOp = new SubmitToMemberOperation(EXECUTOR_NAME, makeDefinition('member-only'), memberUuid, containerService);
        await operationService.invokeOnPartition<ScheduledTaskHandler>(
            ScheduledExecutorContainerService.SERVICE_NAME, submitOp, -1,
        ).get();

        // Should be in member bin
        const memberStore = containerService.getMemberBin().getOrCreateContainer(EXECUTOR_NAME);
        expect(memberStore.get('member-only')).toBeDefined();

        // Should NOT be in any partition
        for (let i = 0; i < PARTITION_COUNT; i++) {
            expect(containerService.getPartition(i).getOrCreateContainer(EXECUTOR_NAME).get('member-only')).toBeUndefined();
        }
    });

    // ── Dispose reaches correct store ───────────────────────────────────

    test('dispose reaches correct partition store via routing', async () => {
        // Create tasks in two different partitions
        const op1 = new SubmitToPartitionOperation(EXECUTOR_NAME, makeDefinition('p0-dispose'), containerService);
        const op2 = new SubmitToPartitionOperation(EXECUTOR_NAME, makeDefinition('p3-dispose'), containerService);

        const h1 = await operationService.invokeOnPartition<ScheduledTaskHandler>(
            ScheduledExecutorContainerService.SERVICE_NAME, op1, 0,
        ).get();
        const h2 = await operationService.invokeOnPartition<ScheduledTaskHandler>(
            ScheduledExecutorContainerService.SERVICE_NAME, op2, 3,
        ).get();

        // Dispose only partition 0's task
        const disposeOp = new DisposeTaskOperation(h1, containerService);
        await operationService.invokeOnPartition<void>(
            ScheduledExecutorContainerService.SERVICE_NAME, disposeOp, 0,
        ).get();

        // Partition 0 task gone, partition 3 task still present
        expect(containerService.getPartition(0).getOrCreateContainer(EXECUTOR_NAME).get('p0-dispose')).toBeUndefined();
        expect(containerService.getPartition(3).getOrCreateContainer(EXECUTOR_NAME).get('p3-dispose')).toBeDefined();
    });
});
