/**
 * Port of com.hazelcast.aggregation.Aggregator.
 * Defines a contract for all aggregators. Exposes API for parallel two-phase aggregations:
 * - accumulation of input entries by multiple instances of aggregators
 * - combining all aggregators into one to calculate the final result
 *
 * @param I input type
 * @param R result type
 * @since 3.8
 */
export interface Aggregator<I, R> {
  accumulate(input: I): void;
  onAccumulationFinished(): void;
  combine(aggregator: Aggregator<unknown, unknown>): void;
  onCombinationFinished(): void;
  aggregate(): R;
}
