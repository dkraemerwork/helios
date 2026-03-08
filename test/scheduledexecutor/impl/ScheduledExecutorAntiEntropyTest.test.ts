/**
 * Tests for Block 22.11 — Anti-entropy + conflict resolution.
 *
 * Validates that ScheduledExecutorAntiEntropyService correctly:
 * - runs periodic anti-entropy on a configurable interval
 * - triggers repair on ownership events (migration commit, promotion, member departure)
 * - resolves conflicts by highest ownerEpoch, then highest version
 * - pushes authoritative primary state to stale replicas
 * - propagates tombstones for disposed tasks to prevent resurrection
 */
import { describe, expect, test } from 'bun:test';
import type { ScheduledTaskSnapshot } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledExecutorContainerService';
import { ScheduledExecutorAntiEntropyService, resolveConflict, type TombstoneRecord } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledExecutorAntiEntropyService';

// ── helpers ──

function makeSnapshot(overrides: Partial<ScheduledTaskSnapshot> & { taskName: string; executorName: string }): ScheduledTaskSnapshot {
    return {
        handlerId: `handler-${overrides.taskName}`,
        taskType: 'test-command',
        scheduleKind: 'ONE_SHOT',
        ownerKind: 'PARTITION',
        partitionId: 0,
        memberUuid: null,
        initialDelayMillis: 0,
        periodMillis: 0,
        nextRunAt: Date.now() + 60_000,
        durabilityReplicaCount: 1,
        ownerEpoch: 0,
        version: 0,
        maxHistoryEntries: 100,
        ...overrides,
    };
}

// ── conflict resolution ──

describe('conflict resolution: highest epoch wins, then highest version', () => {
    test('higher epoch wins regardless of version', () => {
        const local = makeSnapshot({ taskName: 'task-1', executorName: 'exec1', ownerEpoch: 5, version: 10 });
        const remote = makeSnapshot({ taskName: 'task-1', executorName: 'exec1', ownerEpoch: 7, version: 2 });

        const winner = resolveConflict(local, remote);
        expect(winner).toBe('remote');
    });

    test('lower epoch loses regardless of version', () => {
        const local = makeSnapshot({ taskName: 'task-1', executorName: 'exec1', ownerEpoch: 7, version: 2 });
        const remote = makeSnapshot({ taskName: 'task-1', executorName: 'exec1', ownerEpoch: 5, version: 10 });

        const winner = resolveConflict(local, remote);
        expect(winner).toBe('local');
    });

    test('same epoch: higher version wins', () => {
        const local = makeSnapshot({ taskName: 'task-1', executorName: 'exec1', ownerEpoch: 5, version: 3 });
        const remote = makeSnapshot({ taskName: 'task-1', executorName: 'exec1', ownerEpoch: 5, version: 7 });

        const winner = resolveConflict(local, remote);
        expect(winner).toBe('remote');
    });

    test('same epoch and version: local wins (no-op)', () => {
        const local = makeSnapshot({ taskName: 'task-1', executorName: 'exec1', ownerEpoch: 5, version: 3 });
        const remote = makeSnapshot({ taskName: 'task-1', executorName: 'exec1', ownerEpoch: 5, version: 3 });

        const winner = resolveConflict(local, remote);
        expect(winner).toBe('local');
    });
});

// ── anti-entropy diff computation ──

describe('anti-entropy diff computation', () => {
    test('stale replica gets repaired — missing task detected', () => {
        const primaryData = new Map<string, Map<string, ScheduledTaskSnapshot>>();
        const exec1Tasks = new Map<string, ScheduledTaskSnapshot>();
        exec1Tasks.set('task-a', makeSnapshot({ taskName: 'task-a', executorName: 'exec1', ownerEpoch: 3, version: 5 }));
        exec1Tasks.set('task-b', makeSnapshot({ taskName: 'task-b', executorName: 'exec1', ownerEpoch: 3, version: 2 }));
        primaryData.set('exec1', exec1Tasks);

        // Replica is missing task-b entirely
        const replicaData = new Map<string, Map<string, ScheduledTaskSnapshot>>();
        const replicaTasks = new Map<string, ScheduledTaskSnapshot>();
        replicaTasks.set('task-a', makeSnapshot({ taskName: 'task-a', executorName: 'exec1', ownerEpoch: 3, version: 5 }));
        replicaData.set('exec1', replicaTasks);

        const svc = new ScheduledExecutorAntiEntropyService({ intervalMs: 1000 });
        const diff = svc.computeDiff(primaryData, replicaData, []);

        // task-b should be in the push list
        expect(diff.pushToReplica.length).toBe(1);
        expect(diff.pushToReplica[0]!.taskName).toBe('task-b');
    });

    test('stale replica gets repaired — older version detected', () => {
        const primaryData = new Map<string, Map<string, ScheduledTaskSnapshot>>();
        const exec1Tasks = new Map<string, ScheduledTaskSnapshot>();
        exec1Tasks.set('task-a', makeSnapshot({ taskName: 'task-a', executorName: 'exec1', ownerEpoch: 3, version: 8 }));
        primaryData.set('exec1', exec1Tasks);

        const replicaData = new Map<string, Map<string, ScheduledTaskSnapshot>>();
        const replicaTasks = new Map<string, ScheduledTaskSnapshot>();
        replicaTasks.set('task-a', makeSnapshot({ taskName: 'task-a', executorName: 'exec1', ownerEpoch: 3, version: 5 }));
        replicaData.set('exec1', replicaTasks);

        const svc = new ScheduledExecutorAntiEntropyService({ intervalMs: 1000 });
        const diff = svc.computeDiff(primaryData, replicaData, []);

        expect(diff.pushToReplica.length).toBe(1);
        expect(diff.pushToReplica[0]!.taskName).toBe('task-a');
    });

    test('up-to-date replica produces empty diff', () => {
        const primaryData = new Map<string, Map<string, ScheduledTaskSnapshot>>();
        const exec1Tasks = new Map<string, ScheduledTaskSnapshot>();
        exec1Tasks.set('task-a', makeSnapshot({ taskName: 'task-a', executorName: 'exec1', ownerEpoch: 3, version: 5 }));
        primaryData.set('exec1', exec1Tasks);

        const replicaData = new Map<string, Map<string, ScheduledTaskSnapshot>>();
        const replicaTasks = new Map<string, ScheduledTaskSnapshot>();
        replicaTasks.set('task-a', makeSnapshot({ taskName: 'task-a', executorName: 'exec1', ownerEpoch: 3, version: 5 }));
        replicaData.set('exec1', replicaTasks);

        const svc = new ScheduledExecutorAntiEntropyService({ intervalMs: 1000 });
        const diff = svc.computeDiff(primaryData, replicaData, []);

        expect(diff.pushToReplica.length).toBe(0);
        expect(diff.tombstonesToPush.length).toBe(0);
    });
});

// ── tombstone handling ──

describe('tombstone handling', () => {
    test('disposed task propagates tombstone — replica task removed', () => {
        const primaryData = new Map<string, Map<string, ScheduledTaskSnapshot>>();
        primaryData.set('exec1', new Map()); // primary has no task-a (disposed)

        const replicaData = new Map<string, Map<string, ScheduledTaskSnapshot>>();
        const replicaTasks = new Map<string, ScheduledTaskSnapshot>();
        replicaTasks.set('task-zombie', makeSnapshot({ taskName: 'task-zombie', executorName: 'exec1', ownerEpoch: 2, version: 3 }));
        replicaData.set('exec1', replicaTasks);

        const tombstones: TombstoneRecord[] = [
            { executorName: 'exec1', taskName: 'task-zombie', disposedAtEpoch: 3, disposedAtVersion: 4 },
        ];

        const svc = new ScheduledExecutorAntiEntropyService({ intervalMs: 1000 });
        const diff = svc.computeDiff(primaryData, replicaData, tombstones);

        // Tombstone should be pushed to replica
        expect(diff.tombstonesToPush.length).toBe(1);
        expect(diff.tombstonesToPush[0]!.taskName).toBe('task-zombie');
    });

    test('disposed task not resurrected — replica-only task with matching tombstone is removed', () => {
        const primaryData = new Map<string, Map<string, ScheduledTaskSnapshot>>();
        primaryData.set('exec1', new Map());

        const replicaData = new Map<string, Map<string, ScheduledTaskSnapshot>>();
        const replicaTasks = new Map<string, ScheduledTaskSnapshot>();
        replicaTasks.set('task-dead', makeSnapshot({ taskName: 'task-dead', executorName: 'exec1', ownerEpoch: 1, version: 1 }));
        replicaData.set('exec1', replicaTasks);

        const tombstones: TombstoneRecord[] = [
            { executorName: 'exec1', taskName: 'task-dead', disposedAtEpoch: 2, disposedAtVersion: 2 },
        ];

        const svc = new ScheduledExecutorAntiEntropyService({ intervalMs: 1000 });
        const diff = svc.computeDiff(primaryData, replicaData, tombstones);

        // Must NOT appear in pushToReplica (would resurrect it)
        expect(diff.pushToReplica.length).toBe(0);
        // Tombstone must be pushed
        expect(diff.tombstonesToPush.length).toBe(1);
    });

    test('replica-only task without tombstone is not pushed back to primary', () => {
        // If primary doesn't have the task and there's no tombstone, it may be
        // a legitimate gap or a disposed task whose tombstone hasn't arrived yet.
        // The primary is authoritative — do not push replica state to primary.
        const primaryData = new Map<string, Map<string, ScheduledTaskSnapshot>>();
        primaryData.set('exec1', new Map());

        const replicaData = new Map<string, Map<string, ScheduledTaskSnapshot>>();
        const replicaTasks = new Map<string, ScheduledTaskSnapshot>();
        replicaTasks.set('orphan-task', makeSnapshot({ taskName: 'orphan-task', executorName: 'exec1', ownerEpoch: 1, version: 1 }));
        replicaData.set('exec1', replicaTasks);

        const svc = new ScheduledExecutorAntiEntropyService({ intervalMs: 1000 });
        const diff = svc.computeDiff(primaryData, replicaData, []);

        // Orphan on replica should be marked for removal (primary is authoritative)
        expect(diff.removeFromReplica.length).toBe(1);
        expect(diff.removeFromReplica[0]!.taskName).toBe('orphan-task');
    });
});

// ── periodic anti-entropy scheduler ──

describe('periodic anti-entropy', () => {
    test('anti-entropy service runs on configurable interval', async () => {
        let runCount = 0;
        const svc = new ScheduledExecutorAntiEntropyService({
            intervalMs: 30,
            onRepairCycle: () => { runCount++; },
        });

        svc.start();
        await new Promise(r => setTimeout(r, 120));
        svc.stop();

        // Should have run at least 2 times in 120ms with 30ms interval
        expect(runCount).toBeGreaterThanOrEqual(2);
    });

    test('anti-entropy service stops cleanly', async () => {
        let runCount = 0;
        const svc = new ScheduledExecutorAntiEntropyService({
            intervalMs: 20,
            onRepairCycle: () => { runCount++; },
        });

        svc.start();
        await new Promise(r => setTimeout(r, 60));
        svc.stop();
        const countAtStop = runCount;

        await new Promise(r => setTimeout(r, 60));
        expect(runCount).toBe(countAtStop);
    });
});

// ── ownership-event-triggered repair ──

describe('ownership-event-triggered repair', () => {
    test('migration commit triggers repair cycle', () => {
        let repairTriggered = false;
        const svc = new ScheduledExecutorAntiEntropyService({
            intervalMs: 60_000, // very long interval — should NOT fire periodically
            onRepairCycle: () => { repairTriggered = true; },
        });

        svc.onOwnershipEvent('migration-commit', 0);
        expect(repairTriggered).toBe(true);
    });

    test('promotion triggers repair cycle', () => {
        let repairTriggered = false;
        const svc = new ScheduledExecutorAntiEntropyService({
            intervalMs: 60_000,
            onRepairCycle: () => { repairTriggered = true; },
        });

        svc.onOwnershipEvent('promotion', 0);
        expect(repairTriggered).toBe(true);
    });

    test('member departure triggers repair cycle', () => {
        let repairTriggered = false;
        const svc = new ScheduledExecutorAntiEntropyService({
            intervalMs: 60_000,
            onRepairCycle: () => { repairTriggered = true; },
        });

        svc.onOwnershipEvent('member-departure', 0);
        expect(repairTriggered).toBe(true);
    });
});

// ── tombstone store lifecycle ──

describe('tombstone store', () => {
    test('disposeTask records a tombstone', () => {
        const svc = new ScheduledExecutorAntiEntropyService({ intervalMs: 1000 });
        svc.recordTombstone('exec1', 'task-disposed', 5, 10);

        const tombstones = svc.getTombstones();
        expect(tombstones.length).toBe(1);
        expect(tombstones[0]!.executorName).toBe('exec1');
        expect(tombstones[0]!.taskName).toBe('task-disposed');
        expect(tombstones[0]!.disposedAtEpoch).toBe(5);
        expect(tombstones[0]!.disposedAtVersion).toBe(10);
    });
});
