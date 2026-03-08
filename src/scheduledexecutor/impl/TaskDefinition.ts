/**
 * The type of scheduled task.
 *
 * Hazelcast parity: com.hazelcast.scheduledexecutor.impl.TaskDefinition.Type
 */
export type TaskType = 'SINGLE_RUN' | 'AT_FIXED_RATE';

/**
 * Immutable definition of a scheduled task's execution parameters.
 *
 * Hazelcast parity: com.hazelcast.scheduledexecutor.impl.TaskDefinition
 */
export interface TaskDefinition {
    readonly type: TaskType;
    /** Task name. Empty string for unnamed tasks (store will assign a UUID). */
    readonly name: string;
    /** The command/handler reference to execute. */
    readonly command: string;
    /** Initial delay in milliseconds. */
    readonly delay: number;
    /** Period in milliseconds (only meaningful for AT_FIXED_RATE). */
    readonly period: number;
    /** Whether the task should auto-dispose after completion. */
    readonly autoDisposable: boolean;
}
