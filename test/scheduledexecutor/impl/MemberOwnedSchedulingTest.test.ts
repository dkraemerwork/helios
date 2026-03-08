import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { ScheduledExecutorContainerService } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledExecutorContainerService.js';
import { ScheduledExecutorServiceProxy } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledExecutorServiceProxy.js';
import { ScheduledExecutorConfig } from '@zenystx/helios-core/config/ScheduledExecutorConfig.js';
import { ScheduledTaskHandler } from '@zenystx/helios-core/scheduledexecutor/ScheduledTaskHandler.js';
import { ScheduledTaskState } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledTaskState.js';
import type { Member } from '@zenystx/helios-core/cluster/Member.js';
import type { TaskCallable } from '@zenystx/helios-core/executor/TaskCallable.js';

const EXECUTOR_NAME = 'memberScheduler';
const PARTITION_COUNT = 4;

function task(taskType = 'MemberTask'): TaskCallable<unknown> {
    return { taskType, input: null };
}

function createMember(uuid: string, local = false): Member {
    return {
        localMember: () => local,
        isLiteMember: () => false,
        getAddress: () => ({ getHost: () => '127.0.0.1', getPort: () => 5701 }) as any,
        getUuid: () => uuid,
        getAddressMap: () => new Map(),
        getAttributes: () => new Map(),
        getAttribute: () => null,
        getVersion: () => ({ getMajor: () => 0, getMinor: () => 0, getPatch: () => 0 }) as any,
    };
}

describe('MemberOwnedSchedulingTest', () => {
    let containerService: ScheduledExecutorContainerService;
    let proxy: ScheduledExecutorServiceProxy;
    const config = new ScheduledExecutorConfig(EXECUTOR_NAME);

    beforeEach(() => {
        containerService = new ScheduledExecutorContainerService(PARTITION_COUNT);
        containerService.init();
        containerService.createDistributedObject(EXECUTOR_NAME, config);
        proxy = new ScheduledExecutorServiceProxy(EXECUTOR_NAME, containerService, config, PARTITION_COUNT);
    });

    afterEach(async () => {
        await proxy.shutdown();
        await containerService.shutdown();
    });

    // ── scheduleOnMember creates member-owned task ──────────────────────

    test('scheduleOnMember creates a member-assigned handler with ownerKind=MEMBER', async () => {
        const member = createMember('member-uuid-1');
        const future = await proxy.scheduleOnMember(task(), member, 60_000);

        const handler = future.getHandler();
        expect(handler.isAssignedToMember()).toBe(true);
        expect(handler.getMemberUuid()).toBe('member-uuid-1');
        expect(handler.getPartitionId()).toBe(-1);
    });

    test('scheduleOnMember stores descriptor in member bin with ownerKind=MEMBER', async () => {
        const member = createMember('member-uuid-2');
        await proxy.scheduleOnMember(task(), member, 60_000);

        const memberBin = containerService.getMemberBin();
        const store = memberBin.getOrCreateContainer(EXECUTOR_NAME);
        const tasks = store.getAll();
        expect(tasks.length).toBe(1);
        expect(tasks[0]!.ownerKind).toBe('MEMBER');
        expect(tasks[0]!.memberUuid).toBe('member-uuid-2');
    });

    test('scheduleOnMember descriptor has partitionId=-1', async () => {
        const member = createMember('member-uuid-3');
        await proxy.scheduleOnMember(task(), member, 60_000);

        const memberBin = containerService.getMemberBin();
        const store = memberBin.getOrCreateContainer(EXECUTOR_NAME);
        const tasks = store.getAll();
        expect(tasks[0]!.partitionId).toBe(-1);
    });

    // ── Member-departure loses task (Hazelcast parity) ──────────────────

    test('member departure marks future as member-lost', async () => {
        const member = createMember('member-uuid-depart');
        const future = await proxy.scheduleOnMember(task(), member, 60_000);

        // Simulate member departure
        containerService.notifyMemberRemoved('member-uuid-depart');

        // Access should throw with member-lost message
        await expect(future.isDone()).rejects.toThrow(/not part of this cluster/);
    });

    test('member departure does not affect other members tasks', async () => {
        const memberA = createMember('member-A');
        const memberB = createMember('member-B');

        const futureA = await proxy.scheduleOnMember(task(), memberA, 60_000);
        const futureB = await proxy.scheduleOnMember(task(), memberB, 60_000);

        containerService.notifyMemberRemoved('member-A');

        // B should still be accessible
        expect(await futureB.isDone()).toBe(false);

        // A should throw
        await expect(futureA.isDone()).rejects.toThrow(/not part of this cluster/);
    });

    test('member departure does not affect partition-owned tasks', async () => {
        const future = await proxy.schedule(task(), 60_000);

        containerService.notifyMemberRemoved('some-member');

        // Partition-owned task is unaffected
        expect(await future.isDone()).toBe(false);
    });

    // ── scheduleOnAllMembers fanout ─────────────────────────────────────

    test('scheduleOnAllMembers creates one future per cluster member', async () => {
        const members = [
            createMember('m1'),
            createMember('m2'),
            createMember('m3'),
        ];
        proxy.setClusterMembers(members);

        const result = await proxy.scheduleOnAllMembers(task(), 60_000);

        expect(result.size).toBe(3);
        for (const [member, future] of result) {
            expect(future.getHandler().isAssignedToMember()).toBe(true);
            expect(future.getHandler().getMemberUuid()).toBe(member.getUuid());
        }
    });

    test('scheduleOnAllMembers stores one descriptor per member in member bin', async () => {
        const members = [createMember('m1'), createMember('m2')];
        proxy.setClusterMembers(members);

        await proxy.scheduleOnAllMembers(task(), 60_000);

        const memberBin = containerService.getMemberBin();
        const store = memberBin.getOrCreateContainer(EXECUTOR_NAME);
        expect(store.getAll().length).toBe(2);
    });

    // ── scheduleOnMembers fanout ────────────────────────────────────────

    test('scheduleOnMembers creates one future per specified member', async () => {
        const members = [createMember('s1'), createMember('s2')];
        const result = await proxy.scheduleOnMembers(task(), members, 60_000);

        expect(result.size).toBe(2);
        for (const [member, future] of result) {
            expect(future.getHandler().isAssignedToMember()).toBe(true);
            expect(future.getHandler().getMemberUuid()).toBe(member.getUuid());
        }
    });

    // ── Member fixed-rate variants ──────────────────────────────────────

    test('scheduleOnMemberAtFixedRate creates member-owned periodic task', async () => {
        const member = createMember('fr-member');
        const future = await proxy.scheduleOnMemberAtFixedRate(task(), member, 0, 100);

        const handler = future.getHandler();
        expect(handler.isAssignedToMember()).toBe(true);
        expect(handler.getMemberUuid()).toBe('fr-member');

        const memberBin = containerService.getMemberBin();
        const store = memberBin.getOrCreateContainer(EXECUTOR_NAME);
        const desc = store.getAll()[0]!;
        expect(desc.scheduleKind).toBe('FIXED_RATE');
        expect(desc.periodMillis).toBe(100);
    });

    test('scheduleOnAllMembersAtFixedRate creates periodic task per member', async () => {
        const members = [createMember('fr1'), createMember('fr2')];
        proxy.setClusterMembers(members);

        const result = await proxy.scheduleOnAllMembersAtFixedRate(task(), 0, 200);

        expect(result.size).toBe(2);
        for (const [, future] of result) {
            expect(future.getHandler().isAssignedToMember()).toBe(true);
        }
    });

    test('scheduleOnMembersAtFixedRate creates periodic task per specified member', async () => {
        const members = [createMember('fr-a'), createMember('fr-b')];
        const result = await proxy.scheduleOnMembersAtFixedRate(task(), members, 0, 150);

        expect(result.size).toBe(2);
        for (const [member, future] of result) {
            expect(future.getHandler().getMemberUuid()).toBe(member.getUuid());
        }
    });

    // ── Member bin container (partitionId=-1) ───────────────────────────

    test('member bin tasks are dispatched by timer coordinator', async () => {
        const member = createMember('dispatch-member');
        await proxy.scheduleOnMember(task(), member, 0);

        // Wait for timer tick
        await Bun.sleep(50);

        const memberBin = containerService.getMemberBin();
        const store = memberBin.getOrCreateContainer(EXECUTOR_NAME);
        const desc = store.getAll()[0]!;
        expect(desc.state).toBe(ScheduledTaskState.DONE);
    });

    test('getAllScheduledFutures includes member-owned tasks', async () => {
        const member = createMember('all-member');
        await proxy.schedule(task(), 60_000);
        await proxy.scheduleOnMember(task(), member, 60_000);

        const all = await proxy.getAllScheduledFutures();
        let total = 0;
        for (const [, futures] of all) {
            total += futures.length;
        }
        expect(total).toBe(2);
    });

    // ── Member-owned handler URN round-trip ─────────────────────────────

    test('member-owned handler serializes and deserializes correctly', async () => {
        const member = createMember('urn-member');
        const future = await proxy.scheduleOnMember(task(), member, 60_000);

        const handler = future.getHandler();
        const urn = handler.toUrn();
        const restored = ScheduledTaskHandler.of(urn);

        expect(restored.isAssignedToMember()).toBe(true);
        expect(restored.getMemberUuid()).toBe('urn-member');
        expect(restored.getSchedulerName()).toBe(EXECUTOR_NAME);
    });

    test('getScheduledFuture reacquires member-owned future from handler', async () => {
        const member = createMember('reacquire-member');
        const future = await proxy.scheduleOnMember(task(), member, 60_000);
        const handler = future.getHandler();

        const reacquired = proxy.getScheduledFuture(handler);
        expect(reacquired.getHandler().isAssignedToMember()).toBe(true);
        expect(reacquired.getHandler().getMemberUuid()).toBe('reacquire-member');
    });
});
