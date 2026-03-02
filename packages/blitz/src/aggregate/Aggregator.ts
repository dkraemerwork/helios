/**
 * Blitz `Aggregator<T, A, R>` — extends the core batch aggregator contract with
 * `combine(a, b)` for subject-partitioned parallel workers (withParallelism > 1).
 *
 * @template T  input item type
 * @template A  accumulator type
 * @template R  result type
 */
export interface Aggregator<T, A, R> {
    /** Create a new empty accumulator. */
    create(): A;

    /** Fold one item into the accumulator. Must be pure (no side effects). */
    accumulate(acc: A, item: T): A;

    /**
     * Combine two partial accumulators into one.
     * Required for subject-partitioned parallel workers (withParallelism > 1).
     * For single-worker pipelines this method is never called.
     */
    combine(a: A, b: A): A;

    /** Extract the final result from the accumulator. */
    export(acc: A): R;
}

/**
 * A grouped aggregator that operates on `Map<K, A>` accumulators and emits
 * `Map<K, R>` results. Created via `<ConcreteAggregator>.byKey(keyFn)`.
 */
export interface GroupedAggregator<T, K, A, R> extends Aggregator<T, Map<K, A>, Map<K, R>> {}
