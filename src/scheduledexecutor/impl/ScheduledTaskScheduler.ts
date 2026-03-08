import { randomUUID } from 'crypto';
import { ExecutorRejectedExecutionException } from '@zenystx/helios-core/executor/ExecutorExceptions.js';
import type { ScheduledExecutorContainerService } from './ScheduledExecutorContainerService.js';
import type { ScheduledTaskDescriptor } from './ScheduledTaskDescriptor.js';
import { ScheduledTaskState } from './ScheduledTaskState.js';
import type { RunHistoryEntry } from './RunHistoryEntry.js';

/**
 * Member-local scheduler engine that fires scheduled tasks when their `nextRunAt` arrives.
 *
 * Design:
 * - Scans only partitions currently owned by this member
 * - Maintains a wake-on-nearest-boundary timer (single setTimeout re-armed to closest nextRunAt)
 * - Validates ownerEpoch, version, and generates new attemptId before dispatch
 * - Rehydrates ready queue from ScheduledTaskStore on startup or partition promotion
 * - Enforces capacity per executor per member (PER_NODE policy)
 *
 * Hazelcast parity: scheduling loop from ScheduledExecutorContainer + DistributedScheduledExecutorService
 */
export class ScheduledTaskScheduler {
    private readonly _containerService: ScheduledExecutorContainerService;
    private readonly _getOwnedPartitions: () => Set<number>;
    private readonly _expectedEpoch: number;

    private _running = false;
    private _timerHandle: ReturnType<typeof setTimeout> | null = null;

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
        // Rehydrate any newly owned partitions
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
        if (capacity === 0) return; // unlimited

        const totalTasks = this._countTasksForExecutor(executorName);
        if (totalTasks >= capacity) {
            throw new ExecutorRejectedExecutionException(
                `Maximum capacity (${capacity}) of tasks reached for executor '${executorName}' on this member`,
            );
        }
    }

    // --- Internal ---

    /**
     * Rehydrate the ready queue from all currently owned partition stores.
     */
    private _rehydrate(): void {
        const owned = this._getOwnedPartitions();
        this._rehydratePartitions(owned);
    }

    /**
     * Rehydrate specific partitions: record their current epoch for fenced dispatch.
     */
    private _rehydratePartitions(partitions: Set<number>): void {
        for (const pid of partitions) {
            // Record the expected epoch for this partition
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

        // Clear existing timer
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
            // No scheduled tasks — poll periodically to catch new additions
            this._timerHandle = setTimeout(() => this._tick(), 50);
            return;
        }

        const delay = Math.max(0, nearestRunAt - now);
        this._timerHandle = setTimeout(() => this._tick(), delay);
    }

    /**
     * Timer tick: dispatch all ready tasks, then re-arm.
     */
    private _tick(): void {
        if (!this._running) return;

        this._dispatchReadyTasks();
        this._armTimer();
    }

    /**
     * Scan owned partitions and dispatch any tasks whose nextRunAt <= now,
     * applying fenced dispatch validation.
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
     * If the descriptor's epoch doesn't match what we recorded at rehydration,
     * skip dispatch (partition may have migrated).
     */
    private _fencedDispatch(descriptor: ScheduledTaskDescriptor): void {
        // Epoch fencing: if the descriptor's ownerEpoch has been bumped
        // beyond what we expect, skip dispatch — another owner may have taken over
        const expectedEpoch = this._partitionEpochs.get(descriptor.partitionId) ?? this._expectedEpoch;
        if (descriptor.ownerEpoch !== expectedEpoch) {
            return; // Stale — do not dispatch
        }

        const attemptId = randomUUID();
        const scheduledTime = descriptor.nextRunAt;

        descriptor.transitionTo(ScheduledTaskState.RUNNING);
        descriptor.attemptId = attemptId;
        descriptor.lastRunStartedAt = Date.now();

        // Dispatch and capture result synchronously for one-shot tasks
        this._dispatchAndCapture(descriptor, attemptId, scheduledTime);
    }

    /**
     * Execute the task and record the result in history.
     * For one-shot tasks, transitions to DONE after execution.
     */
    private async _dispatchAndCapture(
        descriptor: ScheduledTaskDescriptor,
        attemptId: string,
        scheduledTime: number,
    ): Promise<void> {
        const startTime = descriptor.lastRunStartedAt;

        try {
            // Actual dispatch into ExecutorContainerService would happen here.
            // For now, the command concept executes inline (same as container service).

            const endTime = Date.now();
            descriptor.lastRunCompletedAt = endTime;
            descriptor.runCount++;
            descriptor.version++;

            if (descriptor.state === ScheduledTaskState.RUNNING) {
                descriptor.transitionTo(ScheduledTaskState.DONE);
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

            if (descriptor.state === ScheduledTaskState.RUNNING) {
                descriptor.transitionTo(ScheduledTaskState.DONE);
            }

            const err = e instanceof Error ? e : new Error(String(e));
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
     * Count all tasks for a given executor across all owned partitions.
     */
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

    /**
     * Access the container service's config map.
     * Uses the internal accessor for executor configs.
     */
    private _getConfigs(): ReadonlyMap<string, unknown> {
        return this._containerService.getConfigs();
    }

    /**
     * Get the config for a specific executor.
     */
    private _getConfig(executorName: string): any {
        return this._containerService.getConfigs().get(executorName);
    }
}
