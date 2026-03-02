import type { Aggregator, GroupedAggregator } from './Aggregator.ts';
import { createGroupedAggregator } from './groupedAggregator.ts';

/**
 * Blitz CountAggregator — counts items. Wraps the stateless count-by-one logic
 * and adds `combine(a, b) = a + b` for parallel partial aggregation.
 */
export class CountAggregator<T> implements Aggregator<T, number, number> {
    create(): number {
        return 0;
    }

    accumulate(acc: number, _item: T): number {
        return acc + 1;
    }

    combine(a: number, b: number): number {
        return a + b;
    }

    export(acc: number): number {
        return acc;
    }

    /** Factory method. */
    static of<T>(): CountAggregator<T> {
        return new CountAggregator<T>();
    }

    /**
     * Returns a grouped variant that accumulates into `Map<K, number>` and emits
     * `Map<K, number>`. Grouped aggregations MUST run as a single consumer or with
     * key-partitioned subjects — NOT with plain NATS queue groups.
     */
    static byKey<T, K>(keyFn: (item: T) => K): GroupedAggregator<T, K, number, number> {
        return createGroupedAggregator(CountAggregator.of<T>(), keyFn);
    }
}
