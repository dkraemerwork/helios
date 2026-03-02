import type { Aggregator, GroupedAggregator } from './Aggregator.ts';
import { createGroupedAggregator } from './groupedAggregator.ts';

/**
 * Blitz MinAggregator — tracks the minimum of a numeric field.
 * `combine(a, b) = Math.min(a, b)` for parallel partial aggregation.
 */
export class MinAggregator<T> implements Aggregator<T, number, number> {
    private constructor(private readonly _extractor: (item: T) => number) {}

    create(): number {
        return Infinity;
    }

    accumulate(acc: number, item: T): number {
        return Math.min(acc, this._extractor(item));
    }

    combine(a: number, b: number): number {
        return Math.min(a, b);
    }

    export(acc: number): number {
        return acc;
    }

    static of<T>(extractor: (item: T) => number): MinAggregator<T> {
        return new MinAggregator<T>(extractor);
    }

    static byKey<T, K>(
        keyFn: (item: T) => K,
        extractor: (item: T) => number,
    ): GroupedAggregator<T, K, number, number> {
        return createGroupedAggregator(MinAggregator.of<T>(extractor), keyFn);
    }
}
