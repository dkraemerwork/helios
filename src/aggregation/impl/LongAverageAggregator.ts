import type { Aggregator } from '../Aggregator';
import { AbstractAggregator } from './AbstractAggregator';

/** Port of com.hazelcast.aggregation.impl.LongAverageAggregator */
export class LongAverageAggregator<I> extends AbstractAggregator<I, number, number | null> {
  private sum = 0;
  private count = 0;

  constructor(attributePath?: string) {
    super(attributePath);
  }

  protected accumulateExtracted(_entry: I, value: number): void {
    if (value == null) throw new TypeError('LongAverageAggregator does not accept null values');
    this.sum += value;
    this.count++;
  }

  combine(aggregator: Aggregator<unknown, unknown>): void {
    const other = aggregator as LongAverageAggregator<unknown>;
    this.sum += other.sum;
    this.count += other.count;
  }

  aggregate(): number | null {
    if (this.count === 0) return null;
    return this.sum / this.count;
  }
}
