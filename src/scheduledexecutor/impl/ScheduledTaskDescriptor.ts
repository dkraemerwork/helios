import { ScheduledTaskState } from './ScheduledTaskState.js';
import type { RunHistoryEntry } from './RunHistoryEntry.js';

/**
 * The kind of schedule: one-shot or periodic.
 */
export type ScheduleKind = 'ONE_SHOT' | 'FIXED_RATE';

/**
 * The kind of owner: partition-based or member-based.
 */
export type OwnerKind = 'PARTITION' | 'MEMBER';

/**
 * Legal state transitions for the scheduled task state machine.
 */
const LEGAL_TRANSITIONS: ReadonlyMap<ScheduledTaskState, ReadonlySet<ScheduledTaskState>> = new Map([
    [ScheduledTaskState.SCHEDULED, new Set([ScheduledTaskState.RUNNING, ScheduledTaskState.CANCELLED, ScheduledTaskState.DISPOSED, ScheduledTaskState.SUSPENDED])],
    [ScheduledTaskState.RUNNING, new Set([ScheduledTaskState.DONE, ScheduledTaskState.CANCELLED, ScheduledTaskState.DISPOSED, ScheduledTaskState.SUSPENDED, ScheduledTaskState.SCHEDULED])],
    [ScheduledTaskState.DONE, new Set([ScheduledTaskState.DISPOSED, ScheduledTaskState.SUSPENDED])],
    [ScheduledTaskState.CANCELLED, new Set([ScheduledTaskState.DISPOSED, ScheduledTaskState.SUSPENDED])],
    [ScheduledTaskState.DISPOSED, new Set<ScheduledTaskState>()],
    [ScheduledTaskState.SUSPENDED, new Set([ScheduledTaskState.SCHEDULED, ScheduledTaskState.DISPOSED])],
]);

/**
 * Mutable descriptor representing a scheduled task's full state.
 *
 * Hazelcast parity: com.hazelcast.scheduledexecutor.impl.ScheduledTaskDescriptor
 * (enriched with epoch fencing, versioning, and run history)
 */
export class ScheduledTaskDescriptor {
    taskName: string;
    handlerId: string;
    executorName: string;
    taskType: string;
    scheduleKind: ScheduleKind;
    ownerKind: OwnerKind;
    partitionId: number;
    memberUuid: string | null;
    initialDelayMillis: number;
    periodMillis: number;
    nextRunAt: number;
    lastRunStartedAt: number;
    lastRunCompletedAt: number;
    runCount: number;
    state: ScheduledTaskState;
    durabilityReplicaCount: number;
    ownerEpoch: number;
    version: number;
    attemptId: string;

    private readonly _history: RunHistoryEntry[] = [];
    private _maxHistoryEntries: number;

    constructor(params: {
        taskName: string;
        handlerId: string;
        executorName: string;
        taskType: string;
        scheduleKind: ScheduleKind;
        ownerKind: OwnerKind;
        partitionId?: number;
        memberUuid?: string | null;
        initialDelayMillis?: number;
        periodMillis?: number;
        nextRunAt?: number;
        durabilityReplicaCount?: number;
        ownerEpoch?: number;
        version?: number;
        attemptId?: string;
        maxHistoryEntries?: number;
    }) {
        this.taskName = params.taskName;
        this.handlerId = params.handlerId;
        this.executorName = params.executorName;
        this.taskType = params.taskType;
        this.scheduleKind = params.scheduleKind;
        this.ownerKind = params.ownerKind;
        this.partitionId = params.partitionId ?? -1;
        this.memberUuid = params.memberUuid ?? null;
        this.initialDelayMillis = params.initialDelayMillis ?? 0;
        this.periodMillis = params.periodMillis ?? 0;
        this.nextRunAt = params.nextRunAt ?? 0;
        this.lastRunStartedAt = 0;
        this.lastRunCompletedAt = 0;
        this.runCount = 0;
        this.state = ScheduledTaskState.SCHEDULED;
        this.durabilityReplicaCount = params.durabilityReplicaCount ?? 1;
        this.ownerEpoch = params.ownerEpoch ?? 0;
        this.version = params.version ?? 0;
        this.attemptId = params.attemptId ?? '';
        this._maxHistoryEntries = params.maxHistoryEntries ?? 100;
    }

    /**
     * Transition to a new state. Throws if the transition is illegal.
     */
    transitionTo(newState: ScheduledTaskState): void {
        const allowed = LEGAL_TRANSITIONS.get(this.state);
        if (!allowed || !allowed.has(newState)) {
            throw new Error(
                `Illegal state transition: ${this.state} → ${newState}`,
            );
        }
        this.state = newState;
    }

    /**
     * Add a run history entry, evicting the oldest if at capacity.
     */
    addHistoryEntry(entry: RunHistoryEntry): void {
        if (this._history.length >= this._maxHistoryEntries) {
            this._history.shift();
        }
        this._history.push(entry);
    }

    /**
     * Get a snapshot of run history entries.
     */
    getHistory(): ReadonlyArray<RunHistoryEntry> {
        return [...this._history];
    }

    /**
     * Get the maximum number of history entries retained.
     */
    get maxHistoryEntries(): number {
        return this._maxHistoryEntries;
    }
}
