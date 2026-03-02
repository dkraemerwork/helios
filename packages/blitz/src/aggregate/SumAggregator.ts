import type { Aggregator, GroupedAggregator } from './Aggregator.ts';
import { createGroupedAggregator } from './groupedAggregator.ts';

/**
 * Blitz SumAggregator — sums a numeric field extracted via `extractor`.
 * `combine(a, b) = a + b` for parallel partial aggregation.
 */
export class SumAggregator<T> implements Aggregator<T, number, number> {
    private constructor(private readonly _extractor: (item: T) => number) {}

    create(): number {
        return 0;
    }

    accumulate(acc: number, item: T): number {
        return acc + this._extractor(item);
    }

    combine(a: number, b: number): number {
        return a + b;
    }

    export(acc: number): number {
        return acc;
    }

    /** Factory method — provide a field extractor. */
    static of<T>(extractor: (item: T) => number): SumAggregator<T> {
        return new SumAggregator<T>(extractor);
    }

    /**
     * Returns a grouped variant that accumulates into `Map<K, number>` and emits
     * `Map<K, number>`.
     */
    static byKey<T, K>(
        keyFn: (item: T) => K,
        extractor: (item: T) => number,
    ): GroupedAggregator<T, K, number, number> {
        return createGroupedAggregator(SumAggregator.of<T>(extractor), keyFn);
    }
}
