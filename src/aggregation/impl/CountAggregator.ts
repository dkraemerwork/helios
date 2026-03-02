import type { Aggregator } from '../Aggregator';
import { AbstractAggregator } from './AbstractAggregator';

/** Port of com.hazelcast.aggregation.impl.CountAggregator */
export class CountAggregator<I> extends AbstractAggregator<I, unknown, number> {
  private count = 0;

  constructor(attributePath?: string) {
    super(attributePath);
  }

  protected accumulateExtracted(_entry: I, _value: unknown): void {
    this.count++;
  }

  combine(aggregator: Aggregator<unknown, unknown>): void {
    this.count += (aggregator as CountAggregator<unknown>).count;
  }

  aggregate(): number {
    return this.count;
  }
}
