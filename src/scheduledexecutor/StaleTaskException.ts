/**
 * Thrown when accessing a scheduled task that has been disposed.
 *
 * Hazelcast parity: com.hazelcast.scheduledexecutor.StaleTaskException
 */
export class StaleTaskException extends Error {
    constructor(taskName: string) {
        super(`Task '${taskName}' is stale — it has been disposed and is no longer accessible`);
        this.name = 'StaleTaskException';
    }
}
