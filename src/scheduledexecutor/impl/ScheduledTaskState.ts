/**
 * Lifecycle states for a scheduled task descriptor.
 *
 * Hazelcast parity note: Hazelcast uses a simpler ACTIVE/SUSPENDED 2-state model.
 * Helios uses a richer 6-state model for explicit lifecycle tracking.
 */
export enum ScheduledTaskState {
    SCHEDULED = 'SCHEDULED',
    RUNNING = 'RUNNING',
    DONE = 'DONE',
    CANCELLED = 'CANCELLED',
    DISPOSED = 'DISPOSED',
    SUSPENDED = 'SUSPENDED',
}
