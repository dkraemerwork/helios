/**
 * Interface for tasks that require a unique name for identification and deduplication.
 *
 * When a task implements NamedTask, the scheduler enforces unique naming:
 * scheduling a task with a name that already exists will throw a DuplicateTaskException.
 *
 * Hazelcast parity: com.hazelcast.scheduledexecutor.NamedTask
 */
export interface NamedTask {

    /** Returns the unique name of this task. */
    getName(): string;
}
