import type { Aggregator, GroupedAggregator } from './Aggregator.ts';
import { createGroupedAggregator } from './groupedAggregator.ts';

/**
 * Blitz MaxAggregator — tracks the maximum of a numeric field.
 * `combine(a, b) = Math.max(a, b)` for parallel partial aggregation.
 */
export class MaxAggregator<T> implements Aggregator<T, number, number> {
    private constructor(private readonly _extractor: (item: T) => number) {}

    create(): number {
        return -Infinity;
    }

    accumulate(acc: number, item: T): number {
        return Math.max(acc, this._extractor(item));
    }

    combine(a: number, b: number): number {
        return Math.max(a, b);
    }

    export(acc: number): number {
        return acc;
    }

    static of<T>(extractor: (item: T) => number): MaxAggregator<T> {
        return new MaxAggregator<T>(extractor);
    }

    static byKey<T, K>(
        keyFn: (item: T) => K,
        extractor: (item: T) => number,
    ): GroupedAggregator<T, K, number, number> {
        return createGroupedAggregator(MaxAggregator.of<T>(extractor), keyFn);
    }
}
