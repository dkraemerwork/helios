import type { Aggregator } from '../Aggregator';
import { AbstractAggregator } from './AbstractAggregator';

/** Port of com.hazelcast.aggregation.impl.IntegerSumAggregator */
export class IntegerSumAggregator<I> extends AbstractAggregator<I, number, number> {
  private sum = 0;

  constructor(attributePath?: string) {
    super(attributePath);
  }

  protected accumulateExtracted(_entry: I, value: number): void {
    if (value == null) throw new TypeError('IntegerSumAggregator does not accept null values');
    this.sum += value;
  }

  combine(aggregator: Aggregator<unknown, unknown>): void {
    this.sum += (aggregator as IntegerSumAggregator<unknown>).sum;
  }

  aggregate(): number {
    return this.sum;
  }
}
