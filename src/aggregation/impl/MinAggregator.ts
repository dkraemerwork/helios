import type { Aggregator } from '../Aggregator';
import { AbstractAggregator } from './AbstractAggregator';

type Comparable = number | string;

function compare(a: Comparable, b: Comparable): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Port of com.hazelcast.aggregation.impl.MinAggregator */
export class MinAggregator<I, R extends Comparable> extends AbstractAggregator<I, R, R | null> {
  private min: R | null = null;

  constructor(attributePath?: string) {
    super(attributePath);
  }

  protected accumulateExtracted(_entry: I, value: R | null): void {
    if (this.isCurrentlyGreaterThan(value)) {
      this.min = value;
    }
  }

  private isCurrentlyGreaterThan(otherValue: R | null | undefined): boolean {
    if (otherValue == null) return false;
    return this.min == null || compare(this.min, otherValue) > 0;
  }

  combine(aggregator: Aggregator<unknown, unknown>): void {
    const other = aggregator as MinAggregator<unknown, R>;
    if (this.isCurrentlyGreaterThan(other.min)) {
      this.min = other.min;
    }
  }

  aggregate(): R | null {
    return this.min;
  }
}
