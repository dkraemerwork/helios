import { randomUUID } from 'crypto';
import type { ScheduledExecutorConfig } from '@zenystx/helios-core/config/ScheduledExecutorConfig.js';
import { ExecutorRejectedExecutionException } from '@zenystx/helios-core/executor/ExecutorExceptions.js';
import { StaleTaskException } from '@zenystx/helios-core/scheduledexecutor/StaleTaskException.js';
import { ScheduledExecutorMemberBin } from './ScheduledExecutorMemberBin.js';
import { ScheduledExecutorPartition } from './ScheduledExecutorPartition.js';
import { ScheduledTaskDescriptor } from './ScheduledTaskDescriptor.js';
import { ScheduledTaskState } from './ScheduledTaskState.js';
import type { TaskDefinition } from './TaskDefinition.js';
import type { RunHistoryEntry } from './RunHistoryEntry.js';

/**
 * Snapshot of a single task descriptor for replication.
 */
export interface ScheduledTaskSnapshot {
    readonly taskName: string;
    readonly handlerId: string;
    readonly executorName: string;
    readonly taskType: string;
    readonly scheduleKind: 'ONE_SHOT' | 'FIXED_RATE';
    readonly ownerKind: 'PARTITION' | 'MEMBER';
    readonly partitionId: number;
    readonly memberUuid: string | null;
    readonly initialDelayMillis: number;
    readonly periodMillis: number;
    readonly nextRunAt: number;
    readonly durabilityReplicaCount: number;
    readonly ownerEpoch: number;
    readonly version: number;
    readonly maxHistoryEntries: number;
}

/**
 * Replication payload: executorName → taskName → snapshot.
 */
export type ScheduledExecutorReplicationData = Map<string, Map<string, ScheduledTaskSnapshot>>;

/**
 * Central service managing partition-local scheduled task stores and dispatching one-shot firings.
 *
 * Implements ManagedService lifecycle (init, reset, shutdown) and RemoteService
 * (createDistributedObject, destroyDistributedObject).
 *
 * Uses a timer coordinator (single interval loop) rather than one setTimeout per task.
 *
 * Hazelcast parity: com.hazelcast.scheduledexecutor.impl.DistributedScheduledExecutorService
 */
export class ScheduledExecutorContainerService {
    static readonly SERVICE_NAME = 'hz:impl:scheduledExecutorService';

    private readonly _partitionCount: number;
    private _partitions: ScheduledExecutorPartition[] = [];
    private _memberBin: ScheduledExecutorMemberBin = new ScheduledExecutorMemberBin();
    private readonly _configs = new Map<string, ScheduledExecutorConfig>();
    private _shutdown = false;
    private _timerHandle: ReturnType<typeof setInterval> | null = null;

    /** Tick interval in ms for the timer coordinator. */
    private static readonly TICK_INTERVAL_MS = 10;

    constructor(partitionCount: number) {
        this._partitionCount = partitionCount;
    }

    // --- ManagedService ---

    init(): void {
        this._shutdown = false;
        this._partitions = [];
        for (let i = 0; i < this._partitionCount; i++) {
            this._partitions.push(new ScheduledExecutorPartition(i));
        }
        this._memberBin = new ScheduledExecutorMemberBin();
        this._startTimerCoordinator();
    }

    reset(): void {
        this._stopTimerCoordinator();
        for (const p of this._partitions) {
            p.destroy();
        }
        this._partitions = [];
        for (let i = 0; i < this._partitionCount; i++) {
            this._partitions.push(new ScheduledExecutorPartition(i));
        }
        this._memberBin = new ScheduledExecutorMemberBin();
        this._configs.clear();
        this._startTimerCoordinator();
    }

    async shutdown(): Promise<void> {
        this._shutdown = true;
        this._stopTimerCoordinator();
        for (const p of this._partitions) {
            p.destroy();
        }
        this._memberBin.destroy();
        this._configs.clear();
    }

    isShutdown(): boolean {
        return this._shutdown;
    }

    // --- RemoteService ---

    createDistributedObject(name: string, config: ScheduledExecutorConfig): void {
        this._configs.set(name, config);
        // Eagerly create containers in each partition
        for (const p of this._partitions) {
            p.getOrCreateContainer(name);
        }
        this._memberBin.getOrCreateContainer(name);
    }

    destroyDistributedObject(name: string): void {
        this._configs.delete(name);
        for (const p of this._partitions) {
            p.destroyContainer(name);
        }
        this._memberBin.destroyContainer(name);
    }

    // --- Accessors ---

    getPartition(partitionId: number): ScheduledExecutorPartition {
        return this._partitions[partitionId]!;
    }

    getMemberBin(): ScheduledExecutorMemberBin {
        return this._memberBin;
    }

    getConfigs(): ReadonlyMap<string, ScheduledExecutorConfig> {
        return this._configs;
    }

    // --- One-shot scheduling ---

    /**
     * Schedule a one-shot task on a specific partition.
     *
     * Creates a descriptor, computes nextRunAt from wall-clock + delay,
     * stores in the partition container, and returns the descriptor.
     * The timer coordinator will dispatch it when ready.
     */
    scheduleOnPartition(
        executorName: string,
        definition: TaskDefinition,
        partitionId: number,
    ): ScheduledTaskDescriptor {
        if (this._shutdown) {
            throw new ExecutorRejectedExecutionException('ScheduledExecutorContainerService is shut down');
        }

        const config = this._configs.get(executorName);
        const maxHistory = config?.getMaxHistoryEntriesPerTask() ?? 100;

        const now = Date.now();
        const nextRunAt = now + definition.delay;

        const descriptor = new ScheduledTaskDescriptor({
            taskName: definition.name,
            handlerId: randomUUID(),
            executorName,
            taskType: definition.command,
            scheduleKind: definition.type === 'SINGLE_RUN' ? 'ONE_SHOT' : 'FIXED_RATE',
            ownerKind: 'PARTITION',
            partitionId,
            initialDelayMillis: definition.delay,
            periodMillis: definition.period,
            nextRunAt,
            maxHistoryEntries: maxHistory,
        });

        const store = this._partitions[partitionId]!.getOrCreateContainer(executorName);
        store.schedule(descriptor);

        return descriptor;
    }

    // --- Lifecycle: cancel / dispose / getTaskDescriptor ---

    /**
     * Cancel a scheduled task. Stops future scheduling without interrupting in-flight runs.
     * Uses versioned terminal-write ordering: only succeeds if the task is in a cancellable state.
     *
     * @returns true if the task was cancelled, false if already in a terminal state (DONE, CANCELLED).
     * @throws StaleTaskException if the task has been disposed.
     */
    cancelTask(executorName: string, taskName: string, partitionId: number): boolean {
        const store = this._partitions[partitionId]!.getOrCreateContainer(executorName);
        const descriptor = store.get(taskName);

        if (!descriptor) {
            throw new StaleTaskException(taskName);
        }

        if (descriptor.state === ScheduledTaskState.DONE || descriptor.state === ScheduledTaskState.CANCELLED) {
            return false;
        }

        // Versioned terminal write: increment version and transition
        descriptor.version++;
        descriptor.transitionTo(ScheduledTaskState.CANCELLED);
        return true;
    }

    /**
     * Dispose a scheduled task. Permanently removes task state from the store,
     * freeing the task name for reuse.
     *
     * @throws StaleTaskException if the task has already been disposed (not found in store).
     */
    disposeTask(executorName: string, taskName: string, partitionId: number): void {
        const store = this._partitions[partitionId]!.getOrCreateContainer(executorName);
        const descriptor = store.get(taskName);

        if (!descriptor) {
            throw new StaleTaskException(taskName);
        }

        // Versioned terminal write: increment version, transition to DISPOSED, then remove
        descriptor.version++;
        descriptor.transitionTo(ScheduledTaskState.DISPOSED);
        store.remove(taskName);
    }

    /**
     * Get a task descriptor by name. Throws StaleTaskException if disposed (not in store).
     */
    getTaskDescriptor(executorName: string, taskName: string, partitionId: number): ScheduledTaskDescriptor {
        const store = this._partitions[partitionId]!.getOrCreateContainer(executorName);
        const descriptor = store.get(taskName);

        if (!descriptor) {
            throw new StaleTaskException(taskName);
        }

        return descriptor;
    }

    // --- Replication / Migration ---

    /**
     * Enqueue a task as SUSPENDED on this node (backup/migration path).
     * Bypasses capacity checks to prevent data loss during migration.
     *
     * Hazelcast parity: ScheduledExecutorContainer.enqueueSuspended(TaskDefinition)
     */
    enqueueSuspended(
        executorName: string,
        definition: TaskDefinition,
        partitionId: number,
    ): void {
        const config = this._configs.get(executorName);
        const maxHistory = config?.getMaxHistoryEntriesPerTask() ?? 100;

        const descriptor = new ScheduledTaskDescriptor({
            taskName: definition.name,
            handlerId: randomUUID(),
            executorName,
            taskType: definition.command,
            scheduleKind: definition.type === 'SINGLE_RUN' ? 'ONE_SHOT' : 'FIXED_RATE',
            ownerKind: 'PARTITION',
            partitionId,
            initialDelayMillis: definition.delay,
            periodMillis: definition.period,
            nextRunAt: 0,
            maxHistoryEntries: maxHistory,
        });

        // Start as SCHEDULED then immediately transition to SUSPENDED
        descriptor.transitionTo(ScheduledTaskState.SUSPENDED);

        const store = this._partitions[partitionId]!.getOrCreateContainer(executorName);
        // Bypass duplicate check for migration — use internal map directly
        store.schedule(descriptor);
    }

    /**
     * Enqueue a task from a replication snapshot as SUSPENDED.
     * Preserves original handlerId, epoch, version, and timing metadata.
     * Bypasses capacity checks.
     */
    enqueueSuspendedFromSnapshot(
        executorName: string,
        snapshot: ScheduledTaskSnapshot,
        partitionId: number,
    ): void {
        const descriptor = new ScheduledTaskDescriptor({
            taskName: snapshot.taskName,
            handlerId: snapshot.handlerId,
            executorName: snapshot.executorName,
            taskType: snapshot.taskType,
            scheduleKind: snapshot.scheduleKind,
            ownerKind: snapshot.ownerKind,
            partitionId,
            memberUuid: snapshot.memberUuid,
            initialDelayMillis: snapshot.initialDelayMillis,
            periodMillis: snapshot.periodMillis,
            nextRunAt: snapshot.nextRunAt,
            durabilityReplicaCount: snapshot.durabilityReplicaCount,
            ownerEpoch: snapshot.ownerEpoch,
            version: snapshot.version,
            maxHistoryEntries: snapshot.maxHistoryEntries,
        });

        // Start as SCHEDULED then immediately transition to SUSPENDED
        descriptor.transitionTo(ScheduledTaskState.SUSPENDED);

        const store = this._partitions[partitionId]!.getOrCreateContainer(executorName);
        store.schedule(descriptor);
    }

    /**
     * Prepare a replication data payload for a given partition.
     * Collects all task descriptors across all executors in that partition.
     *
     * Hazelcast parity: ScheduledExecutorPartition.prepareReplicationOperation()
     */
    prepareReplicationData(partitionId: number): ScheduledExecutorReplicationData {
        const data: ScheduledExecutorReplicationData = new Map();
        const partition = this._partitions[partitionId]!;

        for (const [executorName] of this._configs) {
            const store = partition.getOrCreateContainer(executorName);
            const tasks = store.getAll();
            if (tasks.length === 0) continue;

            const taskMap = new Map<string, ScheduledTaskSnapshot>();
            for (const desc of tasks) {
                taskMap.set(desc.taskName, {
                    taskName: desc.taskName,
                    handlerId: desc.handlerId,
                    executorName: desc.executorName,
                    taskType: desc.taskType,
                    scheduleKind: desc.scheduleKind,
                    ownerKind: desc.ownerKind,
                    partitionId: desc.partitionId,
                    memberUuid: desc.memberUuid,
                    initialDelayMillis: desc.initialDelayMillis,
                    periodMillis: desc.periodMillis,
                    nextRunAt: desc.nextRunAt,
                    durabilityReplicaCount: desc.durabilityReplicaCount,
                    ownerEpoch: desc.ownerEpoch,
                    version: desc.version,
                    maxHistoryEntries: desc.maxHistoryEntries,
                });
            }
            data.set(executorName, taskMap);
        }

        return data;
    }

    // --- Timer Coordinator ---

    /**
     * Single interval-based timer that scans all partitions for ready tasks.
     * Uses monotonic time (performance.now()) for accurate wait calculations,
     * while nextRunAt is stored as wall-clock epoch.
     */
    private _startTimerCoordinator(): void {
        if (this._timerHandle) return;

        this._timerHandle = setInterval(() => {
            if (this._shutdown) return;
            this._dispatchReadyTasks();
        }, ScheduledExecutorContainerService.TICK_INTERVAL_MS);
    }

    /**
     * Stop the built-in timer coordinator.
     * Used when an external ScheduledTaskScheduler takes over dispatch responsibility.
     */
    stopTimerCoordinator(): void {
        this._stopTimerCoordinator();
    }

    private _stopTimerCoordinator(): void {
        if (this._timerHandle) {
            clearInterval(this._timerHandle);
            this._timerHandle = null;
        }
    }

    /**
     * Scan all partition stores and dispatch any tasks whose nextRunAt <= now.
     * This is the core dispatch loop — a single timer drives all task firings.
     */
    private _dispatchReadyTasks(): void {
        const now = Date.now();

        for (const partition of this._partitions) {
            for (const [executorName] of this._configs) {
                const store = partition.getOrCreateContainer(executorName);
                for (const descriptor of store.getAll()) {
                    if (
                        descriptor.state === ScheduledTaskState.SCHEDULED &&
                        descriptor.nextRunAt <= now
                    ) {
                        this._executeTask(descriptor);
                    }
                }
            }
        }
    }

    /**
     * Execute a ready task: transition to RUNNING, dispatch, capture result,
     * transition to DONE, add history entry.
     */
    private _executeTask(descriptor: ScheduledTaskDescriptor): void {
        const attemptId = randomUUID();
        const scheduledTime = descriptor.nextRunAt;

        descriptor.transitionTo(ScheduledTaskState.RUNNING);
        descriptor.attemptId = attemptId;
        descriptor.lastRunStartedAt = Date.now();

        // Dispatch the task execution asynchronously
        // In production this dispatches into ExecutorContainerService;
        // for now we execute the command concept inline
        this._dispatchAndCapture(descriptor, attemptId, scheduledTime);
    }

    /**
     * Dispatch task execution and capture the result envelope.
     * Transitions to DONE on success, records history.
     */
    private async _dispatchAndCapture(
        descriptor: ScheduledTaskDescriptor,
        attemptId: string,
        scheduledTime: number,
    ): Promise<void> {
        const startTime = descriptor.lastRunStartedAt;

        try {
            // The actual dispatch would go through ExecutorContainerService.
            // For one-shot local execution, we simulate the dispatch completing.
            // Future blocks will wire this to real ExecutorContainerService.

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
}
