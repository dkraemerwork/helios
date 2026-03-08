import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { ScheduledTaskScheduler, computeNextAlignedSlot } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledTaskScheduler.js';
import { ScheduledExecutorContainerService } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledExecutorContainerService.js';
import { ScheduledTaskState } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledTaskState.js';
import { ScheduledExecutorConfig } from '@zenystx/helios-core/config/ScheduledExecutorConfig.js';
import type { TaskDefinition } from '@zenystx/helios-core/scheduledexecutor/impl/TaskDefinition.js';

function makePeriodicDefinition(overrides: Partial<TaskDefinition> = {}): TaskDefinition {
    return {
        type: 'AT_FIXED_RATE',
        name: overrides.name ?? '',
        command: overrides.command ?? 'periodic-handler',
        delay: overrides.delay ?? 0,
        period: overrides.period ?? 100,
        autoDisposable: overrides.autoDisposable ?? false,
    };
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

describe('PeriodicScheduling', () => {
    const EXECUTOR_NAME = 'periodicExecutor';
    const PARTITION_COUNT = 4;
    let containerService: ScheduledExecutorContainerService;
    let scheduler: ScheduledTaskScheduler;
    let config: ScheduledExecutorConfig;

    beforeEach(() => {
        config = new ScheduledExecutorConfig(EXECUTOR_NAME);
        containerService = new ScheduledExecutorContainerService(PARTITION_COUNT);
        containerService.init();
        containerService.createDistributedObject(EXECUTOR_NAME, config);
        containerService.stopTimerCoordinator();

        const ownedPartitions = new Set([0, 1, 2, 3]);
        scheduler = new ScheduledTaskScheduler(containerService, () => ownedPartitions, 0);
    });

    afterEach(async () => {
        scheduler.stop();
        await containerService.shutdown();
    });

    // ── Fixed-rate cadence alignment ──────────────────────────────────

    test('periodic task fires multiple times at fixed-rate cadence', async () => {
        const def = makePeriodicDefinition({ name: 'cadence-task', delay: 20, period: 60 });
        const descriptor = containerService.scheduleOnPartition(EXECUTOR_NAME, def, 0);

        scheduler.start();
        // Wait enough for at least 3 firings: delay(20) + period(60) + period(60) + margin
        await sleep(250);

        expect(descriptor.runCount).toBeGreaterThanOrEqual(3);
        expect(descriptor.state).toBe(ScheduledTaskState.SCHEDULED);
    });

    test('nextRunAt is aligned to original cadence timeline (initialDelay + N*period)', async () => {
        const def = makePeriodicDefinition({ name: 'alignment-task', delay: 30, period: 80 });
        const descriptor = containerService.scheduleOnPartition(EXECUTOR_NAME, def, 0);
        const creationTime = descriptor.nextRunAt - 30; // reconstruct creation time

        scheduler.start();
        // Wait for 2 firings: delay(30) + period(80) + margin
        await sleep(200);

        expect(descriptor.runCount).toBeGreaterThanOrEqual(2);
        // nextRunAt should be aligned to creationTime + N*period for some N
        const elapsed = descriptor.nextRunAt - creationTime;
        const remainder = elapsed % 80;
        // Should be aligned to the cadence (remainder ≈ initialDelay mod period, or 0 if delay < period)
        expect(remainder).toBe(30); // initialDelay + N*period => remainder is always initialDelay
    });

    test('periodic task stays in SCHEDULED state between firings', async () => {
        const def = makePeriodicDefinition({ name: 'state-task', delay: 20, period: 80 });
        const descriptor = containerService.scheduleOnPartition(EXECUTOR_NAME, def, 0);

        scheduler.start();
        await sleep(60); // After first firing

        // Between firings, task should be back in SCHEDULED (waiting for next period)
        expect(descriptor.runCount).toBeGreaterThanOrEqual(1);
        // After dispatch+capture completes, state should be SCHEDULED (rescheduled), not DONE
        if (descriptor.state !== ScheduledTaskState.RUNNING) {
            expect(descriptor.state).toBe(ScheduledTaskState.SCHEDULED);
        }
    });

    test('periodic task history records each firing separately', async () => {
        const def = makePeriodicDefinition({ name: 'history-task', delay: 10, period: 50 });
        const descriptor = containerService.scheduleOnPartition(EXECUTOR_NAME, def, 0);

        scheduler.start();
        await sleep(180);

        const history = descriptor.getHistory();
        expect(history.length).toBeGreaterThanOrEqual(3);
        // Each history entry should have a unique attemptId
        const attemptIds = new Set(history.map((h) => h.attemptId));
        expect(attemptIds.size).toBe(history.length);
    });

    // ── No-overlap skip ──────────────────────────────────────────────

    test('overlapping execution is skipped when previous run still active', async () => {
        const def = makePeriodicDefinition({ name: 'overlap-task', delay: 10, period: 30 });
        const descriptor = containerService.scheduleOnPartition(EXECUTOR_NAME, def, 0);

        // Install a slow task executor that takes longer than the period
        scheduler.setTaskExecutor(async () => {
            await sleep(80); // Takes 80ms, period is 30ms
        });

        scheduler.start();
        await sleep(200);

        // Despite enough time for ~6 firings at 30ms period, only 2 should have
        // actually executed because each takes 80ms (no overlap)
        expect(descriptor.runCount).toBeGreaterThanOrEqual(1);
        expect(descriptor.runCount).toBeLessThanOrEqual(3);
    });

    test('skipped overlapping execution does not record history entry', async () => {
        const def = makePeriodicDefinition({ name: 'skip-history-task', delay: 10, period: 30 });
        const descriptor = containerService.scheduleOnPartition(EXECUTOR_NAME, def, 0);

        scheduler.setTaskExecutor(async () => {
            await sleep(80);
        });

        scheduler.start();
        await sleep(200);

        // History should only contain entries for runs that actually executed
        expect(descriptor.getHistory().length).toBe(descriptor.runCount);
    });

    // ── Exception suppression ────────────────────────────────────────

    test('periodic task exception suppresses all future firings', async () => {
        const def = makePeriodicDefinition({ name: 'error-task', delay: 10, period: 40 });
        const descriptor = containerService.scheduleOnPartition(EXECUTOR_NAME, def, 0);

        let callCount = 0;
        scheduler.setTaskExecutor(async () => {
            callCount++;
            if (callCount === 2) {
                throw new Error('Simulated failure');
            }
        });

        scheduler.start();
        await sleep(300);

        // Should have run exactly 2 times: first success, second throws
        expect(descriptor.runCount).toBe(2);
        expect(descriptor.state).toBe(ScheduledTaskState.SUPPRESSED);
    });

    test('exception suppression records failure in history', async () => {
        const def = makePeriodicDefinition({ name: 'error-history-task', delay: 10, period: 40 });
        const descriptor = containerService.scheduleOnPartition(EXECUTOR_NAME, def, 0);

        scheduler.setTaskExecutor(async () => {
            throw new Error('Always fails');
        });

        scheduler.start();
        await sleep(100);

        expect(descriptor.runCount).toBe(1);
        const history = descriptor.getHistory();
        expect(history.length).toBe(1);
        expect(history[0]!.outcome).toBe('FAILURE');
        expect(history[0]!.errorSummary).toBe('Always fails');
        expect(descriptor.state).toBe(ScheduledTaskState.SUPPRESSED);
    });

    test('suppressed periodic task is not rescheduled', async () => {
        const def = makePeriodicDefinition({ name: 'no-resched-task', delay: 10, period: 40 });
        const descriptor = containerService.scheduleOnPartition(EXECUTOR_NAME, def, 0);

        scheduler.setTaskExecutor(async () => {
            throw new Error('fail');
        });

        scheduler.start();
        await sleep(200);

        // Still suppressed, not rescheduled
        expect(descriptor.state).toBe(ScheduledTaskState.SUPPRESSED);
        expect(descriptor.runCount).toBe(1);
    });

    // ── Named periodic duplicate rejection ───────────────────────────

    test('named periodic task rejects duplicate with same name', () => {
        const def1 = makePeriodicDefinition({ name: 'unique-periodic', delay: 10, period: 100 });
        const def2 = makePeriodicDefinition({ name: 'unique-periodic', delay: 20, period: 200 });

        containerService.scheduleOnPartition(EXECUTOR_NAME, def1, 0);

        expect(() => {
            containerService.scheduleOnPartition(EXECUTOR_NAME, def2, 0);
        }).toThrow(/Duplicate task/);
    });

    test('unnamed periodic tasks get unique names and do not conflict', () => {
        const def1 = makePeriodicDefinition({ name: '', delay: 10, period: 100 });
        const def2 = makePeriodicDefinition({ name: '', delay: 20, period: 200 });

        const d1 = containerService.scheduleOnPartition(EXECUTOR_NAME, def1, 0);
        const d2 = containerService.scheduleOnPartition(EXECUTOR_NAME, def2, 0);

        expect(d1.taskName).not.toBe(d2.taskName);
        expect(d1.taskName.length).toBeGreaterThan(0);
        expect(d2.taskName.length).toBeGreaterThan(0);
    });

    // ── Recovery catch-up ────────────────────────────────────────────

    test('recovery coalesces overdue firings to one catch-up run', async () => {
        const def = makePeriodicDefinition({ name: 'recovery-task', delay: 10, period: 30 });
        const descriptor = containerService.scheduleOnPartition(EXECUTOR_NAME, def, 0);

        // Simulate the task was suspended for a long time — multiple periods have passed
        descriptor.transitionTo(ScheduledTaskState.SUSPENDED);
        // Set nextRunAt far in the past (many periods overdue)
        descriptor.nextRunAt = Date.now() - 300; // 10 periods overdue at 30ms/period

        // Now "recover" — transition back to SCHEDULED
        descriptor.transitionTo(ScheduledTaskState.SCHEDULED);

        scheduler.start();
        await sleep(100);

        // Should have done ONE catch-up run (coalesced), not 10
        // Then rescheduled to the next aligned slot
        expect(descriptor.runCount).toBeGreaterThanOrEqual(1);
        // After catch-up, nextRunAt should be in the future (next aligned slot)
        expect(descriptor.nextRunAt).toBeGreaterThan(Date.now() - 10);
    });

    test('after recovery catch-up, next slot is aligned to original cadence', async () => {
        const period = 50;
        const def = makePeriodicDefinition({ name: 'align-recovery', delay: 10, period });
        const descriptor = containerService.scheduleOnPartition(EXECUTOR_NAME, def, 0);
        const originalNextRunAt = descriptor.nextRunAt; // creationTime + 10

        // Suspend and simulate being overdue — keep nextRunAt on cadence but in the past
        descriptor.transitionTo(ScheduledTaskState.SUSPENDED);
        // Set to an overdue cadence-aligned slot (originalNextRunAt was the first slot)
        descriptor.nextRunAt = originalNextRunAt - 200; // way overdue but still aligned relative to anchor
        descriptor.transitionTo(ScheduledTaskState.SCHEDULED);

        scheduler.start();
        await sleep(80);

        // After catch-up, nextRunAt should be strictly in the future
        expect(descriptor.nextRunAt).toBeGreaterThan(Date.now() - 10);
        // nextRunAt should be aligned to the anchor (originalNextRunAt - 200) + N*period
        const elapsed = descriptor.nextRunAt - (originalNextRunAt - 200);
        expect(elapsed % period).toBe(0); // aligned to cadence
    });

    test('recovery does not fire catch-up if task was cancelled during suspension', async () => {
        const def = makePeriodicDefinition({ name: 'cancel-during-suspend', delay: 10, period: 30 });
        const descriptor = containerService.scheduleOnPartition(EXECUTOR_NAME, def, 0);

        descriptor.transitionTo(ScheduledTaskState.SUSPENDED);
        descriptor.transitionTo(ScheduledTaskState.DISPOSED);

        // Store would have removed it on dispose
        const store = containerService.getPartition(0).getOrCreateContainer(EXECUTOR_NAME);
        store.remove('cancel-during-suspend');

        scheduler.start();
        await sleep(100);

        expect(descriptor.runCount).toBe(0);
    });

    // ── Cadence math verification ────────────────────────────────────

    test('next-aligned-slot computation is correct for various scenarios', () => {
        // Test the math: given creationTime, initialDelay, period, and now,
        // compute the next aligned slot
        const creationTime = 1000;
        const initialDelay = 50;
        const period = 100;
        const firstFiring = creationTime + initialDelay; // 1050

        // After first run completes at t=1060, next should be 1150
        let now = 1060;
        let nextSlot = computeNextAlignedSlot(firstFiring, period, now);
        expect(nextSlot).toBe(1150);

        // After second run completes at t=1160, next should be 1250
        now = 1160;
        nextSlot = computeNextAlignedSlot(firstFiring, period, now);
        expect(nextSlot).toBe(1250);

        // If we're exactly on a boundary
        now = 1250;
        nextSlot = computeNextAlignedSlot(firstFiring, period, now);
        expect(nextSlot).toBe(1350);

        // If we missed several periods (recovery scenario)
        now = 1600;
        nextSlot = computeNextAlignedSlot(firstFiring, period, now);
        expect(nextSlot).toBe(1650);
    });

    test('one-shot task is not rescheduled after completion', async () => {
        const def: TaskDefinition = {
            type: 'SINGLE_RUN',
            name: 'one-shot-no-resched',
            command: 'handler',
            delay: 20,
            period: 0,
            autoDisposable: false,
        };
        const descriptor = containerService.scheduleOnPartition(EXECUTOR_NAME, def, 0);

        scheduler.start();
        await sleep(150);

        expect(descriptor.runCount).toBe(1);
        expect(descriptor.state).toBe(ScheduledTaskState.DONE);
    });

    test('cancelled periodic task is not rescheduled after cancellation', async () => {
        const def = makePeriodicDefinition({ name: 'cancel-periodic', delay: 10, period: 200 });
        const descriptor = containerService.scheduleOnPartition(EXECUTOR_NAME, def, 0);

        scheduler.start();
        await sleep(50); // First firing happens (delay=10), well before second (delay+period=210)

        expect(descriptor.runCount).toBe(1);
        // Cancel while between firings
        containerService.cancelTask(EXECUTOR_NAME, 'cancel-periodic', 0);
        await sleep(250);

        // Should have fired once, then been cancelled — no further firings
        expect(descriptor.runCount).toBe(1);
        expect(descriptor.state).toBe(ScheduledTaskState.CANCELLED);
    });

    test('next-aligned-slot handles edge case where now equals a slot boundary', () => {
        const firstFiring = 1000;
        const period = 100;

        // Exactly on a boundary — should advance to next
        const nextSlot = computeNextAlignedSlot(firstFiring, period, 1200);
        expect(nextSlot).toBe(1300);
    });
});

