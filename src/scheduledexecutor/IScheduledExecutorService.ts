/**
 * Distributed scheduled executor service with full Hazelcast-parity API surface.
 *
 * Supports one-shot delayed tasks and fixed-rate periodic tasks, with targeting
 * to specific members, partition key owners, all members, or a subset of members.
 *
 * Does NOT include scheduleWithFixedDelay — not part of Hazelcast parity.
 *
 * Hazelcast parity: com.hazelcast.scheduledexecutor.IScheduledExecutorService
 */

import type { Member } from '@zenystx/helios-core/cluster/Member.js';
import type { TaskCallable } from '@zenystx/helios-core/executor/TaskCallable.js';
import type { IScheduledFuture } from './IScheduledFuture.js';
import type { ScheduledTaskHandler } from './ScheduledTaskHandler.js';

export interface IScheduledExecutorService {

    // ── One-shot scheduling ─────────────────────────────────────────────

    /** Schedule a one-shot task with the given delay in milliseconds. */
    schedule<V>(task: TaskCallable<V>, delayMs: number): Promise<IScheduledFuture<V>>;

    /** Schedule a one-shot task on a specific member. */
    scheduleOnMember<V>(task: TaskCallable<V>, member: Member, delayMs: number): Promise<IScheduledFuture<V>>;

    /** Schedule a one-shot task on the partition owner of the given key. */
    scheduleOnKeyOwner<V>(task: TaskCallable<V>, key: unknown, delayMs: number): Promise<IScheduledFuture<V>>;

    /** Schedule a one-shot task on all cluster members. */
    scheduleOnAllMembers<V>(task: TaskCallable<V>, delayMs: number): Promise<Map<Member, IScheduledFuture<V>>>;

    /** Schedule a one-shot task on the given members. */
    scheduleOnMembers<V>(task: TaskCallable<V>, members: Iterable<Member>, delayMs: number): Promise<Map<Member, IScheduledFuture<V>>>;

    // ── Fixed-rate scheduling ───────────────────────────────────────────

    /** Schedule a task at a fixed rate (initialDelayMs, then every periodMs). */
    scheduleAtFixedRate(task: TaskCallable<void>, initialDelayMs: number, periodMs: number): Promise<IScheduledFuture<void>>;

    /** Schedule a fixed-rate task on a specific member. */
    scheduleOnMemberAtFixedRate(task: TaskCallable<void>, member: Member, initialDelayMs: number, periodMs: number): Promise<IScheduledFuture<void>>;

    /** Schedule a fixed-rate task on the partition owner of the given key. */
    scheduleOnKeyOwnerAtFixedRate(task: TaskCallable<void>, key: unknown, initialDelayMs: number, periodMs: number): Promise<IScheduledFuture<void>>;

    /** Schedule a fixed-rate task on all cluster members. */
    scheduleOnAllMembersAtFixedRate(task: TaskCallable<void>, initialDelayMs: number, periodMs: number): Promise<Map<Member, IScheduledFuture<void>>>;

    /** Schedule a fixed-rate task on the given members. */
    scheduleOnMembersAtFixedRate(task: TaskCallable<void>, members: Iterable<Member>, initialDelayMs: number, periodMs: number): Promise<Map<Member, IScheduledFuture<void>>>;

    // ── Future recovery and introspection ───────────────────────────────

    /** Recover a scheduled future from a previously obtained handler. */
    getScheduledFuture<V>(handler: ScheduledTaskHandler): IScheduledFuture<V>;

    /** Fetch all scheduled futures from all members. */
    getAllScheduledFutures(): Promise<Map<Member, IScheduledFuture<unknown>[]>>;

    // ── Lifecycle ───────────────────────────────────────────────────────

    /** Orderly shutdown: reject new submissions, let in-flight tasks complete. */
    shutdown(): Promise<void>;
}
