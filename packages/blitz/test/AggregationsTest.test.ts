/**
 * Block 10.5 — Stateful aggregations tests
 *
 * Tests: Aggregator<T,A,R> interface, 6 concrete aggregators (count/sum/min/max/avg/distinct),
 * AggregatingOperator, grouped aggregation (byKey), running aggregation without windowing,
 * and parallelism sharding determinism.
 */
import { describe, expect, it } from 'bun:test';
import { AggregatingOperator, RunningAggregateOperator } from '../src/aggregate/AggregatingOperator.ts';
import { AvgAggregator } from '../src/aggregate/AvgAggregator.ts';
import { CountAggregator } from '../src/aggregate/CountAggregator.ts';
import { DistinctAggregator } from '../src/aggregate/DistinctAggregator.ts';
import { hashKey } from '../src/aggregate/hashKey.ts';
import { MaxAggregator } from '../src/aggregate/MaxAggregator.ts';
import { MinAggregator } from '../src/aggregate/MinAggregator.ts';
import { SumAggregator } from '../src/aggregate/SumAggregator.ts';
import type { StageContext } from '../src/StageContext.ts';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCtx(): StageContext {
    return { messageId: 'msg-1', deliveryCount: 1, nak: () => {} };
}

// ─── CountAggregator ──────────────────────────────────────────────────────────

describe('CountAggregator', () => {
    it('create() returns 0', () => {
        const agg = CountAggregator.of<string>();
        expect(agg.create()).toBe(0);
    });

    it('accumulate() increments count by 1 per item', () => {
        const agg = CountAggregator.of<string>();
        let acc = agg.create();
        acc = agg.accumulate(acc, 'a');
        acc = agg.accumulate(acc, 'b');
        acc = agg.accumulate(acc, 'c');
        expect(acc).toBe(3);
    });

    it('export() returns accumulated count unchanged', () => {
        const agg = CountAggregator.of<number>();
        let acc = agg.create();
        acc = agg.accumulate(acc, 42);
        expect(agg.export(acc)).toBe(1);
    });

    it('combine() adds two partial counts', () => {
        const agg = CountAggregator.of<string>();
        const a = agg.accumulate(agg.create(), 'x');
        const b = agg.accumulate(agg.accumulate(agg.create(), 'y'), 'z');
        expect(agg.combine(a, b)).toBe(3);
    });
});

// ─── SumAggregator ────────────────────────────────────────────────────────────

describe('SumAggregator', () => {
    it('create() returns 0', () => {
        const agg = SumAggregator.of<number>(x => x);
        expect(agg.create()).toBe(0);
    });

    it('accumulate() adds extracted numeric value', () => {
        type Order = { amount: number };
        const agg = SumAggregator.of<Order>(o => o.amount);
        let acc = agg.create();
        acc = agg.accumulate(acc, { amount: 10 });
        acc = agg.accumulate(acc, { amount: 25 });
        expect(agg.export(acc)).toBe(35);
    });

    it('export() returns total sum', () => {
        const agg = SumAggregator.of<number>(x => x);
        let acc = agg.create();
        for (const n of [1, 2, 3, 4, 5]) acc = agg.accumulate(acc, n);
        expect(agg.export(acc)).toBe(15);
    });

    it('combine() adds partial sums', () => {
        const agg = SumAggregator.of<number>(x => x);
        const a = agg.accumulate(agg.accumulate(agg.create(), 10), 20);
        const b = agg.accumulate(agg.create(), 5);
        expect(agg.combine(a, b)).toBe(35);
    });
});

// ─── MinAggregator ────────────────────────────────────────────────────────────

describe('MinAggregator', () => {
    it('create() returns Infinity', () => {
        const agg = MinAggregator.of<number>(x => x);
        expect(agg.create()).toBe(Infinity);
    });

    it('accumulate() tracks minimum value', () => {
        const agg = MinAggregator.of<number>(x => x);
        let acc = agg.create();
        acc = agg.accumulate(acc, 5);
        acc = agg.accumulate(acc, 2);
        acc = agg.accumulate(acc, 9);
        expect(agg.export(acc)).toBe(2);
    });

    it('combine() returns minimum of two partial minimums', () => {
        const agg = MinAggregator.of<number>(x => x);
        const a = agg.accumulate(agg.create(), 7);  // min=7
        const b = agg.accumulate(agg.create(), 3);  // min=3
        expect(agg.combine(a, b)).toBe(3);
    });
});

// ─── MaxAggregator ────────────────────────────────────────────────────────────

describe('MaxAggregator', () => {
    it('create() returns -Infinity', () => {
        const agg = MaxAggregator.of<number>(x => x);
        expect(agg.create()).toBe(-Infinity);
    });

    it('accumulate() tracks maximum value', () => {
        const agg = MaxAggregator.of<number>(x => x);
        let acc = agg.create();
        acc = agg.accumulate(acc, 3);
        acc = agg.accumulate(acc, 9);
        acc = agg.accumulate(acc, 1);
        expect(agg.export(acc)).toBe(9);
    });

    it('combine() returns maximum of two partial maximums', () => {
        const agg = MaxAggregator.of<number>(x => x);
        const a = agg.accumulate(agg.create(), 7);  // max=7
        const b = agg.accumulate(agg.create(), 12); // max=12
        expect(agg.combine(a, b)).toBe(12);
    });
});

// ─── AvgAggregator ────────────────────────────────────────────────────────────

describe('AvgAggregator', () => {
    it('create() returns { sum: 0, count: 0 }', () => {
        const agg = AvgAggregator.of<number>(x => x);
        expect(agg.create()).toEqual({ sum: 0, count: 0 });
    });

    it('accumulate() adds to sum and count', () => {
        const agg = AvgAggregator.of<number>(x => x);
        let acc = agg.create();
        acc = agg.accumulate(acc, 10);
        acc = agg.accumulate(acc, 20);
        expect(acc).toEqual({ sum: 30, count: 2 });
    });

    it('export() computes average (sum / count)', () => {
        const agg = AvgAggregator.of<number>(x => x);
        let acc = agg.create();
        acc = agg.accumulate(acc, 10);
        acc = agg.accumulate(acc, 20);
        acc = agg.accumulate(acc, 30);
        expect(agg.export(acc)).toBe(20);
    });

    it('combine() merges partial { sum, count } accumulators', () => {
        const agg = AvgAggregator.of<number>(x => x);
        // Worker A: [10, 20] → {sum:30, count:2}
        let accA = agg.create();
        accA = agg.accumulate(accA, 10);
        accA = agg.accumulate(accA, 20);
        // Worker B: [30] → {sum:30, count:1}
        let accB = agg.create();
        accB = agg.accumulate(accB, 30);
        const merged = agg.combine(accA, accB);
        expect(merged).toEqual({ sum: 60, count: 3 });
        expect(agg.export(merged)).toBe(20);
    });
});

// ─── DistinctAggregator ───────────────────────────────────────────────────────

describe('DistinctAggregator', () => {
    it('create() returns empty Set', () => {
        const agg = DistinctAggregator.of<string>();
        expect(agg.create().size).toBe(0);
    });

    it('accumulate() adds items to Set', () => {
        const agg = DistinctAggregator.of<string>();
        let acc = agg.create();
        acc = agg.accumulate(acc, 'a');
        acc = agg.accumulate(acc, 'b');
        expect(acc.size).toBe(2);
    });

    it('duplicate values are not counted twice', () => {
        const agg = DistinctAggregator.of<string>();
        let acc = agg.create();
        acc = agg.accumulate(acc, 'x');
        acc = agg.accumulate(acc, 'x');
        acc = agg.accumulate(acc, 'y');
        expect(agg.export(acc).size).toBe(2);
    });

    it('combine() unions two partial Sets', () => {
        const agg = DistinctAggregator.of<number>();
        const a = agg.accumulate(agg.accumulate(agg.create(), 1), 2);
        const b = agg.accumulate(agg.accumulate(agg.create(), 2), 3);
        const merged = agg.combine(a, b);
        expect(merged.size).toBe(3);
        expect([...merged].sort()).toEqual([1, 2, 3]);
    });
});

// ─── AggregatingOperator ──────────────────────────────────────────────────────

describe('AggregatingOperator', () => {
    it('applies CountAggregator to window events', async () => {
        const op = new AggregatingOperator(CountAggregator.of<string>());
        const result = await op.process(['a', 'b', 'c'], makeCtx());
        expect(result).toBe(3);
    });

    it('applies SumAggregator to window events', async () => {
        const op = new AggregatingOperator(SumAggregator.of<number>(x => x));
        const result = await op.process([10, 20, 30], makeCtx());
        expect(result).toBe(60);
    });

    it('handles empty window (zero/identity result)', async () => {
        const op = new AggregatingOperator(CountAggregator.of<string>());
        const result = await op.process([], makeCtx());
        expect(result).toBe(0);
    });

    it('applies DistinctAggregator to window events', async () => {
        const op = new AggregatingOperator(DistinctAggregator.of<string>());
        const result = await op.process(['a', 'b', 'a', 'c'], makeCtx());
        expect(result).toBeInstanceOf(Set);
        expect((result as Set<string>).size).toBe(3);
    });
});

// ─── Grouped aggregation — byKey ──────────────────────────────────────────────

describe('Grouped aggregation — byKey', () => {
    it('CountAggregator.byKey groups events by key function', async () => {
        type Event = { region: string };
        const grouped = CountAggregator.byKey<Event, string>(e => e.region);
        const op = new AggregatingOperator(grouped);
        const events: Event[] = [
            { region: 'US' }, { region: 'EU' }, { region: 'US' }, { region: 'EU' }, { region: 'US' },
        ];
        const result = await op.process(events, makeCtx());
        expect(result).toBeInstanceOf(Map);
        expect((result as Map<string, number>).get('US')).toBe(3);
        expect((result as Map<string, number>).get('EU')).toBe(2);
    });

    it('SumAggregator.byKey groups sums by key', async () => {
        type Sale = { region: string; amount: number };
        const grouped = SumAggregator.byKey<Sale, string>(
            s => s.region,
            s => s.amount,
        );
        const op = new AggregatingOperator(grouped);
        const events: Sale[] = [
            { region: 'US', amount: 100 },
            { region: 'EU', amount: 200 },
            { region: 'US', amount: 50 },
        ];
        const result = await op.process(events, makeCtx());
        expect((result as Map<string, number>).get('US')).toBe(150);
        expect((result as Map<string, number>).get('EU')).toBe(200);
    });

    it('single-worker byKey produces exact per-key counts (correctness guarantee)', async () => {
        type Msg = { category: string; value: number };
        const grouped = CountAggregator.byKey<Msg, string>(m => m.category);
        const op = new AggregatingOperator(grouped);
        const events: Msg[] = Array.from({ length: 9 }, (_, i) => ({
            category: ['A', 'B', 'C'][i % 3]!,
            value: i,
        }));
        const result = await op.process(events, makeCtx()) as Map<string, number>;
        expect(result.get('A')).toBe(3);
        expect(result.get('B')).toBe(3);
        expect(result.get('C')).toBe(3);
    });

    it('AvgAggregator.byKey computes per-key averages', async () => {
        type Score = { team: string; score: number };
        const grouped = AvgAggregator.byKey<Score, string>(
            s => s.team,
            s => s.score,
        );
        const op = new AggregatingOperator(grouped);
        const events: Score[] = [
            { team: 'A', score: 10 },
            { team: 'B', score: 20 },
            { team: 'A', score: 30 },
        ];
        const result = await op.process(events, makeCtx()) as Map<string, number>;
        expect(result.get('A')).toBe(20);
        expect(result.get('B')).toBe(20);
    });
});

// ─── Running aggregation without windowing ────────────────────────────────────

describe('RunningAggregateOperator — whole-stream running total', () => {
    it('emits updated sum after each event (running total)', async () => {
        const op = new RunningAggregateOperator(SumAggregator.of<number>(x => x));
        expect(await op.process(10, makeCtx())).toBe(10);
        expect(await op.process(20, makeCtx())).toBe(30);
        expect(await op.process(5, makeCtx())).toBe(35);
    });

    it('running count increments on each event', async () => {
        const op = new RunningAggregateOperator(CountAggregator.of<string>());
        expect(await op.process('a', makeCtx())).toBe(1);
        expect(await op.process('b', makeCtx())).toBe(2);
        expect(await op.process('c', makeCtx())).toBe(3);
    });
});

// ─── Parallelism sharding — hashKey determinism ───────────────────────────────

describe('Parallelism sharding — hashKey', () => {
    it('same key always hashes to the same shard (deterministic)', () => {
        const N = 4;
        const key = 'customer-99';
        const shard1 = Math.abs(hashKey(key)) % N;
        const shard2 = Math.abs(hashKey(key)) % N;
        const shard3 = Math.abs(hashKey(key)) % N;
        expect(shard1).toBe(shard2);
        expect(shard2).toBe(shard3);
    });

    it('shards are in range [0, N-1] for all keys', () => {
        const N = 8;
        const keys = ['us-east', 'eu-west', 'ap-south', 'us-west', 'sa-east'];
        for (const key of keys) {
            const shard = Math.abs(hashKey(key)) % N;
            expect(shard).toBeGreaterThanOrEqual(0);
            expect(shard).toBeLessThan(N);
        }
    });
});
