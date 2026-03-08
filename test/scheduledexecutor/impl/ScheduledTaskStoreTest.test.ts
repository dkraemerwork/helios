import { describe, expect, it } from 'bun:test';
import { ScheduledTaskState } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledTaskState.js';
import { ScheduledTaskDescriptor } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledTaskDescriptor.js';
import { ScheduledTaskStore } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledTaskStore.js';
import type { RunHistoryEntry } from '@zenystx/helios-core/scheduledexecutor/impl/RunHistoryEntry.js';
import type { TaskDefinition, TaskType } from '@zenystx/helios-core/scheduledexecutor/impl/TaskDefinition.js';

// ─── helpers ────────────────────────────────────────────────────────────────────

function makeDescriptor(overrides: Partial<ConstructorParameters<typeof ScheduledTaskDescriptor>[0]> = {}): ScheduledTaskDescriptor {
    return new ScheduledTaskDescriptor({
        taskName: 'test-task',
        handlerId: 'handler-1',
        executorName: 'default',
        taskType: 'SINGLE_RUN',
        scheduleKind: 'ONE_SHOT',
        ownerKind: 'PARTITION',
        partitionId: 0,
        ...overrides,
    });
}

function makeHistoryEntry(overrides: Partial<RunHistoryEntry> = {}): RunHistoryEntry {
    return {
        attemptId: 'attempt-1',
        scheduledTime: 1000,
        startTime: 1001,
        endTime: 1010,
        outcome: 'SUCCESS',
        ownerEpoch: 0,
        version: 0,
        ...overrides,
    };
}

// ─── ScheduledTaskState ─────────────────────────────────────────────────────────

describe('ScheduledTaskState', () => {
    it('should define all seven states', () => {
        const states = Object.values(ScheduledTaskState);
        expect(states).toContain(ScheduledTaskState.SCHEDULED);
        expect(states).toContain(ScheduledTaskState.RUNNING);
        expect(states).toContain(ScheduledTaskState.DONE);
        expect(states).toContain(ScheduledTaskState.CANCELLED);
        expect(states).toContain(ScheduledTaskState.DISPOSED);
        expect(states).toContain(ScheduledTaskState.SUSPENDED);
        expect(states).toContain(ScheduledTaskState.SUPPRESSED);
        expect(states).toHaveLength(7);
    });
});

// ─── ScheduledTaskDescriptor ────────────────────────────────────────────────────

describe('ScheduledTaskDescriptor', () => {
    it('should create with all required fields', () => {
        const d = makeDescriptor();
        expect(d.taskName).toBe('test-task');
        expect(d.handlerId).toBe('handler-1');
        expect(d.executorName).toBe('default');
        expect(d.taskType).toBe('SINGLE_RUN');
        expect(d.scheduleKind).toBe('ONE_SHOT');
        expect(d.ownerKind).toBe('PARTITION');
        expect(d.partitionId).toBe(0);
        expect(d.state).toBe(ScheduledTaskState.SCHEDULED);
        expect(d.runCount).toBe(0);
        expect(d.lastRunStartedAt).toBe(0);
        expect(d.lastRunCompletedAt).toBe(0);
    });

    it('should default optional fields', () => {
        const d = makeDescriptor();
        expect(d.memberUuid).toBeNull();
        expect(d.initialDelayMillis).toBe(0);
        expect(d.periodMillis).toBe(0);
        expect(d.nextRunAt).toBe(0);
        expect(d.durabilityReplicaCount).toBe(1);
        expect(d.ownerEpoch).toBe(0);
        expect(d.version).toBe(0);
        expect(d.attemptId).toBe('');
    });

    // ── state transitions ───────────────────────────────────────────────────────

    it('should allow SCHEDULED → RUNNING', () => {
        const d = makeDescriptor();
        d.transitionTo(ScheduledTaskState.RUNNING);
        expect(d.state).toBe(ScheduledTaskState.RUNNING);
    });

    it('should allow RUNNING → DONE', () => {
        const d = makeDescriptor();
        d.transitionTo(ScheduledTaskState.RUNNING);
        d.transitionTo(ScheduledTaskState.DONE);
        expect(d.state).toBe(ScheduledTaskState.DONE);
    });

    it('should allow RUNNING → CANCELLED', () => {
        const d = makeDescriptor();
        d.transitionTo(ScheduledTaskState.RUNNING);
        d.transitionTo(ScheduledTaskState.CANCELLED);
        expect(d.state).toBe(ScheduledTaskState.CANCELLED);
    });

    it('should allow RUNNING → SCHEDULED (for periodic re-scheduling)', () => {
        const d = makeDescriptor();
        d.transitionTo(ScheduledTaskState.RUNNING);
        d.transitionTo(ScheduledTaskState.SCHEDULED);
        expect(d.state).toBe(ScheduledTaskState.SCHEDULED);
    });

    it('should allow any non-DISPOSED state → DISPOSED', () => {
        for (const fromState of [
            ScheduledTaskState.SCHEDULED,
            ScheduledTaskState.RUNNING,
            ScheduledTaskState.DONE,
            ScheduledTaskState.CANCELLED,
            ScheduledTaskState.SUSPENDED,
        ]) {
            const d = makeDescriptor();
            // Force state for test
            (d as any).state = fromState;
            d.transitionTo(ScheduledTaskState.DISPOSED);
            expect(d.state).toBe(ScheduledTaskState.DISPOSED);
        }
    });

    it('should reject DISPOSED → any state', () => {
        const d = makeDescriptor();
        d.transitionTo(ScheduledTaskState.DISPOSED);
        for (const toState of [
            ScheduledTaskState.SCHEDULED,
            ScheduledTaskState.RUNNING,
            ScheduledTaskState.DONE,
            ScheduledTaskState.CANCELLED,
            ScheduledTaskState.SUSPENDED,
        ]) {
            expect(() => d.transitionTo(toState)).toThrow('Illegal state transition');
        }
    });

    it('should reject SCHEDULED → DONE directly', () => {
        const d = makeDescriptor();
        expect(() => d.transitionTo(ScheduledTaskState.DONE)).toThrow('Illegal state transition');
    });

    it('should reject DONE → RUNNING', () => {
        const d = makeDescriptor();
        d.transitionTo(ScheduledTaskState.RUNNING);
        d.transitionTo(ScheduledTaskState.DONE);
        expect(() => d.transitionTo(ScheduledTaskState.RUNNING)).toThrow('Illegal state transition');
    });

    // ── run history ─────────────────────────────────────────────────────────────

    it('should store and retrieve history entries', () => {
        const d = makeDescriptor();
        const entry = makeHistoryEntry();
        d.addHistoryEntry(entry);
        expect(d.getHistory()).toHaveLength(1);
        expect(d.getHistory()[0]).toEqual(entry);
    });

    it('should evict oldest history entries when at capacity', () => {
        const d = makeDescriptor({ maxHistoryEntries: 3 });
        d.addHistoryEntry(makeHistoryEntry({ attemptId: 'a1' }));
        d.addHistoryEntry(makeHistoryEntry({ attemptId: 'a2' }));
        d.addHistoryEntry(makeHistoryEntry({ attemptId: 'a3' }));
        d.addHistoryEntry(makeHistoryEntry({ attemptId: 'a4' }));

        const history = d.getHistory();
        expect(history).toHaveLength(3);
        expect(history[0]!.attemptId).toBe('a2');
        expect(history[1]!.attemptId).toBe('a3');
        expect(history[2]!.attemptId).toBe('a4');
    });

    it('should return a snapshot from getHistory (not a live reference)', () => {
        const d = makeDescriptor();
        d.addHistoryEntry(makeHistoryEntry());
        const h1 = d.getHistory();
        d.addHistoryEntry(makeHistoryEntry({ attemptId: 'new' }));
        const h2 = d.getHistory();
        expect(h1).toHaveLength(1);
        expect(h2).toHaveLength(2);
    });
});

// ─── TaskDefinition types ───────────────────────────────────────────────────────

describe('TaskDefinition', () => {
    it('should accept SINGLE_RUN and AT_FIXED_RATE types', () => {
        const singleRun: TaskType = 'SINGLE_RUN';
        const fixedRate: TaskType = 'AT_FIXED_RATE';
        expect(singleRun).toBe('SINGLE_RUN');
        expect(fixedRate).toBe('AT_FIXED_RATE');
    });

    it('should accept a well-formed TaskDefinition', () => {
        const def: TaskDefinition = {
            type: 'SINGLE_RUN',
            name: 'my-task',
            command: 'doSomething',
            delay: 1000,
            period: 0,
            autoDisposable: true,
        };
        expect(def.type).toBe('SINGLE_RUN');
        expect(def.name).toBe('my-task');
        expect(def.autoDisposable).toBe(true);
    });
});

// ─── ScheduledTaskStore ─────────────────────────────────────────────────────────

describe('ScheduledTaskStore', () => {
    it('should schedule and retrieve a task', () => {
        const store = new ScheduledTaskStore();
        const d = makeDescriptor();
        store.schedule(d);
        expect(store.get('test-task')).toBe(d);
        expect(store.size()).toBe(1);
    });

    it('should reject duplicate named tasks', () => {
        const store = new ScheduledTaskStore();
        store.schedule(makeDescriptor());
        expect(() => store.schedule(makeDescriptor())).toThrow('Duplicate task');
    });

    it('should assign UUID for unnamed tasks', () => {
        const store = new ScheduledTaskStore();
        const d = makeDescriptor({ taskName: '' });
        store.schedule(d);
        expect(d.taskName).not.toBe('');
        expect(d.taskName.length).toBeGreaterThan(0);
        expect(store.get(d.taskName)).toBe(d);
    });

    it('should allow multiple unnamed tasks (each gets unique ID)', () => {
        const store = new ScheduledTaskStore();
        const d1 = makeDescriptor({ taskName: '' });
        const d2 = makeDescriptor({ taskName: '' });
        store.schedule(d1);
        store.schedule(d2);
        expect(d1.taskName).not.toBe(d2.taskName);
        expect(store.size()).toBe(2);
    });

    it('should look up by handler ID', () => {
        const store = new ScheduledTaskStore();
        const d1 = makeDescriptor({ handlerId: 'h-1' });
        const d2 = makeDescriptor({ taskName: 'other', handlerId: 'h-2' });
        store.schedule(d1);
        store.schedule(d2);
        expect(store.getByHandler('h-2')).toBe(d2);
        expect(store.getByHandler('nonexistent')).toBeUndefined();
    });

    it('should remove a task', () => {
        const store = new ScheduledTaskStore();
        store.schedule(makeDescriptor());
        expect(store.remove('test-task')).toBe(true);
        expect(store.get('test-task')).toBeUndefined();
        expect(store.size()).toBe(0);
    });

    it('should return false when removing nonexistent task', () => {
        const store = new ScheduledTaskStore();
        expect(store.remove('nope')).toBe(false);
    });

    it('should return all tasks', () => {
        const store = new ScheduledTaskStore();
        store.schedule(makeDescriptor({ taskName: 'a', handlerId: 'h1' }));
        store.schedule(makeDescriptor({ taskName: 'b', handlerId: 'h2' }));
        const all = store.getAll();
        expect(all).toHaveLength(2);
        const names = all.map(d => d.taskName).sort();
        expect(names).toEqual(['a', 'b']);
    });
});
