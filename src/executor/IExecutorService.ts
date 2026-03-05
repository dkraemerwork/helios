/**
 * Public distributed executor service API.
 *
 * Matches Hazelcast IExecutorService with Helios-specific extensions:
 * - Pre-registered task types via {@link registerTaskType}
 * - Local-only inline execution via {@link submitLocal} / {@link executeLocal}
 *
 * @see TaskCallable
 * @see InlineTaskCallable
 */

import type { InvocationFuture } from '@helios/spi/impl/operationservice/InvocationFuture.js';
import type { Member } from '@helios/cluster/Member.js';
import type { TaskCallable, InlineTaskCallable } from './TaskCallable.js';

/** Snapshot of local executor statistics. */
export interface LocalExecutorStats {
    readonly pending: number;
    readonly started: number;
    readonly completed: number;
    readonly cancelled: number;
    readonly rejected: number;
    readonly timedOut: number;
    readonly taskLost: number;
    readonly lateResultsDropped: number;
    readonly totalStartLatencyMs: number;
    readonly totalExecutionTimeMs: number;
    readonly activeWorkers: number;
}

/** Registration options for a task type. */
export interface TaskTypeRegistration<T> {
    readonly version?: string;
    readonly poolSize?: number;
    /** Module path for worker-safe materialization (distributed execution). */
    readonly modulePath?: string;
    /** Named export within the module (defaults to 'default'). */
    readonly exportName?: string;
}

export interface IExecutorService {
    // ── Distributed submission ───────────────────────────────────────────

    /** Submit task to partition owner determined by serialized input key. */
    submit<T>(task: TaskCallable<T>): InvocationFuture<T>;

    /** Submit task to a specific member. No retry on member departure. */
    submitToMember<T>(task: TaskCallable<T>, member: Member): InvocationFuture<T>;

    /** Submit task to the owner of the given key's partition. */
    submitToKeyOwner<T>(task: TaskCallable<T>, key: unknown): InvocationFuture<T>;

    /** Submit task to all current members. Returns one future per member. */
    submitToAllMembers<T>(task: TaskCallable<T>): Map<Member, InvocationFuture<T>>;

    /** Submit task to selected members. Returns one future per member. */
    submitToMembers<T>(task: TaskCallable<T>, members: Iterable<Member>): Map<Member, InvocationFuture<T>>;

    // ── Fire-and-forget execution ───────────────────────────────────────

    execute<T>(task: TaskCallable<T>): void;
    executeOnMember<T>(task: TaskCallable<T>, member: Member): void;
    executeOnKeyOwner<T>(task: TaskCallable<T>, key: unknown): void;
    executeOnAllMembers<T>(task: TaskCallable<T>): void;

    // ── Helios-specific: task registration ──────────────────────────────

    /** Register a task type with its factory function. */
    registerTaskType<T>(
        taskType: string,
        factory: (input: unknown) => T | Promise<T>,
        options?: TaskTypeRegistration<T>,
    ): void;

    /** Unregister a task type. */
    unregisterTaskType(taskType: string): boolean;

    /** Get all currently registered task type names. */
    getRegisteredTaskTypes(): ReadonlySet<string>;

    // ── Local-only inline execution ─────────────────────────────────────

    /** Submit an inline function for local-only execution. Never crosses the network. */
    submitLocal<T>(task: InlineTaskCallable<T>): InvocationFuture<T>;

    /** Execute an inline function locally (fire-and-forget). Never crosses the network. */
    executeLocal<T>(task: InlineTaskCallable<T>): void;

    // ── Lifecycle ───────────────────────────────────────────────────────

    /** Gracefully shut down the executor, draining pending work within the configured timeout. */
    shutdown(): Promise<void>;

    /** Whether this executor has been shut down. */
    isShutdown(): boolean;

    // ── Stats ───────────────────────────────────────────────────────────

    /** Get a snapshot of local executor statistics. */
    getLocalExecutorStats(): LocalExecutorStats;
}
