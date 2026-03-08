/**
 * Block 22.1 — IScheduledExecutorService + IScheduledFuture<V> + ScheduledTaskHandler contracts
 *
 * Tests: interface contracts compile, handler serialization/deserialization round-trip,
 * URN format validity, all contract types are real.
 */
import { describe, expect, test } from 'bun:test';
import { ScheduledTaskHandler } from '@zenystx/helios-core/scheduledexecutor/ScheduledTaskHandler';
import type { IScheduledExecutorService } from '@zenystx/helios-core/scheduledexecutor/IScheduledExecutorService';
import type { IScheduledFuture } from '@zenystx/helios-core/scheduledexecutor/IScheduledFuture';
import type { ScheduledTaskStatistics } from '@zenystx/helios-core/scheduledexecutor/ScheduledTaskStatistics';
import type { NamedTask } from '@zenystx/helios-core/scheduledexecutor/NamedTask';

// ── ScheduledTaskHandler serialization/deserialization ──────────────────

describe('ScheduledTaskHandler', () => {

    test('partition-assigned handler round-trips through URN', () => {
        const handler = ScheduledTaskHandler.ofPartition('my-scheduler', 'my-task', 42);
        const urn = handler.toUrn();
        const restored = ScheduledTaskHandler.of(urn);

        expect(restored.getSchedulerName()).toBe('my-scheduler');
        expect(restored.getTaskName()).toBe('my-task');
        expect(restored.getPartitionId()).toBe(42);
        expect(restored.isAssignedToPartition()).toBe(true);
        expect(restored.isAssignedToMember()).toBe(false);
        expect(restored.getMemberUuid()).toBeNull();
    });

    test('member-assigned handler round-trips through URN', () => {
        const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
        const handler = ScheduledTaskHandler.ofMember('sched-1', 'task-x', uuid);
        const urn = handler.toUrn();
        const restored = ScheduledTaskHandler.of(urn);

        expect(restored.getSchedulerName()).toBe('sched-1');
        expect(restored.getTaskName()).toBe('task-x');
        expect(restored.getMemberUuid()).toBe(uuid);
        expect(restored.isAssignedToMember()).toBe(true);
        expect(restored.isAssignedToPartition()).toBe(false);
        expect(restored.getPartitionId()).toBe(-1);
    });

    test('URN format is urn:helios:scheduled:<scheduler>:<task>:partition:<id> for partition', () => {
        const handler = ScheduledTaskHandler.ofPartition('exec', 'job', 7);
        expect(handler.toUrn()).toBe('urn:helios:scheduled:exec:job:partition:7');
    });

    test('URN format is urn:helios:scheduled:<scheduler>:<task>:member:<uuid> for member', () => {
        const uuid = 'deadbeef-1234-5678-9abc-def012345678';
        const handler = ScheduledTaskHandler.ofMember('exec', 'job', uuid);
        expect(handler.toUrn()).toBe('urn:helios:scheduled:exec:job:member:deadbeef-1234-5678-9abc-def012345678');
    });

    test('of() rejects invalid URN prefix', () => {
        expect(() => ScheduledTaskHandler.of('invalid:urn')).toThrow();
    });

    test('of() rejects URN with missing segments', () => {
        expect(() => ScheduledTaskHandler.of('urn:helios:scheduled:exec')).toThrow();
    });

    test('handler equality by URN', () => {
        const a = ScheduledTaskHandler.ofPartition('s', 't', 3);
        const b = ScheduledTaskHandler.of(a.toUrn());
        expect(a.toUrn()).toBe(b.toUrn());
    });

    test('deterministic round-trip: partition handler serialized twice produces same URN', () => {
        const h1 = ScheduledTaskHandler.ofPartition('svc', 'task1', 99);
        const h2 = ScheduledTaskHandler.of(h1.toUrn());
        expect(h1.toUrn()).toBe(h2.toUrn());
        expect(h2.toUrn()).toBe(ScheduledTaskHandler.of(h2.toUrn()).toUrn());
    });

    test('deterministic round-trip: member handler serialized twice produces same URN', () => {
        const uuid = '11111111-2222-3333-4444-555555555555';
        const h1 = ScheduledTaskHandler.ofMember('svc', 'task1', uuid);
        const h2 = ScheduledTaskHandler.of(h1.toUrn());
        expect(h1.toUrn()).toBe(h2.toUrn());
        expect(h2.toUrn()).toBe(ScheduledTaskHandler.of(h2.toUrn()).toUrn());
    });
});

// ── Interface contract compile checks ──────────────────────────────────

describe('IScheduledExecutorService contract', () => {

    test('interface has all required method signatures', () => {
        // Type-level check: a conforming object must have all methods
        const methods: (keyof IScheduledExecutorService)[] = [
            'schedule',
            'scheduleOnMember',
            'scheduleOnKeyOwner',
            'scheduleOnAllMembers',
            'scheduleOnMembers',
            'scheduleAtFixedRate',
            'scheduleOnMemberAtFixedRate',
            'scheduleOnKeyOwnerAtFixedRate',
            'scheduleOnAllMembersAtFixedRate',
            'scheduleOnMembersAtFixedRate',
            'getScheduledFuture',
            'getAllScheduledFutures',
            'shutdown',
        ];
        // If any method is missing from the interface, this array would cause a TS error
        expect(methods).toHaveLength(13);
    });
});

describe('IScheduledFuture contract', () => {

    test('interface has all required method signatures', () => {
        const methods: (keyof IScheduledFuture<unknown>)[] = [
            'getHandler',
            'getStats',
            'dispose',
            'cancel',
            'isDone',
            'isCancelled',
            'get',
            'getDelay',
        ];
        expect(methods).toHaveLength(8);
    });
});

describe('ScheduledTaskStatistics contract', () => {

    test('interface has all required fields', () => {
        const fields: (keyof ScheduledTaskStatistics)[] = [
            'totalRuns',
            'lastRunDurationMs',
            'lastIdleTimeMs',
            'totalRunTimeMs',
            'totalIdleTimeMs',
        ];
        expect(fields).toHaveLength(5);
    });
});

describe('NamedTask contract', () => {

    test('interface has getName method', () => {
        const methods: (keyof NamedTask)[] = ['getName'];
        expect(methods).toHaveLength(1);
    });

    test('NamedTask can be used as a type constraint', () => {
        const task: NamedTask = { getName: () => 'my-task' };
        expect(task.getName()).toBe('my-task');
    });
});
