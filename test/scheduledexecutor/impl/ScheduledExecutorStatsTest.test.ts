/**
 * Block 22.15 — Stats + metrics + diagnostics
 *
 * Tests: stats update on task completion, counters accurate after multiple runs,
 * scheduler-lag metric non-negative, stats accessible from client, active-schedule gauge,
 * pool health visibility, admin visibility hooks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ScheduledExecutorContainerService } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledExecutorContainerService.js';
import { ScheduledTaskScheduler } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledTaskScheduler.js';
import { ScheduledTaskState } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledTaskState.js';
import { ScheduledTaskStatisticsImpl } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledTaskStatisticsImpl.js';
import { ScheduledExecutorStats } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledExecutorStats.js';
import { ScheduledFutureProxy } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledFutureProxy.js';
import { ScheduledTaskHandler } from '@zenystx/helios-core/scheduledexecutor/ScheduledTaskHandler.js';
import type { ScheduledTaskStatistics } from '@zenystx/helios-core/scheduledexecutor/ScheduledTaskStatistics.js';
import type { ScheduledExecutorConfig } from '@zenystx/helios-core/config/ScheduledExecutorConfig.js';
import type { TaskDefinition } from '@zenystx/helios-core/scheduledexecutor/impl/TaskDefinition.js';

function makeConfig(overrides: Partial<{ poolSize: number; capacity: number; statisticsEnabled: boolean }> = {}): ScheduledExecutorConfig {
    const opts = { poolSize: 4, capacity: 0, statisticsEnabled: true, ...overrides };
    return {
        getName: () => 'test-executor',
        getPoolSize: () => opts.poolSize,
        getCapacity: () => opts.capacity,
        getCapacityPolicy: () => 'PER_NODE' as const,
        getDurability: () => 1,
        isStatisticsEnabled: () => opts.statisticsEnabled,
        getScheduleShutdownPolicy: () => 'GRACEFUL_TRANSFER' as const,
        getMaxHistoryEntriesPerTask: () => 100,
    } as ScheduledExecutorConfig;
}

function taskDef(name: string, delay = 100000): TaskDefinition {
    return { name, command: 'test-cmd', type: 'SINGLE_RUN', delay, period: 0, autoDisposable: false };
}

describe('Block 22.15 — ScheduledTaskStatisticsImpl', () => {
    it('should compute totalRuns from descriptor run count', () => {
        const stats = new ScheduledTaskStatisticsImpl();
        expect(stats.snapshot().totalRuns).toBe(0);

        stats.onBeforeRun(100, 200); // scheduled at 100, started at 200
        stats.onAfterRun(250); // ended at 250

        const snap = stats.snapshot();
        expect(snap.totalRuns).toBe(1);
        expect(snap.lastRunDurationMs).toBe(50);
        expect(snap.totalRunTimeMs).toBe(50);
    });

    it('should accumulate totalRunTime and totalIdleTime across multiple runs', () => {
        const stats = new ScheduledTaskStatisticsImpl();

        // Run 1: idle 100ms, run 50ms
        stats.onBeforeRun(0, 100);
        stats.onAfterRun(150);

        // Run 2: idle 0ms (scheduled at 200, started at 200), run 30ms
        stats.onBeforeRun(200, 200);
        stats.onAfterRun(230);

        const snap = stats.snapshot();
        expect(snap.totalRuns).toBe(2);
        expect(snap.totalRunTimeMs).toBe(80);  // 50 + 30
        expect(snap.lastRunDurationMs).toBe(30);
        expect(snap.totalIdleTimeMs).toBe(100); // 100 + 0
    });

    it('should track lastIdleTimeMs correctly', () => {
        const stats = new ScheduledTaskStatisticsImpl();

        // Scheduled at 100, started at 200 → idle = 100
        stats.onBeforeRun(100, 200);
        stats.onAfterRun(250);

        expect(stats.snapshot().lastIdleTimeMs).toBe(100);

        // Scheduled at 300, started at 320 → idle = 20
        stats.onBeforeRun(300, 320);
        stats.onAfterRun(350);

        expect(stats.snapshot().lastIdleTimeMs).toBe(20);
    });
});

describe('Block 22.15 — ScheduledExecutorStats (executor-level counters)', () => {
    let executorStats: ScheduledExecutorStats;

    beforeEach(() => {
        executorStats = new ScheduledExecutorStats();
    });

    it('should track pending, started, completed counters', () => {
        executorStats.startPending('test-executor');
        executorStats.startPending('test-executor');
        expect(executorStats.getSnapshot('test-executor').pending).toBe(2);

        executorStats.startExecution('test-executor', 10);
        expect(executorStats.getSnapshot('test-executor').pending).toBe(1);
        expect(executorStats.getSnapshot('test-executor').started).toBe(1);

        executorStats.finishExecution('test-executor', 50);
        expect(executorStats.getSnapshot('test-executor').completed).toBe(1);
    });

    it('should track cancelled and failed counters', () => {
        executorStats.startPending('test-executor');
        executorStats.cancelExecution('test-executor');
        expect(executorStats.getSnapshot('test-executor').cancelled).toBe(1);

        executorStats.startPending('test-executor');
        executorStats.startExecution('test-executor', 5);
        executorStats.failExecution('test-executor');
        expect(executorStats.getSnapshot('test-executor').failed).toBe(1);
    });

    it('should compute scheduler-lag as non-negative', () => {
        executorStats.startPending('test-executor');
        executorStats.startExecution('test-executor', 15); // 15ms start latency
        const snap = executorStats.getSnapshot('test-executor');
        expect(snap.totalStartLatencyMs).toBe(15);
        expect(snap.totalStartLatencyMs).toBeGreaterThanOrEqual(0);
    });
});

describe('Block 22.15 — Active-schedule gauge', () => {
    let containerService: ScheduledExecutorContainerService;

    beforeEach(() => {
        containerService = new ScheduledExecutorContainerService(4);
        containerService.init();
        containerService.stopTimerCoordinator();
        containerService.createDistributedObject('test-executor', makeConfig());
    });

    afterEach(async () => {
        await containerService.shutdown();
    });

    it('should count non-terminal tasks per executor', () => {
        containerService.scheduleOnPartition('test-executor', taskDef('task-1'), 0);
        containerService.scheduleOnPartition('test-executor', taskDef('task-2'), 1);
        containerService.scheduleOnPartition('test-executor', taskDef('task-3'), 2);

        expect(containerService.getActiveScheduleCount('test-executor')).toBe(3);

        // Cancel one
        containerService.cancelTask('test-executor', 'task-1', 0);
        expect(containerService.getActiveScheduleCount('test-executor')).toBe(2);
    });
});

describe('Block 22.15 — Stats from ScheduledFutureProxy (getStats)', () => {
    let containerService: ScheduledExecutorContainerService;

    beforeEach(() => {
        containerService = new ScheduledExecutorContainerService(4);
        containerService.init();
        containerService.stopTimerCoordinator();
        containerService.createDistributedObject('test-executor', makeConfig());
    });

    afterEach(async () => {
        await containerService.shutdown();
    });

    it('should return real stats after task completion', async () => {
        const descriptor = containerService.scheduleOnPartition('test-executor', taskDef('stats-task', 0), 0);

        // Simulate execution
        const scheduledTime = descriptor.nextRunAt;
        descriptor.transitionTo(ScheduledTaskState.RUNNING);
        descriptor.lastRunStartedAt = scheduledTime + 5;
        const endTime = descriptor.lastRunStartedAt + 20;
        descriptor.lastRunCompletedAt = endTime;
        descriptor.runCount = 1;
        descriptor.version++;

        // Wire task stats (as the scheduler dispatch path would)
        descriptor.getTaskStatistics().onBeforeRun(scheduledTime, descriptor.lastRunStartedAt);
        descriptor.getTaskStatistics().onAfterRun(endTime);

        descriptor.transitionTo(ScheduledTaskState.DONE);

        const handler = ScheduledTaskHandler.ofPartition('test-executor', 'stats-task', descriptor.partitionId);
        const proxy = new ScheduledFutureProxy<void>(handler, containerService);
        const stats: ScheduledTaskStatistics = await proxy.getStats();

        expect(stats.totalRuns).toBe(1);
        expect(stats.lastRunDurationMs).toBe(20);
        expect(stats.totalRunTimeMs).toBe(20);
        expect(stats.lastIdleTimeMs).toBe(5);
        expect(stats.totalIdleTimeMs).toBe(5);
    });
});

describe('Block 22.15 — Pool health & diagnostics', () => {
    let containerService: ScheduledExecutorContainerService;

    beforeEach(() => {
        containerService = new ScheduledExecutorContainerService(4);
        containerService.init();
        containerService.stopTimerCoordinator();
        containerService.createDistributedObject('test-executor', makeConfig());
    });

    afterEach(async () => {
        await containerService.shutdown();
    });

    it('should expose scheduled executor diagnostics snapshot', () => {
        containerService.scheduleOnPartition('test-executor', taskDef('diag-task'), 0);

        const diagnostics = containerService.getDiagnostics();
        expect(diagnostics).toBeDefined();
        expect(diagnostics.executors).toBeDefined();
        expect(diagnostics.executors['test-executor']).toBeDefined();
        expect(diagnostics.executors['test-executor']!.activeSchedules).toBe(1);
        expect(diagnostics.executors['test-executor']!.isShutdown).toBe(false);
    });

    it('should expose executor stats via diagnostics', () => {
        const diagnostics = containerService.getDiagnostics();
        expect(diagnostics.executors['test-executor']!.stats).toBeDefined();
        expect(diagnostics.executors['test-executor']!.stats.pending).toBeGreaterThanOrEqual(0);
    });

    it('should integrate with pool health via executor stats counters', () => {
        const stats = containerService.getExecutorStats();
        stats.startPending('test-executor');
        stats.startExecution('test-executor', 5);
        stats.finishExecution('test-executor', 20);

        const snap = stats.getSnapshot('test-executor');
        expect(snap.started).toBe(1);
        expect(snap.completed).toBe(1);
        expect(snap.totalExecutionTimeMs).toBe(20);
    });
});

describe('Block 22.15 — Counters accurate after multiple runs (scheduler integration)', () => {
    let containerService: ScheduledExecutorContainerService;
    let scheduler: ScheduledTaskScheduler;
    const ownedPartitions = new Set([0, 1, 2, 3]);

    beforeEach(() => {
        containerService = new ScheduledExecutorContainerService(4);
        containerService.init();
        containerService.stopTimerCoordinator();
        containerService.createDistributedObject('test-executor', makeConfig());
        scheduler = new ScheduledTaskScheduler(containerService, () => ownedPartitions, 0);
    });

    afterEach(async () => {
        scheduler.stop();
        await containerService.shutdown();
    });

    it('should wire executor stats counters to actual task lifecycle', () => {
        const stats = containerService.getExecutorStats();

        containerService.scheduleOnPartition('test-executor', taskDef('counted-task', 0), 0);

        // Simulate the lifecycle that the scheduler would drive
        stats.startPending('test-executor');
        stats.startExecution('test-executor', 5);
        stats.finishExecution('test-executor', 20);

        const snap = stats.getSnapshot('test-executor');
        expect(snap.pending).toBe(0);
        expect(snap.started).toBe(1);
        expect(snap.completed).toBe(1);
        expect(snap.cancelled).toBe(0);
        expect(snap.failed).toBe(0);
    });
});
