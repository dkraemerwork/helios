import type { Aggregator } from '../Aggregator';
import { AbstractAggregator } from './AbstractAggregator';

type Comparable = number | string;

function compare(a: Comparable, b: Comparable): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Port of com.hazelcast.aggregation.impl.MaxAggregator */
export class MaxAggregator<I, R extends Comparable> extends AbstractAggregator<I, R, R | null> {
  private max: R | null = null;

  constructor(attributePath?: string) {
    super(attributePath);
  }

  protected accumulateExtracted(_entry: I, value: R | null): void {
    if (this.isCurrentlyLessThan(value)) {
      this.max = value;
    }
  }

  private isCurrentlyLessThan(otherValue: R | null | undefined): boolean {
    if (otherValue == null) return false;
    return this.max == null || compare(this.max, otherValue) < 0;
  }

  combine(aggregator: Aggregator<unknown, unknown>): void {
    const other = aggregator as MaxAggregator<unknown, R>;
    if (this.isCurrentlyLessThan(other.max)) {
      this.max = other.max;
    }
  }

  aggregate(): R | null {
    return this.max;
  }
}
