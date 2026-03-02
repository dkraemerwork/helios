import type { Aggregator } from '../Aggregator';
import { AbstractAggregator } from './AbstractAggregator';

/** Port of com.hazelcast.aggregation.impl.LongSumAggregator */
export class LongSumAggregator<I> extends AbstractAggregator<I, number, number> {
  private sum = 0;

  constructor(attributePath?: string) {
    super(attributePath);
  }

  protected accumulateExtracted(_entry: I, value: number): void {
    if (value == null) throw new TypeError('LongSumAggregator does not accept null values');
    this.sum += value;
  }

  combine(aggregator: Aggregator<unknown, unknown>): void {
    this.sum += (aggregator as LongSumAggregator<unknown>).sum;
  }

  aggregate(): number {
    return this.sum;
  }
}
