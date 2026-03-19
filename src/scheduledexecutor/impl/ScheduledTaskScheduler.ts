import { ExecutorRejectedExecutionException } from '@zenystx/helios-core/executor/ExecutorExceptions.js';
import { randomUUID } from 'crypto';
import type { RunHistoryEntry } from './RunHistoryEntry.js';
import type { ScheduledExecutorContainerService } from './ScheduledExecutorContainerService.js';
import type { ScheduledTaskDescriptor } from './ScheduledTaskDescriptor.js';
import { ScheduledTaskState } from './ScheduledTaskState.js';

/**
 * Optional callback for executing task logic. When set, the scheduler invokes
 * this function during dispatch. Used for testing and production wiring.
 */
export type TaskExecutorFn = (descriptor: ScheduledTaskDescriptor) => Promise<void> | void;

/**
 * Compute the next fixed-rate slot strictly after `now`, aligned to the
 * original cadence timeline: `firstFiringTime + N * period`.
 */
export function computeNextAlignedSlot(firstFiringTime: number, period: number, now: number): number {
    if (now < firstFiringTime) return firstFiringTime;
    const elapsed = now - firstFiringTime;
    const periodsPassed = Math.floor(elapsed / period) + 1;
    return firstFiringTime + periodsPassed * period;
}

/**
 * Member-local scheduler engine that fires scheduled tasks when their `nextRunAt` arrives.
 *
 * Design:
 * - Scans only partitions currently owned by this member
 * - Maintains a wake-on-nearest-boundary timer (single setTimeout re-armed to closest nextRunAt)
 * - Validates ownerEpoch, version, and generates new attemptId before dispatch
 * - Rehydrates ready queue from ScheduledTaskStore on startup or partition promotion
 * - Enforces capacity per executor per member (PER_NODE policy)
 * - Supports fixed-rate periodic tasks with no-overlap skip and exception suppression
 *
 * Hazelcast parity: scheduling loop from ScheduledExecutorContainer + DistributedScheduledExecutorService
 */
export class ScheduledTaskScheduler {
    private readonly _containerService: ScheduledExecutorContainerService;
    private readonly _getOwnedPartitions: () => Set<number>;
    private readonly _expectedEpoch: number;

    private _running = false;
    private _timerHandle: ReturnType<typeof setTimeout> | null = null;
    private _taskExecutor: TaskExecutorFn | null = null;

    /**
     * Snapshot of ownerEpoch per partition at the time they were last rehydrated.
     * Used for fenced dispatch: if the descriptor's epoch doesn't match, skip dispatch.
     */
    private readonly _partitionEpochs = new Map<number, number>();

    constructor(
        containerService: ScheduledExecutorContainerService,
        getOwnedPartitions: () => Set<number>,
        expectedEpoch: number,
    ) {
        this._containerService = containerService;
        this._getOwnedPartitions = getOwnedPartitions;
        this._expectedEpoch = expectedEpoch;
    }

    /**
     * Set a task executor callback for executing task logic during dispatch.
     */
    setTaskExecutor(executor: TaskExecutorFn): void {
        this._taskExecutor = executor;
    }

    /**
     * Start the scheduler loop. Rehydrates ready queue from store and arms the timer.
     */
    start(): void {
        if (this._running) return;
        this._running = true;
        this._rehydrate();
        this._armTimer();
    }

    /**
     * Stop the scheduler loop and clear the timer.
     */
    stop(): void {
        this._running = false;
        if (this._timerHandle !== null) {
            clearTimeout(this._timerHandle);
            this._timerHandle = null;
        }
    }

    /**
     * Notify the scheduler that a new task was added — may need to re-arm the timer
     * to an earlier boundary.
     */
    notifyNewTask(): void {
        if (!this._running) return;
        this._armTimer();
    }

    /**
     * Update the set of owned partitions (e.g. after partition promotion/migration).
     * Rehydrates newly owned partitions and re-arms the timer.
     */
    updateOwnedPartitions(newOwned: Set<number>): void {
        this._rehydratePartitions(newOwned);
        this._armTimer();
    }

    /**
     * Enforce capacity for a given executor. Throws if at or over capacity (PER_NODE).
     * capacity=0 means unlimited.
     */
    enforceCapacity(executorName: string, _partitionId: number): void {
        const config = this._getConfig(executorName);
        if (!config) return;

        const capacity = config.getCapacity();
        if (capacity === 0) return;

        const totalTasks = this._countTasksForExecutor(executorName);
        if (totalTasks >= capacity) {
            throw new ExecutorRejectedExecutionException(
                `Maximum capacity (${capacity}) of tasks reached for executor '${executorName}' on this member`,
            );
        }
    }

    // --- Internal ---

    private _rehydrate(): void {
        const owned = this._getOwnedPartitions();
        this._rehydratePartitions(owned);
    }

    private _rehydratePartitions(partitions: Set<number>): void {
        for (const pid of partitions) {
            if (!this._partitionEpochs.has(pid)) {
                this._partitionEpochs.set(pid, this._expectedEpoch);
            }
        }
    }

    /**
     * Find the nearest nextRunAt across all owned partitions and arm a single timer.
     */
    private _armTimer(): void {
        if (!this._running) return;

        if (this._timerHandle !== null) {
            clearTimeout(this._timerHandle);
            this._timerHandle = null;
        }

        const now = Date.now();
        let nearestRunAt = Infinity;

        const owned = this._getOwnedPartitions();
        for (const pid of owned) {
            const partition = this._containerService.getPartition(pid);
            if (!partition) continue;

            for (const [executorName] of this._getConfigs()) {
                const store = partition.getOrCreateContainer(executorName);
                for (const descriptor of store.getAll()) {
                    if (descriptor.state === ScheduledTaskState.SCHEDULED && descriptor.nextRunAt < nearestRunAt) {
                        nearestRunAt = descriptor.nextRunAt;
                    }
                }
            }
        }

        if (nearestRunAt === Infinity) {
            this._timerHandle = setTimeout(() => this._tick(), 50);
            return;
        }

        const delay = Math.max(0, nearestRunAt - now);
        this._timerHandle = setTimeout(() => this._tick(), delay);
    }

    private _tick(): void {
        if (!this._running) return;
        this._dispatchReadyTasks();
        this._armTimer();
    }

    /**
     * Scan owned partitions and dispatch any tasks whose nextRunAt <= now.
     * For FIXED_RATE tasks, a task in RUNNING state is skipped (no-overlap).
     */
    private _dispatchReadyTasks(): void {
        const now = Date.now();
        const owned = this._getOwnedPartitions();

        for (const pid of owned) {
            const partition = this._containerService.getPartition(pid);
            if (!partition) continue;

            for (const [executorName] of this._getConfigs()) {
                const store = partition.getOrCreateContainer(executorName);
                for (const descriptor of store.getAll()) {
                    if (
                        descriptor.state === ScheduledTaskState.SCHEDULED &&
                        descriptor.nextRunAt <= now
                    ) {
                        this._fencedDispatch(descriptor);
                    }
                }
            }
        }
    }

    /**
     * Fenced dispatch: validate ownerEpoch before firing.
     */
    private _fencedDispatch(descriptor: ScheduledTaskDescriptor): void {
        const expectedEpoch = this._partitionEpochs.get(descriptor.partitionId) ?? this._expectedEpoch;
        if (descriptor.ownerEpoch !== expectedEpoch) {
            return;
        }

        const attemptId = randomUUID();
        const scheduledTime = descriptor.nextRunAt;

        descriptor.transitionTo(ScheduledTaskState.RUNNING);
        descriptor.attemptId = attemptId;
        descriptor.lastRunStartedAt = Date.now();

        this._dispatchAndCapture(descriptor, attemptId, scheduledTime);
    }

    /**
     * Execute the task and record the result in history.
     * For one-shot tasks, transitions to DONE.
     * For fixed-rate periodic tasks:
     *   - On success: reschedule to next aligned slot
     *   - On failure: suppress all future firings (transition to SUPPRESSED)
     */
    private async _dispatchAndCapture(
        descriptor: ScheduledTaskDescriptor,
        attemptId: string,
        scheduledTime: number,
    ): Promise<void> {
        const startTime = descriptor.lastRunStartedAt;
        const isFixedRate = descriptor.scheduleKind === 'FIXED_RATE' && descriptor.periodMillis > 0;

        try {
            if (this._taskExecutor) {
                await this._taskExecutor(descriptor);
            }

            const endTime = Date.now();
            descriptor.lastRunCompletedAt = endTime;
            descriptor.runCount++;
            descriptor.version++;

            if (descriptor.state === ScheduledTaskState.RUNNING) {
                if (isFixedRate) {
                    this._rescheduleFixedRate(descriptor, endTime);
                } else {
                    descriptor.transitionTo(ScheduledTaskState.DONE);
                }
            }

            const entry: RunHistoryEntry = {
                attemptId,
                scheduledTime,
                startTime,
                endTime,
                outcome: 'SUCCESS',
                ownerEpoch: descriptor.ownerEpoch,
                version: descriptor.version,
            };
            descriptor.addHistoryEntry(entry);
        } catch (e) {
            const endTime = Date.now();
            descriptor.lastRunCompletedAt = endTime;
            descriptor.runCount++;
            descriptor.version++;

            const err = e instanceof Error ? e : new Error(String(e));

            if (descriptor.state === ScheduledTaskState.RUNNING) {
                if (isFixedRate) {
                    // Exception suppression: periodic task failure is terminal
                    descriptor.transitionTo(ScheduledTaskState.SUPPRESSED);
                } else {
                    descriptor.transitionTo(ScheduledTaskState.DONE);
                }
            }

            const entry: RunHistoryEntry = {
                attemptId,
                scheduledTime,
                startTime,
                endTime,
                outcome: 'FAILURE',
                errorSummary: err.message,
                ownerEpoch: descriptor.ownerEpoch,
                version: descriptor.version,
            };
            descriptor.addHistoryEntry(entry);
        }
    }

    /**
     * Reschedule a fixed-rate task to the next aligned cadence slot.
     * The cadence timeline is anchored at `creationTime + initialDelay` (the first firing time),
     * and each subsequent slot is `firstFiringTime + N * period`.
     *
     * After recovery, this naturally coalesces: one catch-up run was just executed,
     * and now we compute the next slot strictly after `now`.
     */
    private _rescheduleFixedRate(descriptor: ScheduledTaskDescriptor, now: number): void {
        // Compute next aligned slot strictly after now.
        // The cadence is anchored at the current nextRunAt (which is always aligned),
        // so computeNextAlignedSlot preserves the original timeline alignment.
        const nextSlot = computeNextAlignedSlot(descriptor.nextRunAt, descriptor.periodMillis, now);
        descriptor.nextRunAt = nextSlot;
        descriptor.transitionTo(ScheduledTaskState.SCHEDULED);
    }

    private _countTasksForExecutor(executorName: string): number {
        let count = 0;
        const owned = this._getOwnedPartitions();
        for (const pid of owned) {
            const partition = this._containerService.getPartition(pid);
            if (!partition) continue;
            const store = partition.getOrCreateContainer(executorName);
            count += store.size();
        }
        return count;
    }

    private _getConfigs(): ReadonlyMap<string, unknown> {
        return this._containerService.getConfigs();
    }

    private _getConfig(executorName: string): any {
        return this._containerService.getConfigs().get(executorName);
    }
}
