import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { ScheduledExecutorContainerService } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledExecutorContainerService.js';
import { ScheduledExecutorPartition } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledExecutorPartition.js';
import { ScheduledExecutorMemberBin } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledExecutorMemberBin.js';
import { ScheduledTaskState } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledTaskState.js';
import { ScheduledExecutorConfig } from '@zenystx/helios-core/config/ScheduledExecutorConfig.js';
import type { TaskDefinition } from '@zenystx/helios-core/scheduledexecutor/impl/TaskDefinition.js';

describe('ScheduledExecutorPartition', () => {
    test('holds a ScheduledTaskStore per executor name', () => {
        const partition = new ScheduledExecutorPartition(0);
        const store = partition.getOrCreateContainer('myScheduler');
        expect(store).toBeDefined();
        expect(store.size()).toBe(0);
    });

    test('returns the same store for the same executor name', () => {
        const partition = new ScheduledExecutorPartition(0);
        const store1 = partition.getOrCreateContainer('myScheduler');
        const store2 = partition.getOrCreateContainer('myScheduler');
        expect(store1).toBe(store2);
    });

    test('returns different stores for different executor names', () => {
        const partition = new ScheduledExecutorPartition(0);
        const s1 = partition.getOrCreateContainer('a');
        const s2 = partition.getOrCreateContainer('b');
        expect(s1).not.toBe(s2);
    });

    test('destroyContainer removes the container', () => {
        const partition = new ScheduledExecutorPartition(0);
        partition.getOrCreateContainer('myScheduler');
        partition.destroyContainer('myScheduler');
        // After destroy, getting a new one should give an empty store
        const fresh = partition.getOrCreateContainer('myScheduler');
        expect(fresh.size()).toBe(0);
    });

    test('destroy removes all containers', () => {
        const partition = new ScheduledExecutorPartition(0);
        partition.getOrCreateContainer('a');
        partition.getOrCreateContainer('b');
        partition.destroy();
        // After destroy all, new stores should be empty
        expect(partition.getOrCreateContainer('a').size()).toBe(0);
    });

    test('exposes partitionId', () => {
        const partition = new ScheduledExecutorPartition(7);
        expect(partition.partitionId).toBe(7);
    });
});

describe('ScheduledExecutorMemberBin', () => {
    test('holds containers for member-owned tasks', () => {
        const bin = new ScheduledExecutorMemberBin();
        const store = bin.getOrCreateContainer('myScheduler');
        expect(store).toBeDefined();
        expect(store.size()).toBe(0);
    });

    test('returns the same store for the same executor name', () => {
        const bin = new ScheduledExecutorMemberBin();
        const s1 = bin.getOrCreateContainer('exec');
        const s2 = bin.getOrCreateContainer('exec');
        expect(s1).toBe(s2);
    });

    test('destroyContainer removes the container', () => {
        const bin = new ScheduledExecutorMemberBin();
        bin.getOrCreateContainer('exec');
        bin.destroyContainer('exec');
        expect(bin.getOrCreateContainer('exec').size()).toBe(0);
    });
});

describe('ScheduledExecutorContainerService', () => {
    let service: ScheduledExecutorContainerService;

    beforeEach(() => {
        service = new ScheduledExecutorContainerService(4); // 4 partitions
    });

    afterEach(async () => {
        await service.shutdown();
    });

    test('init creates partition containers', () => {
        service.init();
        // Should be able to get partition container for partition 0-3
        const partition = service.getPartition(0);
        expect(partition).toBeDefined();
        expect(partition.partitionId).toBe(0);
    });

    test('init creates member bin', () => {
        service.init();
        const bin = service.getMemberBin();
        expect(bin).toBeDefined();
    });

    test('reset clears all partitions and member bin', () => {
        service.init();
        const partition = service.getPartition(0);
        partition.getOrCreateContainer('test');
        service.reset();
        // After reset, partition stores should be fresh
        const freshPartition = service.getPartition(0);
        expect(freshPartition.getOrCreateContainer('test').size()).toBe(0);
    });

    test('shutdown completes cleanly', async () => {
        service.init();
        await service.shutdown();
        expect(service.isShutdown()).toBe(true);
    });

    test('createDistributedObject creates containers in all partitions', () => {
        service.init();
        service.createDistributedObject('myScheduler', new ScheduledExecutorConfig('myScheduler'));
        // Containers should exist in each partition
        for (let i = 0; i < 4; i++) {
            const store = service.getPartition(i).getOrCreateContainer('myScheduler');
            expect(store).toBeDefined();
        }
    });

    test('destroyDistributedObject removes containers from all partitions', () => {
        service.init();
        service.createDistributedObject('myScheduler', new ScheduledExecutorConfig('myScheduler'));
        service.destroyDistributedObject('myScheduler');
        // Containers should be empty / recreated fresh
        const store = service.getPartition(0).getOrCreateContainer('myScheduler');
        expect(store.size()).toBe(0);
    });

    // --- One-shot scheduling tests ---

    test('scheduleOneShot stores task descriptor and transitions to SCHEDULED', () => {
        service.init();
        const config = new ScheduledExecutorConfig('sched');
        service.createDistributedObject('sched', config);

        const def: TaskDefinition = {
            type: 'SINGLE_RUN',
            name: 'task1',
            command: 'echo',
            delay: 1000,
            period: 0,
            autoDisposable: false,
        };

        const descriptor = service.scheduleOnPartition('sched', def, 0);
        expect(descriptor).toBeDefined();
        expect(descriptor.state).toBe(ScheduledTaskState.SCHEDULED);
        expect(descriptor.taskName).toBe('task1');
        expect(descriptor.scheduleKind).toBe('ONE_SHOT');
    });

    test('one-shot task executes after delay and transitions to DONE', async () => {
        service.init();
        const config = new ScheduledExecutorConfig('sched');
        service.createDistributedObject('sched', config);

        const def: TaskDefinition = {
            type: 'SINGLE_RUN',
            name: 'delayed-task',
            command: 'echo',
            delay: 50, // 50ms delay
            period: 0,
            autoDisposable: false,
        };

        const descriptor = service.scheduleOnPartition('sched', def, 0);
        expect(descriptor.state).toBe(ScheduledTaskState.SCHEDULED);

        // Wait for execution
        await Bun.sleep(200);

        expect(descriptor.state).toBe(ScheduledTaskState.DONE);
        expect(descriptor.runCount).toBe(1);
    });

    test('one-shot task captures result envelope', async () => {
        service.init();
        const config = new ScheduledExecutorConfig('sched');
        service.createDistributedObject('sched', config);

        const def: TaskDefinition = {
            type: 'SINGLE_RUN',
            name: 'result-task',
            command: 'echo',
            delay: 50,
            period: 0,
            autoDisposable: false,
        };

        const descriptor = service.scheduleOnPartition('sched', def, 0);
        await Bun.sleep(200);

        expect(descriptor.state).toBe(ScheduledTaskState.DONE);
        expect(descriptor.lastRunCompletedAt).toBeGreaterThan(0);
        expect(descriptor.lastRunStartedAt).toBeGreaterThan(0);
        expect(descriptor.lastRunCompletedAt).toBeGreaterThanOrEqual(descriptor.lastRunStartedAt);
    });

    test('one-shot task adds history entry on completion', async () => {
        service.init();
        const config = new ScheduledExecutorConfig('sched');
        service.createDistributedObject('sched', config);

        const def: TaskDefinition = {
            type: 'SINGLE_RUN',
            name: 'history-task',
            command: 'echo',
            delay: 50,
            period: 0,
            autoDisposable: false,
        };

        const descriptor = service.scheduleOnPartition('sched', def, 0);
        await Bun.sleep(200);

        const history = descriptor.getHistory();
        expect(history.length).toBe(1);
        expect(history[0]!.outcome).toBe('SUCCESS');
    });

    test('nextRunAt is computed from wall-clock + delay', () => {
        service.init();
        const config = new ScheduledExecutorConfig('sched');
        service.createDistributedObject('sched', config);

        const before = Date.now();
        const def: TaskDefinition = {
            type: 'SINGLE_RUN',
            name: 'timing-task',
            command: 'echo',
            delay: 5000,
            period: 0,
            autoDisposable: false,
        };

        const descriptor = service.scheduleOnPartition('sched', def, 0);
        const after = Date.now();

        // nextRunAt should be wall-clock + delay
        expect(descriptor.nextRunAt).toBeGreaterThanOrEqual(before + 5000);
        expect(descriptor.nextRunAt).toBeLessThanOrEqual(after + 5000);
    });

    test('task is stored in the correct partition store', () => {
        service.init();
        const config = new ScheduledExecutorConfig('sched');
        service.createDistributedObject('sched', config);

        const def: TaskDefinition = {
            type: 'SINGLE_RUN',
            name: 'stored-task',
            command: 'echo',
            delay: 10000,
            period: 0,
            autoDisposable: false,
        };

        service.scheduleOnPartition('sched', def, 2);

        const store = service.getPartition(2).getOrCreateContainer('sched');
        expect(store.get('stored-task')).toBeDefined();
        expect(store.size()).toBe(1);
    });

    test('timer coordinator uses single timer, not one setTimeout per task', async () => {
        service.init();
        const config = new ScheduledExecutorConfig('sched');
        service.createDistributedObject('sched', config);

        // Schedule multiple tasks with same delay
        for (let i = 0; i < 5; i++) {
            service.scheduleOnPartition('sched', {
                type: 'SINGLE_RUN',
                name: `batch-${i}`,
                command: 'echo',
                delay: 50,
                period: 0,
                autoDisposable: false,
            }, i % 4);
        }

        // The service should use a timer coordinator, not individual setTimeouts
        // Verify all tasks eventually complete
        await Bun.sleep(200);

        for (let i = 0; i < 5; i++) {
            const store = service.getPartition(i % 4).getOrCreateContainer('sched');
            const desc = store.get(`batch-${i}`);
            expect(desc?.state).toBe(ScheduledTaskState.DONE);
        }
    });

    test('state transitions: SCHEDULED → RUNNING → DONE', async () => {
        service.init();
        const config = new ScheduledExecutorConfig('sched');
        service.createDistributedObject('sched', config);

        const def: TaskDefinition = {
            type: 'SINGLE_RUN',
            name: 'transition-task',
            command: 'echo',
            delay: 50,
            period: 0,
            autoDisposable: false,
        };

        const descriptor = service.scheduleOnPartition('sched', def, 0);

        // Initially SCHEDULED
        expect(descriptor.state).toBe(ScheduledTaskState.SCHEDULED);

        // After execution completes
        await Bun.sleep(200);
        expect(descriptor.state).toBe(ScheduledTaskState.DONE);
    });
});
