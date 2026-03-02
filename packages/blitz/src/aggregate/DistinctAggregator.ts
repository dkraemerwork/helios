import type { Aggregator, GroupedAggregator } from './Aggregator.ts';
import { createGroupedAggregator } from './groupedAggregator.ts';

/**
 * Blitz DistinctAggregator — collects distinct values in a `Set<T>`.
 * `combine(a, b) = new Set([...a, ...b])` for parallel partial aggregation.
 */
export class DistinctAggregator<T> implements Aggregator<T, Set<T>, Set<T>> {
    create(): Set<T> {
        return new Set<T>();
    }

    accumulate(acc: Set<T>, item: T): Set<T> {
        const next = new Set(acc);
        next.add(item);
        return next;
    }

    combine(a: Set<T>, b: Set<T>): Set<T> {
        return new Set([...a, ...b]);
    }

    export(acc: Set<T>): Set<T> {
        return acc;
    }

    static of<T>(): DistinctAggregator<T> {
        return new DistinctAggregator<T>();
    }

    static byKey<T, K>(keyFn: (item: T) => K): GroupedAggregator<T, K, Set<T>, Set<T>> {
        return createGroupedAggregator(DistinctAggregator.of<T>(), keyFn);
    }
}
