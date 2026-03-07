/**
 * Block 10.6 — Stream joins tests
 *
 * Tests: HashJoinOperator (stream-table hash join) and
 * WindowedJoinOperator (stream-stream windowed join).
 *
 * Total: 25 tests
 */
import { describe, expect, it } from 'bun:test';
import { HashJoinOperator } from '../src/join/HashJoinOperator.ts';
import {
    WindowedJoinOperator,
    type JoinEvent,
} from '../src/join/WindowedJoinOperator.ts';
import type { StageContext } from '../src/StageContext.ts';
import { TumblingWindowPolicy } from '../src/window/TumblingWindowPolicy.ts';
import { InMemoryWindowState } from '../src/window/WindowState.ts';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCtx(): StageContext {
    return { messageId: 'msg-1', deliveryCount: 1, nak: () => {} };
}

// ─── HashJoinOperator ─────────────────────────────────────────────────────────

describe('HashJoinOperator', () => {
    describe('basic enrichment', () => {
        it('enriches event when table has matching entry', async () => {
            const table = new Map([['p1', { category: 'Electronics' }]]);
            const op = new HashJoinOperator(
                (order: { productId: string }) => order.productId,
                key => table.get(key) ?? null,
                (order, details) => ({ ...order, category: details?.category ?? 'unknown' }),
            );
            const result = await op.process({ productId: 'p1' }, makeCtx());
            expect(result).toEqual({ productId: 'p1', category: 'Electronics' });
        });

        it('passes null side input when key is missing (left-outer join)', async () => {
            const table = new Map<string, { category: string }>();
            const op = new HashJoinOperator(
                (order: { productId: string }) => order.productId,
                key => table.get(key) ?? null,
                (order, details) => ({ ...order, category: details?.category ?? 'unknown' }),
            );
            const result = await op.process({ productId: 'p99' }, makeCtx());
            expect(result).toEqual({ productId: 'p99', category: 'unknown' });
        });

        it('receives null when lookup returns undefined', async () => {
            let receivedSideInput: string | null | undefined;
            const op = new HashJoinOperator(
                (_e: string) => 'key',
                (_key: string) => undefined,
                (event, sideInput) => {
                    receivedSideInput = sideInput;
                    return event;
                },
            );
            await op.process('hello', makeCtx());
            expect(receivedSideInput).toBeNull();
        });
    });

    describe('key function', () => {
        it('extracts simple string key from event', async () => {
            const table = new Map([['user-42', 'Alice']]);
            const op = new HashJoinOperator(
                (e: { userId: string }) => e.userId,
                key => table.get(key) ?? null,
                (e, name) => ({ ...e, name }),
            );
            expect(await op.process({ userId: 'user-42' }, makeCtx())).toEqual({
                userId: 'user-42',
                name: 'Alice',
            });
        });

        it('extracts nested property key', async () => {
            const table = new Map([['city-NYC', 'New York City']]);
            const op = new HashJoinOperator(
                (e: { address: { city: string } }) => `city-${e.address.city}`,
                key => table.get(key) ?? null,
                (e, fullName) => ({ ...e, fullCityName: fullName }),
            );
            const result = await op.process({ address: { city: 'NYC' } }, makeCtx());
            expect(result.fullCityName).toBe('New York City');
        });

        it('async keyFn resolves before lookup', async () => {
            const table = new Map([['async-key', 'found']]);
            const op = new HashJoinOperator(
                async (_e: number) => {
                    await Promise.resolve();
                    return 'async-key';
                },
                key => table.get(key) ?? null,
                (_e, v) => v,
            );
            expect(await op.process(42, makeCtx())).toBe('found');
        });
    });

    describe('merge function', () => {
        it('merge fn receives original event and side input', async () => {
            let capturedEvent: unknown;
            let capturedSide: unknown;
            const op = new HashJoinOperator(
                (_e: string) => 'k',
                () => 'sideValue',
                (event, sideInput) => {
                    capturedEvent = event;
                    capturedSide = sideInput;
                    return event;
                },
            );
            await op.process('myEvent', makeCtx());
            expect(capturedEvent).toBe('myEvent');
            expect(capturedSide).toBe('sideValue');
        });

        it('async merge fn is awaited', async () => {
            const op = new HashJoinOperator(
                (_e: number) => 'key',
                () => 10,
                async (event, sideInput) => {
                    await Promise.resolve();
                    return event + (sideInput ?? 0);
                },
            );
            expect(await op.process(5, makeCtx())).toBe(15);
        });

        it('async lookup is awaited', async () => {
            const op = new HashJoinOperator(
                (_e: number) => 'key',
                async () => {
                    await Promise.resolve();
                    return 'async-result';
                },
                (_event, sideInput) => sideInput,
            );
            expect(await op.process(1, makeCtx())).toBe('async-result');
        });
    });

    describe('multiple events', () => {
        it('each event gets its own independent lookup', async () => {
            const table = new Map([
                ['a', 1],
                ['b', 2],
                ['c', 3],
            ]);
            const op = new HashJoinOperator(
                (e: { id: string }) => e.id,
                key => table.get(key) ?? null,
                (e, n) => ({ ...e, score: n }),
            );
            const ctx = makeCtx();
            const r1 = await op.process({ id: 'a' }, ctx);
            const r2 = await op.process({ id: 'b' }, ctx);
            const r3 = await op.process({ id: 'c' }, ctx);
            expect(r1.score).toBe(1);
            expect(r2.score).toBe(2);
            expect(r3.score).toBe(3);
        });

        it('all events enriched with their respective side inputs', async () => {
            const table = new Map([['k1', 'v1'], ['k2', 'v2']]);
            const op = new HashJoinOperator(
                (e: string) => e,
                key => table.get(key) ?? null,
                (e, v) => `${e}:${v ?? 'missing'}`,
            );
            const ctx = makeCtx();
            expect(await op.process('k1', ctx)).toBe('k1:v1');
            expect(await op.process('k2', ctx)).toBe('k2:v2');
            expect(await op.process('k3', ctx)).toBe('k3:missing');
        });
    });
});

// ─── WindowedJoinOperator ─────────────────────────────────────────────────────

type Click = { userId: string; url: string };
type Purchase = { userId: string; amount: number };
type JoinedEvent = { click: Click; purchase: Purchase };

function makeJoinOp(countTrigger?: number) {
    const state = new InMemoryWindowState<JoinEvent<Click, Purchase>[]>();
    const policy = TumblingWindowPolicy.of({ size: 60_000 });
    return new WindowedJoinOperator<Click, Purchase, JoinedEvent>(
        {
            policy,
            state,
            predicate: (click, purchase) => click.userId === purchase.userId,
            countTrigger,
            eventTimeExtractor: () => 0, // fixed timestamp → always same window key
        },
        (click, purchase) => ({ click, purchase }),
    );
}

describe('WindowedJoinOperator', () => {
    describe('buffering and window assignment', () => {
        it('stores left events without closing window', async () => {
            const op = makeJoinOp();
            const ctx = makeCtx();
            const result = await op.process(
                WindowedJoinOperator.left({ userId: 'u1', url: '/home' }),
                ctx,
            );
            expect(result).toBeUndefined();
        });

        it('stores right events without closing window', async () => {
            const op = makeJoinOp();
            const ctx = makeCtx();
            const result = await op.process(
                WindowedJoinOperator.right({ userId: 'u1', amount: 99 }),
                ctx,
            );
            expect(result).toBeUndefined();
        });

        it('events in different window keys are stored separately', async () => {
            const state = new InMemoryWindowState<JoinEvent<Click, Purchase>[]>();
            const policy = TumblingWindowPolicy.of({ size: 60_000 });
            let ts = 0;
            const op = new WindowedJoinOperator<Click, Purchase, JoinedEvent>(
                {
                    policy,
                    state,
                    predicate: (c, p) => c.userId === p.userId,
                    eventTimeExtractor: () => ts,
                },
                (c, p) => ({ click: c, purchase: p }),
            );
            const ctx = makeCtx();
            // Window 0
            ts = 0;
            await op.process(WindowedJoinOperator.left({ userId: 'u1', url: '/a' }), ctx);
            // Window 1 (60s later)
            ts = 120_000;
            await op.process(
                WindowedJoinOperator.right({ userId: 'u1', amount: 10 }),
                ctx,
            );
            // Close window 0 → has left but no right
            const key0 = policy.assignWindows(0)[0]!;
            const result0 = await op.closeWindow(key0);
            expect(result0).toEqual([]);

            // Close window 1 → has right but no left
            const key1 = policy.assignWindows(120_000)[0]!;
            const result1 = await op.closeWindow(key1);
            expect(result1).toEqual([]);
        });
    });

    describe('cross-join on window close', () => {
        it('cross-joins left and right events on close', async () => {
            const op = makeJoinOp();
            const ctx = makeCtx();
            await op.process(
                WindowedJoinOperator.left({ userId: 'u1', url: '/home' }),
                ctx,
            );
            await op.process(
                WindowedJoinOperator.right({ userId: 'u1', amount: 50 }),
                ctx,
            );
            const key = TumblingWindowPolicy.of({ size: 60_000 }).assignWindows(0)[0]!;
            const result = await op.closeWindow(key);
            expect(result).toHaveLength(1);
            expect(result![0]).toEqual({
                click: { userId: 'u1', url: '/home' },
                purchase: { userId: 'u1', amount: 50 },
            });
        });

        it('empty right side produces empty result', async () => {
            const op = makeJoinOp();
            const ctx = makeCtx();
            await op.process(
                WindowedJoinOperator.left({ userId: 'u1', url: '/home' }),
                ctx,
            );
            const key = TumblingWindowPolicy.of({ size: 60_000 }).assignWindows(0)[0]!;
            expect(await op.closeWindow(key)).toEqual([]);
        });

        it('empty left side produces empty result', async () => {
            const op = makeJoinOp();
            const ctx = makeCtx();
            await op.process(
                WindowedJoinOperator.right({ userId: 'u1', amount: 50 }),
                ctx,
            );
            const key = TumblingWindowPolicy.of({ size: 60_000 }).assignWindows(0)[0]!;
            expect(await op.closeWindow(key)).toEqual([]);
        });

        it('N×M cross-join produces all matching pairs', async () => {
            const op = makeJoinOp();
            const ctx = makeCtx();
            await op.process(
                WindowedJoinOperator.left({ userId: 'u1', url: '/page1' }),
                ctx,
            );
            await op.process(
                WindowedJoinOperator.left({ userId: 'u1', url: '/page2' }),
                ctx,
            );
            await op.process(
                WindowedJoinOperator.right({ userId: 'u1', amount: 10 }),
                ctx,
            );
            await op.process(
                WindowedJoinOperator.right({ userId: 'u1', amount: 20 }),
                ctx,
            );
            const key = TumblingWindowPolicy.of({ size: 60_000 }).assignWindows(0)[0]!;
            const result = await op.closeWindow(key);
            expect(result).toHaveLength(4); // 2×2
        });

        it('closeWindow returns null for unknown key', async () => {
            const op = makeJoinOp();
            const result = await op.closeWindow('no-such-key');
            expect(result).toBeNull();
        });
    });

    describe('predicate filtering', () => {
        it('predicate filters non-matching pairs by userId', async () => {
            const op = makeJoinOp();
            const ctx = makeCtx();
            await op.process(
                WindowedJoinOperator.left({ userId: 'u1', url: '/a' }),
                ctx,
            );
            await op.process(
                WindowedJoinOperator.right({ userId: 'u2', amount: 99 }), // different user
                ctx,
            );
            const key = TumblingWindowPolicy.of({ size: 60_000 }).assignWindows(0)[0]!;
            const result = await op.closeWindow(key);
            expect(result).toEqual([]);
        });

        it('predicate all-match produces all pairs', async () => {
            const state = new InMemoryWindowState<JoinEvent<number, number>[]>();
            const policy = TumblingWindowPolicy.of({ size: 60_000 });
            const op = new WindowedJoinOperator<number, number, number>(
                {
                    policy,
                    state,
                    predicate: () => true, // always match
                    eventTimeExtractor: () => 0,
                },
                (l, r) => l + r,
            );
            const ctx = makeCtx();
            await op.process(WindowedJoinOperator.left(1), ctx);
            await op.process(WindowedJoinOperator.left(2), ctx);
            await op.process(WindowedJoinOperator.right(10), ctx);
            const key = policy.assignWindows(0)[0]!;
            const result = await op.closeWindow(key);
            expect(result).toHaveLength(2);
            expect(result).toContain(11); // 1+10
            expect(result).toContain(12); // 2+10
        });

        it('mixed users — only matching userId pairs are emitted', async () => {
            const op = makeJoinOp();
            const ctx = makeCtx();
            await op.process(
                WindowedJoinOperator.left({ userId: 'u1', url: '/home' }),
                ctx,
            );
            await op.process(
                WindowedJoinOperator.left({ userId: 'u2', url: '/shop' }),
                ctx,
            );
            await op.process(
                WindowedJoinOperator.right({ userId: 'u1', amount: 100 }),
                ctx,
            );
            await op.process(
                WindowedJoinOperator.right({ userId: 'u3', amount: 200 }), // no matching left
                ctx,
            );
            const key = TumblingWindowPolicy.of({ size: 60_000 }).assignWindows(0)[0]!;
            const result = await op.closeWindow(key);
            // Only u1 left × u1 right matches
            expect(result).toHaveLength(1);
            expect(result![0]!.click.userId).toBe('u1');
            expect(result![0]!.purchase.userId).toBe('u1');
        });
    });

    describe('merge function', () => {
        it('merge fn produces combined output object', async () => {
            const state = new InMemoryWindowState<JoinEvent<string, number>[]>();
            const policy = TumblingWindowPolicy.of({ size: 60_000 });
            const op = new WindowedJoinOperator<string, number, string>(
                {
                    policy,
                    state,
                    predicate: () => true,
                    eventTimeExtractor: () => 0,
                },
                (l, r) => `${l}-${r}`,
            );
            const ctx = makeCtx();
            await op.process(WindowedJoinOperator.left('hello'), ctx);
            await op.process(WindowedJoinOperator.right(42), ctx);
            const key = policy.assignWindows(0)[0]!;
            const result = await op.closeWindow(key);
            expect(result).toEqual(['hello-42']);
        });
    });

    describe('count trigger', () => {
        it('countTrigger closes window automatically when threshold reached', async () => {
            const op = makeJoinOp(2); // close after 2 events
            const ctx = makeCtx();
            // First event → no close
            const r1 = await op.process(
                WindowedJoinOperator.left({ userId: 'u1', url: '/home' }),
                ctx,
            );
            expect(r1).toBeUndefined();
            // Second event → triggers close
            const r2 = await op.process(
                WindowedJoinOperator.right({ userId: 'u1', amount: 50 }),
                ctx,
            );
            expect(Array.isArray(r2)).toBe(true);
            expect((r2 as JoinedEvent[]).length).toBe(1);
        });

        it('late arrivals in same window are included before close', async () => {
            const op = makeJoinOp(); // no count trigger
            const ctx = makeCtx();
            // Events arrive in any order — all end up in same window (ts=0)
            await op.process(
                WindowedJoinOperator.right({ userId: 'u1', amount: 30 }),
                ctx,
            );
            await op.process(
                WindowedJoinOperator.left({ userId: 'u1', url: '/late' }),
                ctx,
            );
            const key = TumblingWindowPolicy.of({ size: 60_000 }).assignWindows(0)[0]!;
            const result = await op.closeWindow(key);
            expect(result).toHaveLength(1);
        });
    });
});
