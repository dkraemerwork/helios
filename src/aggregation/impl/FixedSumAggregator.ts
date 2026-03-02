import type { Aggregator } from '../Aggregator';
import { AbstractAggregator } from './AbstractAggregator';

/**
 * Port of com.hazelcast.aggregation.impl.FixedSumAggregator.
 * Accepts generic Number values and converts to Long (integer) via Math.trunc.
 */
export class FixedSumAggregator<I> extends AbstractAggregator<I, number, number> {
  private sum = 0;

  constructor(attributePath?: string) {
    super(attributePath);
  }

  protected accumulateExtracted(_entry: I, value: number): void {
    if (value == null) throw new TypeError('FixedSumAggregator does not accept null values');
    this.sum += Math.trunc(value);
  }

  combine(aggregator: Aggregator<unknown, unknown>): void {
    this.sum += (aggregator as FixedSumAggregator<unknown>).sum;
  }

  aggregate(): number {
    return this.sum;
  }
}
