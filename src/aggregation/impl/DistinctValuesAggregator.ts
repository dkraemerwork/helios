import type { Aggregator } from '../Aggregator';
import { AbstractAggregator } from './AbstractAggregator';

/** Port of com.hazelcast.aggregation.impl.DistinctValuesAggregator */
export class DistinctValuesAggregator<I, R> extends AbstractAggregator<I, R, Set<R>> {
  private values: Set<R> = new Set();

  constructor(attributePath?: string) {
    super(attributePath);
  }

  protected accumulateExtracted(_entry: I, value: R): void {
    this.values.add(value);
  }

  combine(aggregator: Aggregator<unknown, unknown>): void {
    const other = aggregator as DistinctValuesAggregator<unknown, R>;
    for (const v of other.values) {
      this.values.add(v);
    }
  }

  aggregate(): Set<R> {
    return this.values;
  }
}
