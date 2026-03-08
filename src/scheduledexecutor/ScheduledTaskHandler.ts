/**
 * Portable resource handler pointing to an {@link IScheduledFuture}.
 *
 * A handler can be serialized to a URN string and reconstructed on any node,
 * enabling resilient access to scheduled tasks after node failures.
 *
 * URN formats:
 *   urn:helios:scheduled:<schedulerName>:<taskName>:partition:<partitionId>
 *   urn:helios:scheduled:<schedulerName>:<taskName>:member:<memberUuid>
 *
 * Hazelcast parity: com.hazelcast.scheduledexecutor.ScheduledTaskHandler
 */

const URN_PREFIX = 'urn:helios:scheduled:';

export class ScheduledTaskHandler {

    private constructor(
        private readonly _schedulerName: string,
        private readonly _taskName: string,
        private readonly _partitionId: number,
        private readonly _memberUuid: string | null,
    ) {}

    /** Create a handler for a task assigned to a specific partition. */
    static ofPartition(schedulerName: string, taskName: string, partitionId: number): ScheduledTaskHandler {
        return new ScheduledTaskHandler(schedulerName, taskName, partitionId, null);
    }

    /** Create a handler for a task assigned to a specific member. */
    static ofMember(schedulerName: string, taskName: string, memberUuid: string): ScheduledTaskHandler {
        return new ScheduledTaskHandler(schedulerName, taskName, -1, memberUuid);
    }

    /** Reconstruct a handler from its URN string representation. */
    static of(urn: string): ScheduledTaskHandler {
        if (!urn.startsWith(URN_PREFIX)) {
            throw new Error(`Invalid ScheduledTaskHandler URN: expected prefix '${URN_PREFIX}', got '${urn}'`);
        }

        const body = urn.slice(URN_PREFIX.length);
        const parts = body.split(':');

        // Expected: <schedulerName>:<taskName>:<ownerKind>:<ownerValue>
        if (parts.length < 4) {
            throw new Error(`Invalid ScheduledTaskHandler URN: insufficient segments in '${urn}'`);
        }

        const schedulerName = parts[0]!;
        const taskName = parts[1]!;
        const ownerKind = parts[2]!;
        const ownerValue = parts[3]!;

        if (ownerKind === 'partition') {
            return new ScheduledTaskHandler(schedulerName, taskName, parseInt(ownerValue, 10), null);
        } else if (ownerKind === 'member') {
            return new ScheduledTaskHandler(schedulerName, taskName, -1, ownerValue);
        }

        throw new Error(`Invalid ScheduledTaskHandler URN: unknown owner kind '${ownerKind}' in '${urn}'`);
    }

    getSchedulerName(): string {
        return this._schedulerName;
    }

    getTaskName(): string {
        return this._taskName;
    }

    /** Partition ID, or -1 if assigned to a member. */
    getPartitionId(): number {
        return this._partitionId;
    }

    /** Member UUID, or null if assigned to a partition. */
    getMemberUuid(): string | null {
        return this._memberUuid;
    }

    isAssignedToPartition(): boolean {
        return this._memberUuid === null;
    }

    isAssignedToMember(): boolean {
        return this._memberUuid !== null;
    }

    /** Serialize to a portable URN string. */
    toUrn(): string {
        if (this._memberUuid !== null) {
            return `${URN_PREFIX}${this._schedulerName}:${this._taskName}:member:${this._memberUuid}`;
        }
        return `${URN_PREFIX}${this._schedulerName}:${this._taskName}:partition:${this._partitionId}`;
    }
}
