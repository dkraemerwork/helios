import type { Aggregator, GroupedAggregator } from './Aggregator.js';
import { createGroupedAggregator } from './groupedAggregator.js';

/** Accumulator for AvgAggregator. */
export interface AvgAcc {
    sum: number;
    count: number;
}

/**
 * Blitz AvgAggregator — computes the running average of a numeric field.
 * Accumulator is `{ sum, count }` so `combine()` can merge partial results.
 */
export class AvgAggregator<T> implements Aggregator<T, AvgAcc, number> {
    private constructor(private readonly _extractor: (item: T) => number) {}

    create(): AvgAcc {
        return { sum: 0, count: 0 };
    }

    accumulate(acc: AvgAcc, item: T): AvgAcc {
        return { sum: acc.sum + this._extractor(item), count: acc.count + 1 };
    }

    combine(a: AvgAcc, b: AvgAcc): AvgAcc {
        return { sum: a.sum + b.sum, count: a.count + b.count };
    }

    export(acc: AvgAcc): number {
        if (acc.count === 0) return 0;
        return acc.sum / acc.count;
    }

    static of<T>(extractor: (item: T) => number): AvgAggregator<T> {
        return new AvgAggregator<T>(extractor);
    }

    static byKey<T, K>(
        keyFn: (item: T) => K,
        extractor: (item: T) => number,
    ): GroupedAggregator<T, K, AvgAcc, number> {
        return createGroupedAggregator(AvgAggregator.of<T>(extractor), keyFn);
    }
}
