import type { Aggregator, GroupedAggregator } from './Aggregator.js';

/**
 * Creates a grouped aggregator from a base aggregator and a key function.
 * The returned aggregator operates on `Map<K, A>` accumulators and emits
 * `Map<K, R>` results.
 *
 * **Single-worker guarantee:** Grouped aggregations produce correct per-key
 * results only when all events for a given key flow through the same consumer.
 * Use single-worker mode (default) or key-partitioned subjects (`withParallelism(N)`).
 * Do NOT use with plain NATS queue groups — they distribute round-robin with no
 * key-affinity, producing silently wrong per-key totals.
 */
export function createGroupedAggregator<T, K, A, R>(
    base: Aggregator<T, A, R>,
    keyFn: (item: T) => K,
): GroupedAggregator<T, K, A, R> {
    return {
        create(): Map<K, A> {
            return new Map<K, A>();
        },

        accumulate(acc: Map<K, A>, item: T): Map<K, A> {
            const key = keyFn(item);
            const current = acc.get(key) ?? base.create();
            const next = new Map(acc);
            next.set(key, base.accumulate(current, item));
            return next;
        },

        combine(a: Map<K, A>, b: Map<K, A>): Map<K, A> {
            const result = new Map(a);
            for (const [key, bAcc] of b) {
                const aAcc = result.get(key) ?? base.create();
                result.set(key, base.combine(aAcc, bAcc));
            }
            return result;
        },

        export(acc: Map<K, A>): Map<K, R> {
            const result = new Map<K, R>();
            for (const [key, innerAcc] of acc) {
                result.set(key, base.export(innerAcc));
            }
            return result;
        },
    };
}
