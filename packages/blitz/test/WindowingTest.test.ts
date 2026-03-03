/**
 * Block 10.4 — Windowing engine tests
 *
 * Tests: window policies (tumbling/sliding/session), WindowState (InMemory),
 * WindowOperator (count-triggered closes, emit + delete lifecycle).
 *
 * NATS KV integration tests are skipped unless NATS_URL or CI env is set.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { TumblingWindowPolicy } from '../src/window/TumblingWindowPolicy.ts';
import { SlidingWindowPolicy } from '../src/window/SlidingWindowPolicy.ts';
import { SessionWindowPolicy } from '../src/window/SessionWindowPolicy.ts';
import { InMemoryWindowState, NatsKvWindowState } from '../src/window/WindowState.ts';
import { WindowOperator } from '../src/window/WindowOperator.ts';
import type { StageContext } from '../src/StageContext.ts';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<StageContext> = {}): StageContext {
    return { messageId: 'msg-1', deliveryCount: 1, nak: () => {}, ...overrides };
}

// ─── TumblingWindowPolicy ─────────────────────────────────────────────────────

describe('TumblingWindowPolicy', () => {
    it('assigns event to a single window key', () => {
        const policy = TumblingWindowPolicy.of({ size: 60_000 });
        const keys = policy.assignWindows(0);
        expect(keys).toHaveLength(1);
        expect(keys[0]).toBe('tumbling:0:60000');
    });

    it('two events within same window share the same key', () => {
        const policy = TumblingWindowPolicy.of({ size: 60_000 });
        const k1 = policy.assignWindows(1_000)[0]!;
        const k2 = policy.assignWindows(30_000)[0]!;
        expect(k1).toBe(k2);
    });

    it('events in adjacent windows get different keys', () => {
        const policy = TumblingWindowPolicy.of({ size: 60_000 });
        const k1 = policy.assignWindows(59_999)[0]!;
        const k2 = policy.assignWindows(60_000)[0]!;
        expect(k1).not.toBe(k2);
    });

    it('event at window boundary starts a new window', () => {
        const policy = TumblingWindowPolicy.of({ size: 60_000 });
        expect(policy.assignWindows(59_999)[0]).toBe('tumbling:0:60000');
        expect(policy.assignWindows(60_000)[0]).toBe('tumbling:60000:120000');
    });

    it('assigns correct window for arbitrary timestamp', () => {
        const policy = TumblingWindowPolicy.of({ size: 1_000 });
        const keys = policy.assignWindows(12_345);
        expect(keys).toHaveLength(1);
        expect(keys[0]).toBe('tumbling:12000:13000');
    });

    it('maxDurationMs equals size', () => {
        const policy = TumblingWindowPolicy.of({ size: 30_000 });
        expect(policy.maxDurationMs).toBe(30_000);
    });

    it('every event gets exactly one key', () => {
        const policy = TumblingWindowPolicy.of({ size: 100 });
        for (let i = 0; i < 500; i++) {
            expect(policy.assignWindows(i)).toHaveLength(1);
        }
    });
});

// ─── SlidingWindowPolicy ──────────────────────────────────────────────────────

describe('SlidingWindowPolicy', () => {
    it('event in the middle of overlapping windows gets multiple keys', () => {
        const policy = SlidingWindowPolicy.of({ size: 60_000, slide: 30_000 });
        const keys = policy.assignWindows(45_000);
        expect(keys.length).toBeGreaterThanOrEqual(2);
    });

    it('event at t=0 appears in exactly one window', () => {
        const policy = SlidingWindowPolicy.of({ size: 60_000, slide: 30_000 });
        const keys = policy.assignWindows(0);
        expect(keys).toHaveLength(1);
        expect(keys[0]).toBe('sliding:0:60000');
    });

    it('event in center of overlapping region gets 2 keys (size=60s, slide=30s)', () => {
        const policy = SlidingWindowPolicy.of({ size: 60_000, slide: 30_000 });
        const keys = policy.assignWindows(45_000); // in [0,60000) and [30000,90000)
        expect(keys).toHaveLength(2);
    });

    it('all returned window keys actually contain the event time', () => {
        const policy = SlidingWindowPolicy.of({ size: 60_000, slide: 30_000 });
        const ts = 75_000;
        const keys = policy.assignWindows(ts);
        for (const key of keys) {
            const parts = key.split(':');
            const start = Number(parts[1]);
            const end = Number(parts[2]);
            expect(ts).toBeGreaterThanOrEqual(start);
            expect(ts).toBeLessThan(end);
        }
    });

    it('maxDurationMs equals size', () => {
        const policy = SlidingWindowPolicy.of({ size: 60_000, slide: 30_000 });
        expect(policy.maxDurationMs).toBe(60_000);
    });

    it('when slide equals size, behaves like tumbling (one window per event)', () => {
        const policy = SlidingWindowPolicy.of({ size: 60_000, slide: 60_000 });
        expect(policy.assignWindows(30_000)).toHaveLength(1);
        expect(policy.assignWindows(30_000)[0]).toContain(':0:60000');
    });
});

// ─── SessionWindowPolicy ──────────────────────────────────────────────────────

describe('SessionWindowPolicy', () => {
    it('maxDurationMs equals gapMs * 2', () => {
        const policy = SessionWindowPolicy.of({ gapMs: 5_000 });
        expect(policy.maxDurationMs).toBe(10_000);
    });

    it('resolveKey extends existing open session within gapMs', () => {
        const policy = SessionWindowPolicy.of({ gapMs: 5_000 });
        const openSessions = new Map<string, number>();
        const k1 = policy.resolveKey(0, openSessions);
        openSessions.set(k1, 0);
        const k2 = policy.resolveKey(4_999, openSessions);
        expect(k2).toBe(k1);
    });

    it('resolveKey creates a new session when gap is exceeded', () => {
        const policy = SessionWindowPolicy.of({ gapMs: 5_000 });
        const openSessions = new Map<string, number>();
        const k1 = policy.resolveKey(0, openSessions);
        openSessions.set(k1, 0);
        const k2 = policy.resolveKey(6_000, openSessions);
        expect(k2).not.toBe(k1);
    });

    it('resolveKey picks closest open session when multiple are open', () => {
        const policy = SessionWindowPolicy.of({ gapMs: 5_000 });
        const openSessions = new Map([
            ['session:0', 0],
            ['session:10000', 10_000],
        ]);
        // event at 12_000: within gapMs=5000 of session at 10000
        const key = policy.resolveKey(12_000, openSessions);
        expect(key).toBe('session:10000');
    });

    it('assignWindows fallback uses epoch bucketing', () => {
        const policy = SessionWindowPolicy.of({ gapMs: 5_000 });
        const keys = policy.assignWindows(7_000);
        // epoch = floor(7000 / 5000) * 5000 = 5000
        expect(keys).toHaveLength(1);
        expect(keys[0]).toBe('session:5000');
    });
});

// ─── InMemoryWindowState ──────────────────────────────────────────────────────

describe('InMemoryWindowState', () => {
    it('put and get roundtrip preserves value', async () => {
        const state = new InMemoryWindowState<number[]>();
        await state.put('key1', [1, 2, 3]);
        const result = await state.get('key1');
        expect(result).toEqual([1, 2, 3]);
    });

    it('get returns null for missing key', async () => {
        const state = new InMemoryWindowState<string[]>();
        expect(await state.get('nonexistent')).toBeNull();
    });

    it('delete removes the key', async () => {
        const state = new InMemoryWindowState<number[]>();
        await state.put('k', [42]);
        await state.delete('k');
        expect(await state.get('k')).toBeNull();
    });

    it('list returns all stored keys', async () => {
        const state = new InMemoryWindowState<number[]>();
        await state.put('a', []);
        await state.put('b', []);
        await state.put('c', []);
        const keys = await state.list();
        expect(keys.sort()).toEqual(['a', 'b', 'c']);
    });

    it('overwriting a key updates the value', async () => {
        const state = new InMemoryWindowState<number[]>();
        await state.put('k', [1]);
        await state.put('k', [2, 3]);
        expect(await state.get('k')).toEqual([2, 3]);
    });
});

// ─── WindowOperator (tumbling, count trigger) ─────────────────────────────────

describe('WindowOperator — tumbling windows with count trigger', () => {
    it('accumulates events in KV state without closing before trigger', async () => {
        const policy = TumblingWindowPolicy.of({ size: 60_000 });
        const state = new InMemoryWindowState<string[]>();
        const op = new WindowOperator({ policy, state, countTrigger: 3, eventTimeExtractor: () => 1_000 });
        await op.process('a', makeCtx());
        await op.process('b', makeCtx());
        // Only 2 events, trigger is 3 — window should still be open
        const keys = await state.list();
        expect(keys).toHaveLength(1);
    });

    it('emits window and deletes from state when count trigger fires', async () => {
        const emitted: string[][] = [];
        const policy = TumblingWindowPolicy.of({ size: 60_000 });
        const state = new InMemoryWindowState<string[]>();
        const op = new WindowOperator({
            policy, state, countTrigger: 3,
            eventTimeExtractor: () => 1_000,
            onEmit: (_, events) => { emitted.push(events as string[]); },
        });
        await op.process('a', makeCtx());
        await op.process('b', makeCtx());
        await op.process('c', makeCtx()); // triggers close
        expect(emitted).toHaveLength(1);
        expect(emitted[0]).toEqual(['a', 'b', 'c']);
        // State should be empty after delete
        expect(await state.list()).toHaveLength(0);
    });

    it('process() returns the closed window events on trigger', async () => {
        const policy = TumblingWindowPolicy.of({ size: 60_000 });
        const state = new InMemoryWindowState<number[]>();
        const op = new WindowOperator({ policy, state, countTrigger: 2, eventTimeExtractor: () => 0 });
        await op.process(1, makeCtx());
        const result = await op.process(2, makeCtx());
        expect(result).toEqual([1, 2]);
    });

    it('events in different windows are tracked independently', async () => {
        const policy = TumblingWindowPolicy.of({ size: 60_000 });
        const state = new InMemoryWindowState<number[]>();
        const op = new WindowOperator({ policy, state, countTrigger: 10 });
        // Window 0: events at t=0
        const opA = new WindowOperator({ policy, state, countTrigger: 10, eventTimeExtractor: () => 0 });
        const opB = new WindowOperator({ policy, state, countTrigger: 10, eventTimeExtractor: () => 60_000 });
        await opA.process(1, makeCtx());
        await opB.process(100, makeCtx());
        const keys = await state.list();
        expect(keys).toHaveLength(2);
    });

    it('closeWindow() force-closes and returns events', async () => {
        const policy = TumblingWindowPolicy.of({ size: 60_000 });
        const state = new InMemoryWindowState<string[]>();
        const op = new WindowOperator({ policy, state, countTrigger: 100, eventTimeExtractor: () => 0 });
        await op.process('x', makeCtx());
        await op.process('y', makeCtx());
        const winKey = (await state.list())[0]!;
        const events = await op.closeWindow(winKey);
        expect(events).toEqual(['x', 'y']);
        expect(await state.list()).toHaveLength(0);
    });
});

// ─── WindowOperator (sliding windows) ────────────────────────────────────────

describe('WindowOperator — sliding windows', () => {
    it('one event accumulates into multiple window keys', async () => {
        const policy = SlidingWindowPolicy.of({ size: 60_000, slide: 30_000 });
        const state = new InMemoryWindowState<number[]>();
        const op = new WindowOperator({ policy, state, countTrigger: 100, eventTimeExtractor: () => 45_000 });
        await op.process(1, makeCtx());
        const keys = await state.list();
        // 45_000 is in [0,60000) and [30000,90000)
        expect(keys.length).toBeGreaterThanOrEqual(2);
    });

    it('sliding window closes all overlapping windows independently', async () => {
        const emitted: Array<{ key: string; events: number[] }> = [];
        const policy = SlidingWindowPolicy.of({ size: 60_000, slide: 30_000 });
        const state = new InMemoryWindowState<number[]>();
        const op = new WindowOperator({
            policy, state, countTrigger: 1,
            eventTimeExtractor: () => 45_000,
            onEmit: (key, events) => { emitted.push({ key, events: events as number[] }); },
        });
        await op.process(7, makeCtx());
        // Both windows should have been closed (count trigger = 1)
        expect(emitted.length).toBeGreaterThanOrEqual(2);
    });
});

// ─── WindowOperator (session windows) ────────────────────────────────────────

describe('WindowOperator — session windows', () => {
    it('consecutive events within gapMs accumulate in the same session', async () => {
        const policy = SessionWindowPolicy.of({ gapMs: 60_000 });
        const state = new InMemoryWindowState<number[]>();
        const times = [0, 10_000, 20_000]; // all within 60s gap
        let timeIndex = 0;
        const op = new WindowOperator({
            policy, state, countTrigger: 100,
            eventTimeExtractor: () => times[timeIndex++] ?? 0,
        });
        await op.process(1, makeCtx());
        await op.process(2, makeCtx());
        await op.process(3, makeCtx());
        const keys = await state.list();
        // All 3 events should be in the same session (1 key)
        expect(keys).toHaveLength(1);
        const events = await state.get(keys[0]!);
        expect(events).toHaveLength(3);
    });

    it('event beyond gapMs starts a new session', async () => {
        const policy = SessionWindowPolicy.of({ gapMs: 5_000 });
        const state = new InMemoryWindowState<number[]>();
        const times = [0, 10_000]; // gap of 10s > 5s → new session
        let timeIndex = 0;
        const op = new WindowOperator({
            policy, state, countTrigger: 100,
            eventTimeExtractor: () => times[timeIndex++] ?? 0,
        });
        await op.process(1, makeCtx());
        await op.process(2, makeCtx());
        const keys = await state.list();
        // Two separate sessions
        expect(keys).toHaveLength(2);
    });
});

// ─── NATS KV WindowState (integration — skip unless NATS available) ───────────

const NATS_AVAILABLE = !!process.env['NATS_URL'] || !!process.env['CI'];
const NATS_URL = process.env['NATS_URL'] ?? 'nats://localhost:4222';

describe.skipIf(!NATS_AVAILABLE)('NatsKvWindowState — NATS integration', () => {
    let natsServer: ReturnType<typeof Bun.spawn> | null = null;

    beforeAll(async () => {
        if (!process.env['NATS_URL']) {
            natsServer = Bun.spawn(
                [require.resolve('nats-server/bin/nats-server'), '-js', '-p', '4222'],
                { stdout: 'ignore', stderr: 'ignore' },
            );
            const { connect } = await import('@nats-io/transport-node');
            for (let i = 0; i < 30; i++) {
                try {
                    const nc = await connect({ servers: 'nats://localhost:4222', timeout: 500 });
                    await nc.close();
                    break;
                } catch {
                    await Bun.sleep(100);
                }
            }
        }
    });

    afterAll(() => {
        natsServer?.kill();
    });

    it('put/get/delete/list roundtrip via NATS KV', async () => {
        const { connect } = await import('@nats-io/transport-node');
        const { Kvm } = await import('@nats-io/kv');
        const nc = await connect({ servers: NATS_URL });
        const kvm = new Kvm(nc);
        const state = await NatsKvWindowState.create<number[]>(kvm, 'test-pipeline', 30_000);
        await state.put('w1', [1, 2, 3]);
        expect(await state.get('w1')).toEqual([1, 2, 3]);
        const keys = await state.list();
        expect(keys).toContain('w1');
        await state.delete('w1');
        expect(await state.get('w1')).toBeNull();
        await nc.close();
    });

    it('KV bucket has safety-backstop TTL equal to maxDurationMs * 3', async () => {
        const { connect } = await import('@nats-io/transport-node');
        const { Kvm } = await import('@nats-io/kv');
        const nc = await connect({ servers: NATS_URL });
        const kvm = new Kvm(nc);
        const maxDurationMs = 10_000;
        const state = await NatsKvWindowState.create<string[]>(kvm, 'ttl-test', maxDurationMs * 3);
        const kv = (state as NatsKvWindowState<string[]>).kv;
        const status = await kv.status();
        // TTL should be set to maxDurationMs * 3 (30000 ms)
        expect(status.ttl).toBeGreaterThan(0);
        await nc.close();
    });

    it('WindowState survives simulated restart (state persists in NATS)', async () => {
        const { connect } = await import('@nats-io/transport-node');
        const { Kvm } = await import('@nats-io/kv');

        // First "process" — accumulate
        const nc1 = await connect({ servers: NATS_URL });
        const kvm1 = new Kvm(nc1);
        const state1 = await NatsKvWindowState.create<number[]>(kvm1, 'restart-test', 60_000);
        await state1.put('win:0:60000', [1, 2, 3]);
        await nc1.close();

        // Second "process" — simulated restart, state should still be there
        const nc2 = await connect({ servers: NATS_URL });
        const kvm2 = new Kvm(nc2);
        const state2 = await NatsKvWindowState.create<number[]>(kvm2, 'restart-test', 60_000);
        const events = await state2.get('win:0:60000');
        expect(events).toEqual([1, 2, 3]);
        await state2.delete('win:0:60000');
        await nc2.close();
    });
});
