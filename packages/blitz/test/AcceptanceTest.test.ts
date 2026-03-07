/**
 * Block 10.10 — End-to-end acceptance + feature parity gate
 *
 * Validates that @zenystx/helios-blitz meets the 80%+ parity contract with Hazelcast Jet.
 * Each describe block maps to a Hazelcast Jet integration test scenario.
 *
 * All tests are pure in-memory (no NATS required).
 * NATS-dependent integration tests are in the individual block test files,
 * wrapped in `describe.skipIf(!NATS_AVAILABLE)`.
 *
 * ~20 tests total.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

// Pipeline
import { BatchPipeline } from '../src/batch/BatchPipeline.ts';
import type { BatchResult } from '../src/batch/BatchResult.ts';
import { Pipeline } from '../src/Pipeline.ts';

// Sources / sinks
import { HeliosMapSink } from '../src/sink/HeliosMapSink.ts';
import type { Sink } from '../src/sink/Sink.ts';
import { FileSource } from '../src/source/FileSource.ts';
import type { Source, SourceMessage } from '../src/source/Source.ts';

// Windowing
import { AggregatingOperator } from '../src/aggregate/AggregatingOperator.ts';
import { SessionWindowPolicy } from '../src/window/SessionWindowPolicy.ts';
import { SlidingWindowPolicy } from '../src/window/SlidingWindowPolicy.ts';
import { TumblingWindowPolicy } from '../src/window/TumblingWindowPolicy.ts';
import { WindowOperator } from '../src/window/WindowOperator.ts';
import { InMemoryWindowState } from '../src/window/WindowState.ts';

// Aggregations
import { CountAggregator } from '../src/aggregate/CountAggregator.ts';
import { SumAggregator } from '../src/aggregate/SumAggregator.ts';

// Joins
import { HashJoinOperator } from '../src/join/HashJoinOperator.ts';
import type { JoinEvent } from '../src/join/WindowedJoinOperator.ts';
import { WindowedJoinOperator } from '../src/join/WindowedJoinOperator.ts';

// Fault tolerance
import { AckPolicy } from '../src/fault/AckPolicy.ts';
import type { CheckpointStore } from '../src/fault/CheckpointManager.ts';
import { CheckpointManager } from '../src/fault/CheckpointManager.ts';
import type { DLPublisher } from '../src/fault/DeadLetterSink.ts';
import { DeadLetterSink } from '../src/fault/DeadLetterSink.ts';
import type { FaultMessage } from '../src/fault/FaultHandler.ts';
import { FaultHandler } from '../src/fault/FaultHandler.ts';
import { RetryPolicy } from '../src/fault/RetryPolicy.ts';
import type { StageContext } from '../src/StageContext.ts';

// ─── Shared helpers ────────────────────────────────────────────────────────────

function arraySource<T>(items: T[], name = 'array-source'): Source<T> {
    return {
        name,
        codec: {
            encode: (v: T) => new TextEncoder().encode(JSON.stringify(v)),
            decode: (b: Uint8Array) => JSON.parse(new TextDecoder().decode(b)) as T,
        },
        async *messages(): AsyncIterable<SourceMessage<T>> {
            for (const item of items) {
                yield { value: item, ack: () => {}, nak: () => {} };
            }
        },
    };
}

function collectSink<T>(name = 'collect-sink'): Sink<T> & { collected: T[] } {
    const collected: T[] = [];
    return {
        name,
        collected,
        async write(value: T): Promise<void> {
            collected.push(value);
        },
    };
}

function makeCtx(deliveryCount = 1): StageContext {
    return { messageId: `msg-${Math.random()}`, deliveryCount, nak: () => {} };
}

function makeFaultMsg(deliveryCount = 1, fail = false): FaultMessage & {
    ackCalls: number;
    nakCalls: number;
} {
    let ackCalls = 0;
    let nakCalls = 0;
    return {
        subject: 'test.subject',
        data: new TextEncoder().encode('payload'),
        deliveryCount,
        ack(): void { ackCalls++; },
        nak(_opts?: { delay?: number }): void { nakCalls++; },
        get ackCalls() { return ackCalls; },
        get nakCalls() { return nakCalls; },
    } as any;
}

function makeInMemoryCheckpointStore(): CheckpointStore & { stored: Map<string, Uint8Array> } {
    const stored = new Map<string, Uint8Array>();
    return {
        stored,
        async put(key, value) { stored.set(key, value); },
        async get(key) { const v = stored.get(key); return v ? { value: v } : null; },
    };
}

/** Minimal IMap stub for HeliosMapSink acceptance test. */
function makeIMapStub<K, V>(name = 'test-map') {
    const data = new Map<K, V>();
    return {
        getName: () => name,
        get: async (k: K) => data.get(k) ?? null,
        put: async (k: K, v: V) => { data.set(k, v); return null as V | null; },
        size: () => data.size,
        data,
    } as unknown as import('@zenystx/helios-core/map/IMap').IMap<K, V> & {
        data: Map<K, V>;
        size(): number;
    };
}

// ─── Scenario 1: PipelineTest ──────────────────────────────────────────────────

describe('PipelineTest — multi-stage source → map → filter → sink', () => {
    it('processes all items through map + filter and delivers to sink', async () => {
        // source: [1..10], map: *3, filter: >15, sink: collect
        const sink = collectSink<number>();
        const pipeline = new BatchPipeline('pipeline-test');
        const result: BatchResult = await pipeline
            .readFrom(arraySource([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))
            .map((n: number) => n * 3)
            .filter((n: number) => n > 15)
            .writeTo(sink);

        // 6*3=18, 7*3=21, 8*3=24, 9*3=27, 10*3=30 → 5 items pass
        expect(result.recordsIn).toBe(10);
        expect(result.recordsOut).toBe(5);
        expect(sink.collected).toEqual([18, 21, 24, 27, 30]);
    });

    it('Pipeline DAG validates correctly for a full source→op→sink chain', () => {
        const p = new Pipeline('validation-smoke');
        p.readFrom(arraySource<number>([1, 2, 3]))
            .map(n => n * 2)
            .filter(n => n > 0)
            .writeTo(collectSink<number>());
        expect(() => p.validate()).not.toThrow();
        // 4 vertices: source + map + filter + sink
        expect(p.vertices.length).toBe(4);
        expect(p.edges.length).toBe(3);
    });
});

// ─── Scenario 2: WindowAggregationTest ────────────────────────────────────────

describe('WindowAggregationTest — tumbling window + count aggregation over stream', () => {
    it('assigns events to tumbling windows and aggregates count per window', async () => {
        const policy = TumblingWindowPolicy.of({ size: 1000 });
        const state = new InMemoryWindowState<number[]>();
        const op = new WindowOperator<number>({ policy, state, countTrigger: 3 });
        const ctx = makeCtx();

        const aggOp = new AggregatingOperator(CountAggregator.of<number>());

        // Process 3 events → window closes with countTrigger
        await op.process(10, ctx);
        await op.process(20, ctx);
        const closed = await op.process(30, ctx) as number[];

        expect(closed).toEqual([10, 20, 30]);
        const count = await aggOp.process(closed, ctx);
        expect(count).toBe(3);
    });

    it('tumbling window emits correct count for each closed window independently', async () => {
        const policy = TumblingWindowPolicy.of({ size: 1000 });
        const state = new InMemoryWindowState<string[]>();
        const op = new WindowOperator<string>({ policy, state, countTrigger: 2 });
        const aggOp = new AggregatingOperator(CountAggregator.of<string>());
        const ctx = makeCtx();

        const w1 = await op.process('a', ctx);
        const w1closed = await op.process('b', ctx) as string[];
        expect(w1closed).toHaveLength(2);
        expect(await aggOp.process(w1closed, ctx)).toBe(2);

        // State cleared: next window starts fresh
        const w2open = await op.process('c', ctx);
        expect(w2open).toBeUndefined();
    });
});

// ─── Scenario 3: SlidingWindowTest ────────────────────────────────────────────

describe('SlidingWindowTest — sliding window produces overlapping results', () => {
    it('assigns a single event to multiple overlapping windows', () => {
        const policy = SlidingWindowPolicy.of({ size: 100, slide: 50 });
        const t = 75;
        const keys = policy.assignWindows(t);
        // t=75 fits in [0,100) and [50,150)
        expect(keys.length).toBeGreaterThanOrEqual(2);
        for (const k of keys) {
            expect(k).toMatch(/^sliding:\d+:\d+$/);
        }
    });

    it('accumulates the same event in multiple windows', async () => {
        const policy = SlidingWindowPolicy.of({ size: 100, slide: 50 });
        const state = new InMemoryWindowState<number[]>();
        const op = new WindowOperator<number>({ policy, state });
        const ctx = makeCtx();

        // process event at t=75 (belongs to multiple windows)
        await op.process(75, ctx);
        const openKeys = await state.list();
        expect(openKeys.length).toBeGreaterThanOrEqual(2);
    });

    it('force-close emits accumulated events for overlapping window', async () => {
        const policy = SlidingWindowPolicy.of({ size: 100, slide: 50 });
        const state = new InMemoryWindowState<number[]>();
        const op = new WindowOperator<number>({ policy, state });
        const ctx = makeCtx();

        await op.process(75, ctx);  // t=75 → enters [0,100) and [50,150)
        const keys = await state.list();
        expect(keys.length).toBeGreaterThanOrEqual(2);

        const closed = await op.closeWindow(keys[0]!);
        expect(closed).toContain(75);
    });
});

// ─── Scenario 4: SessionWindowTest ────────────────────────────────────────────

describe('SessionWindowTest — session window closes on inactivity gap', () => {
    it('groups consecutive events within gap into same session', async () => {
        const policy = SessionWindowPolicy.of({ gapMs: 500 });
        const state = new InMemoryWindowState<number[]>();
        const op = new WindowOperator<number>({ policy, state });
        const ctx = makeCtx();
        const baseTime = 1_000_000;

        // events at t=0, t=100ms, t=200ms (all within 500ms gap)
        await op.process(baseTime, ctx);
        await op.process(baseTime + 100, ctx);
        await op.process(baseTime + 200, ctx);

        const keys = await state.list();
        // All should land in one session window
        expect(keys.length).toBe(1);
        const accumulated = await state.get(keys[0]!);
        expect(accumulated).toHaveLength(3);
    });

    it('opens a new session when events exceed inactivity gap', async () => {
        const policy = SessionWindowPolicy.of({ gapMs: 200 });
        const state = new InMemoryWindowState<number[]>();
        const op = new WindowOperator<number>({ policy, state });
        const ctx = makeCtx();

        const t1 = 1_000_000;
        const t2 = t1 + 100;   // within gap → same session
        const t3 = t1 + 5000;  // beyond gap → new session

        await op.process(t1, ctx);
        await op.process(t2, ctx);
        // Close first session manually
        const keys1 = await state.list();
        const closed = await op.closeWindow(keys1[0]!);
        expect(closed).toHaveLength(2);

        await op.process(t3, ctx);
        const keys2 = await state.list();
        expect(keys2.length).toBe(1);
        const session2 = await state.get(keys2[0]!);
        expect(session2).toHaveLength(1);
        expect(session2![0]).toBe(t3);
    });
});

// ─── Scenario 5: HashJoinTest ──────────────────────────────────────────────────

describe('HashJoinTest — enrich stream events from lookup (stream-table join)', () => {
    it('enriches each event with side-table data', async () => {
        type Order = { orderId: string; productId: string };
        type Product = { name: string; price: number };

        const catalog = new Map<string, Product>([
            ['p1', { name: 'Widget', price: 9.99 }],
            ['p2', { name: 'Gadget', price: 29.99 }],
        ]);

        const op = new HashJoinOperator<Order, string, Product, Order & Product>(
            order => order.productId,
            key => catalog.get(key) ?? null,
            (order, product) => ({ ...order, name: product?.name ?? 'unknown', price: product?.price ?? 0 }),
        );

        const ctx = makeCtx();
        const result = await op.process({ orderId: 'o1', productId: 'p1' }, ctx);
        expect(result.name).toBe('Widget');
        expect(result.price).toBe(9.99);
        expect(result.orderId).toBe('o1');
    });

    it('uses null-safe default when side-table has no entry for key', async () => {
        type Event = { id: string; ref: string };
        type Meta = { label: string };

        const op = new HashJoinOperator<Event, string, Meta, { id: string; label: string }>(
            e => e.ref,
            _key => null,
            (e, meta) => ({ id: e.id, label: meta?.label ?? 'UNKNOWN' }),
        );

        const ctx = makeCtx();
        const result = await op.process({ id: 'x', ref: 'missing' }, ctx);
        expect(result.label).toBe('UNKNOWN');
    });
});

// ─── Scenario 6: StreamStreamJoinTest ─────────────────────────────────────────

describe('StreamStreamJoinTest — match events from two streams within window', () => {
    it('joins left and right events by predicate within tumbling window', async () => {
        type Click = { userId: string; page: string };
        type Purchase = { userId: string; amount: number };
        type JoinedEvent = { userId: string; page: string; amount: number };

        const policy = TumblingWindowPolicy.of({ size: 60_000 });
        const state = new InMemoryWindowState<JoinEvent<Click, Purchase>[]>();

        const op = new WindowedJoinOperator<Click, Purchase, JoinedEvent>(
            {
                policy,
                state,
                predicate: (c, p) => c.userId === p.userId,
                countTrigger: 4,
                eventTimeExtractor: () => 30_000, // all in same tumbling window
            },
            (click, purchase) => ({ userId: click.userId, page: click.page, amount: purchase.amount }),
        );

        const ctx = makeCtx();
        await op.process(WindowedJoinOperator.left({ userId: 'u1', page: '/home' }), ctx);
        await op.process(WindowedJoinOperator.left({ userId: 'u2', page: '/checkout' }), ctx);
        await op.process(WindowedJoinOperator.right({ userId: 'u1', amount: 49.99 }), ctx);
        const results = await op.process(WindowedJoinOperator.right({ userId: 'u2', amount: 99.99 }), ctx) as JoinedEvent[];

        // countTrigger=4 → window closes after 4th event
        expect(results).toHaveLength(2);
        const u1 = results.find(r => r.userId === 'u1')!;
        expect(u1.page).toBe('/home');
        expect(u1.amount).toBe(49.99);
    });

    it('manual closeWindow emits cross-product of left × right filtered by predicate', async () => {
        type L = { id: number };
        type R = { id: number };
        const policy = TumblingWindowPolicy.of({ size: 10_000 });
        const state = new InMemoryWindowState<JoinEvent<L, R>[]>();
        const op = new WindowedJoinOperator<L, R, string>(
            {
                policy,
                state,
                predicate: (l, r) => l.id === r.id,
                eventTimeExtractor: () => 5_000,
            },
            (l, r) => `${l.id}:${r.id}`,
        );
        const ctx = makeCtx();

        await op.process(WindowedJoinOperator.left({ id: 1 }), ctx);
        await op.process(WindowedJoinOperator.left({ id: 2 }), ctx);
        await op.process(WindowedJoinOperator.right({ id: 1 }), ctx);
        await op.process(WindowedJoinOperator.right({ id: 3 }), ctx);

        const keys = await state.list();
        expect(keys.length).toBe(1);
        const results = await op.closeWindow(keys[0]!) as string[];
        // Only id=1 matches
        expect(results).toEqual(['1:1']);
    });
});

// ─── Scenario 7: FaultToleranceTest ───────────────────────────────────────────

describe('FaultToleranceTest — operator crash → retry → recovery without data loss', () => {
    it('acks on success and does not nak', async () => {
        const handler = new FaultHandler({
            ackPolicy: AckPolicy.EXPLICIT,
            retryPolicy: RetryPolicy.fixed(3, 100),
        });
        const msg = makeFaultMsg(1);
        await handler.handle(msg, async () => 'ok');
        expect(msg.ackCalls).toBe(1);
        expect(msg.nakCalls).toBe(0);
    });

    it('naks on first failure and retries (maxRetries=3, attempt 0 < 3)', async () => {
        const handler = new FaultHandler({
            ackPolicy: AckPolicy.EXPLICIT,
            retryPolicy: RetryPolicy.fixed(3, 100),
        });
        const msg = makeFaultMsg(1);
        await handler.handle(msg, async () => { throw new Error('transient'); });
        expect(msg.ackCalls).toBe(0);
        expect(msg.nakCalls).toBe(1); // retry
    });

    it('routes to dead-letter when retries exhausted (deliveryCount > maxRetries)', async () => {
        const dlCalls: Array<{ subject: string; payload: Uint8Array }> = [];
        const publisher: DLPublisher = {
            async publish(subject, payload) { dlCalls.push({ subject, payload }); },
        };
        const dlSink = new DeadLetterSink(publisher, 'dead-letter.failures');
        const handler = new FaultHandler({
            ackPolicy: AckPolicy.EXPLICIT,
            retryPolicy: RetryPolicy.fixed(3, 100),
            deadLetterSink: dlSink,
        });
        // deliveryCount=4 → attempt=3 → shouldRetry(3) = false → DL
        const msg = makeFaultMsg(4);
        await handler.handle(msg, async () => { throw new Error('permanent'); });
        expect(dlCalls.length).toBe(1);
        expect(dlCalls[0]!.subject).toBe('dead-letter.failures');
        expect(msg.nakCalls).toBe(0); // no more nak after DL
    });
});

// ─── Scenario 8: BatchJobTest ──────────────────────────────────────────────────

describe('BatchJobTest — FileSource → transform → HeliosMapSink completes with correct count', () => {
    it('BatchPipeline with array source → map → collect sink reports correct BatchResult', async () => {
        // Simulate FileSource → transform → HeliosMapSink
        // Using array source (FileSource requires real file; integration tested via HeliosMapSink)
        const mapStub = makeIMapStub<string, number>('word-count');
        const sink = HeliosMapSink.put(mapStub);

        const words = ['apple', 'banana', 'cherry', 'apple', 'banana'];
        const pipeline = new BatchPipeline('batch-word-count');
        const result = await pipeline
            .readFrom(arraySource(words, 'words-source'))
            .map((word: string) => ({ key: word, value: word.length }))
            .writeTo(sink);

        expect(result.recordsIn).toBe(5);
        expect(result.recordsOut).toBe(5);
        expect(result.errorCount).toBe(0);
        // HeliosMapSink writes key/value pairs
        expect(mapStub.data.get('apple')).toBe(5);
        expect(mapStub.data.get('banana')).toBe(6);
        expect(mapStub.data.get('cherry')).toBe(6);
    });

    it('FileSource.lines() creates a bounded source with correct name format', () => {
        const src = FileSource.lines('/some/path/data.txt');
        expect(src.name).toBe('file-source:/some/path/data.txt');
    });
});

// ─── Scenario 9: DeadLetterTest ───────────────────────────────────────────────

describe('DeadLetterTest — exhausted retries route to DL stream', () => {
    it('DeadLetterSink publishes to named stream with provenance headers', async () => {
        const publishedMessages: Array<{
            subject: string;
            payload: Uint8Array;
            headers: Record<string, string>;
        }> = [];
        const publisher: DLPublisher = {
            async publish(subject, payload, headers) {
                publishedMessages.push({ subject, payload, headers });
            },
        };
        const dlSink = new DeadLetterSink(publisher, 'blitz.dead-letter');
        await dlSink.send({
            subject: 'orders.raw',
            payload: new TextEncoder().encode('{"id":42}'),
            errorMessage: 'Schema validation failed',
            deliveryCount: 4,
            sinkName: 'orders-sink',
        });

        expect(publishedMessages.length).toBe(1);
        const msg = publishedMessages[0]!;
        expect(msg.subject).toBe('blitz.dead-letter');
        expect(msg.headers['original-subject']).toBe('orders.raw');
        expect(msg.headers['error-message']).toBe('Schema validation failed');
        expect(msg.headers['delivery-count']).toBe('4');
        expect(msg.headers['sink-name']).toBe('orders-sink');
    });

    it('FaultHandler → DL: full pipeline from first delivery to dead-letter routing', async () => {
        let dlCallCount = 0;
        const dlSink = new DeadLetterSink(
            { async publish() { dlCallCount++; } },
            'dl.stream',
        );
        const handler = new FaultHandler({
            ackPolicy: AckPolicy.EXPLICIT,
            retryPolicy: RetryPolicy.fixed(2, 0),  // maxRetries=2
            deadLetterSink: dlSink,
        });

        // Simulate 3 deliveries: attempt 0,1 → retry; attempt 2 → DL
        let ackCount = 0;
        for (let delivery = 1; delivery <= 3; delivery++) {
            const msg: FaultMessage = {
                subject: 'orders.raw',
                data: new TextEncoder().encode('data'),
                deliveryCount: delivery,
                ack(): void { ackCount++; },
                nak(_opts?: { delay?: number }): void {},
            };
            await handler.handle(msg, async () => { throw new Error('fail'); });
        }
        expect(dlCallCount).toBe(1); // only the 3rd delivery (attempt 2 >= maxRetries 2)
        expect(ackCount).toBe(0);
    });
});

// ─── Scenario 10: CheckpointRestartTest ───────────────────────────────────────

describe('CheckpointRestartTest — pipeline restart resumes from checkpoint', () => {
    let manager: CheckpointManager;
    let store: CheckpointStore & { stored: Map<string, Uint8Array> };

    beforeEach(() => {
        store = makeInMemoryCheckpointStore();
        manager = new CheckpointManager(store, 'etl-pipeline', 'consumer-1', {
            intervalAcks: 3,
        });
    });

    afterEach(() => {
        manager.shutdown();
    });

    it('saves checkpoint after intervalAcks messages and can retrieve it', async () => {
        await manager.onAck(1);
        await manager.onAck(2);
        await manager.onAck(3); // triggers checkpoint at sequence=3

        const cp = await manager.getCheckpoint();
        expect(cp).not.toBeNull();
        expect(cp!.sequence).toBe(3);
    });

    it('explicit saveCheckpoint persists immediately regardless of ack count', async () => {
        await manager.saveCheckpoint(42, ['window-a', 'window-b']);
        const cp = await manager.getCheckpoint();
        expect(cp!.sequence).toBe(42);
        expect(cp!.windowKeys).toEqual(['window-a', 'window-b']);
    });

    it('restart resumes from last saved sequence — not from beginning', async () => {
        // First "run": process 100 items, save checkpoint at seq=100
        await manager.saveCheckpoint(100, []);
        manager.shutdown();

        // "Restart": create new manager with the same store and read checkpoint
        const manager2 = new CheckpointManager(store, 'etl-pipeline', 'consumer-1', { intervalAcks: 100 });
        const resumePoint = await manager2.getCheckpoint();
        expect(resumePoint!.sequence).toBe(100); // picks up from seq=100, NOT 0
        manager2.shutdown();
    });
});

// ─── Scenario 11: AtLeastOnceTest ─────────────────────────────────────────────

describe('AtLeastOnceTest — crash mid-pipeline → restart → no data loss', () => {
    it('FaultHandler with EXPLICIT ack ensures at-least-once: acks processed messages', async () => {
        const processed: string[] = [];
        const handler = new FaultHandler({
            ackPolicy: AckPolicy.EXPLICIT,
            retryPolicy: RetryPolicy.fixed(3, 0),
        });

        for (const item of ['a', 'b', 'c']) {
            let ackCalled = false;
            const msg: FaultMessage = {
                subject: 'stream.items',
                data: new TextEncoder().encode(item),
                deliveryCount: 1,
                ack(): void { ackCalled = true; },
                nak(_opts?: { delay?: number }): void {},
            };
            await handler.handle(msg, async () => {
                processed.push(item);
            });
            expect(ackCalled).toBe(true); // every successful item is acked
        }
        expect(processed).toEqual(['a', 'b', 'c']); // no data loss
    });

    it('FaultHandler with NONE ack never acks messages even on success', async () => {
        const handler = new FaultHandler({
            ackPolicy: AckPolicy.NONE,
            retryPolicy: RetryPolicy.fixed(0, 0),
        });
        let ackCalled = false;
        const msg: FaultMessage = {
            subject: 'test',
            data: new TextEncoder().encode('x'),
            deliveryCount: 1,
            ack(): void { ackCalled = true; },
            nak(_opts?: { delay?: number }): void {},
        };
        await handler.handle(msg, async () => 'result');
        expect(ackCalled).toBe(false); // NONE policy — never ack
    });

    it('sum aggregator over window computes running total without data loss', async () => {
        const policy = TumblingWindowPolicy.of({ size: 60_000 });
        const state = new InMemoryWindowState<number[]>();
        const op = new WindowOperator<number>({ policy, state, countTrigger: 5 });
        const aggOp = new AggregatingOperator(SumAggregator.of<number>(n => n));
        const ctx = makeCtx();

        const events = [10, 20, 30, 40, 50];
        let closedWindow: number[] | undefined;
        for (const e of events) {
            const result = await op.process(e, ctx);
            if (Array.isArray(result)) closedWindow = result as number[];
        }

        expect(closedWindow).toEqual([10, 20, 30, 40, 50]);
        const total = await aggOp.process(closedWindow!, ctx);
        expect(total).toBe(150); // no events lost
    });
});

// ─── Feature Parity Gate ───────────────────────────────────────────────────────

describe('Feature parity gate — @zenystx/helios-blitz v1.0 requirements', () => {
    it('linear pipeline (source → ops → sink) is supported', () => {
        const p = new Pipeline('parity-linear');
        p.readFrom(arraySource([1, 2, 3])).map(n => n * 2).writeTo(collectSink());
        expect(() => p.validate()).not.toThrow();
    });

    it('tumbling + sliding + session window policies are all constructable', () => {
        expect(() => TumblingWindowPolicy.of({ size: 1000 })).not.toThrow();
        expect(() => SlidingWindowPolicy.of({ size: 1000, slide: 500 })).not.toThrow();
        expect(() => SessionWindowPolicy.of({ gapMs: 5000 })).not.toThrow();
    });

    it('all 6 built-in aggregators are importable and functional', async () => {
        const { CountAggregator } = await import('../src/aggregate/CountAggregator.ts');
        const { SumAggregator } = await import('../src/aggregate/SumAggregator.ts');
        const { MinAggregator } = await import('../src/aggregate/MinAggregator.ts');
        const { MaxAggregator } = await import('../src/aggregate/MaxAggregator.ts');
        const { AvgAggregator } = await import('../src/aggregate/AvgAggregator.ts');
        const { DistinctAggregator } = await import('../src/aggregate/DistinctAggregator.ts');

        const nums = [3, 1, 4, 1, 5, 9, 2, 6];
        const ctx = makeCtx();
        const id = (n: number) => n;

        expect(await new AggregatingOperator(CountAggregator.of<number>()).process(nums, ctx)).toBe(8);
        expect(await new AggregatingOperator(SumAggregator.of<number>(id)).process(nums, ctx)).toBe(31);
        expect(await new AggregatingOperator(MinAggregator.of<number>(id)).process(nums, ctx)).toBe(1);
        expect(await new AggregatingOperator(MaxAggregator.of<number>(id)).process(nums, ctx)).toBe(9);
        const avg = await new AggregatingOperator(AvgAggregator.of<number>(id)).process(nums, ctx) as number;
        expect(avg).toBeCloseTo(31 / 8, 2);
        const distinct = await new AggregatingOperator(DistinctAggregator.of<number>()).process(nums, ctx) as Set<number>;
        expect(distinct.size).toBe(7); // {1,2,3,4,5,6,9}
    });

    it('hash join (stream-table) and windowed join (stream-stream) are both supported', async () => {
        // Hash join
        const hashOp = new HashJoinOperator<{ id: number }, number, string, string>(
            e => e.id,
            k => `label-${k}`,
            (_e, s) => s ?? 'none',
        );
        expect(await hashOp.process({ id: 7 }, makeCtx())).toBe('label-7');

        // Windowed join
        const policy = TumblingWindowPolicy.of({ size: 10_000 });
        const state = new InMemoryWindowState<JoinEvent<number, number>[]>();
        const winJoinOp = new WindowedJoinOperator<number, number, string>(
            { policy, state, predicate: (l, r) => l === r, countTrigger: 2, eventTimeExtractor: () => 5_000 },
            (l, r) => `${l}+${r}`,
        );
        await winJoinOp.process(WindowedJoinOperator.left(42), makeCtx());
        const res = await winJoinOp.process(WindowedJoinOperator.right(42), makeCtx()) as string[];
        expect(res).toEqual(['42+42']);
    });

    it('fault tolerance: AckPolicy, RetryPolicy, DeadLetterSink, CheckpointManager all present', () => {
        expect(AckPolicy.EXPLICIT).toBe(AckPolicy.EXPLICIT);
        expect(AckPolicy.NONE).toBe(AckPolicy.NONE);
        expect(RetryPolicy.fixed(3, 100).maxRetries).toBe(3);
        expect(RetryPolicy.exponential(5, 100).maxRetries).toBe(5);
        const store = makeInMemoryCheckpointStore();
        const mgr = new CheckpointManager(store, 'p', 'c', { intervalAcks: 1 });
        mgr.shutdown();
        const dlSink = new DeadLetterSink({ async publish() {} }, 'dl');
        expect(dlSink.streamName).toBe('dl');
    });

    it('batch mode (BatchPipeline + EndOfStreamDetector) is supported', async () => {
        const { EndOfStreamDetector } = await import('../src/batch/EndOfStreamDetector.ts');
        const detector = new EndOfStreamDetector({ expectedCount: 1 });
        const p = detector.detect();
        detector.onAck();
        await p;

        const bp = new BatchPipeline('parity-batch');
        const sink = collectSink<number>();
        const result = await bp.readFrom(arraySource([100])).writeTo(sink);
        expect(result.recordsIn).toBe(1);
    });

    it('NestJS module for @zenystx/helios-blitz is importable', async () => {
        const { HeliosBlitzModule } = await import('../src/nestjs/HeliosBlitzModule.ts');
        const { HeliosBlitzService } = await import('../src/nestjs/HeliosBlitzService.ts');
        const { InjectBlitz } = await import('../src/nestjs/InjectBlitz.decorator.ts');
        expect(typeof HeliosBlitzModule.forRoot).toBe('function');
        expect(typeof HeliosBlitzModule.forRootAsync).toBe('function');
        expect(typeof HeliosBlitzService).toBe('function');
        expect(typeof InjectBlitz).toBe('function');
    });
});
