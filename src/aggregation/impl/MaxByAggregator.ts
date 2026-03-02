import type { Aggregator } from '../Aggregator';
import { AbstractAggregator } from './AbstractAggregator';

type Comparable = number | string;

function compare(a: Comparable, b: Comparable): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Port of com.hazelcast.aggregation.impl.MaxByAggregator */
export class MaxByAggregator<I> extends AbstractAggregator<I, Comparable, I | null> {
  private maxValue: Comparable | null = null;
  private maxEntry: I | null = null;

  constructor(attributePath: string) {
    super(attributePath);
  }

  protected accumulateExtracted(entry: I, value: Comparable | null): void {
    if (this.isCurrentlyLessThan(value)) {
      this.maxValue = value;
      this.maxEntry = entry;
    }
  }

  private isCurrentlyLessThan(otherValue: Comparable | null | undefined): boolean {
    if (otherValue == null) return false;
    return this.maxValue == null || compare(this.maxValue, otherValue) < 0;
  }

  combine(aggregator: Aggregator<unknown, unknown>): void {
    const other = aggregator as MaxByAggregator<I>;
    if (this.isCurrentlyLessThan(other.maxValue)) {
      this.maxValue = other.maxValue;
      this.maxEntry = other.maxEntry;
    }
  }

  aggregate(): I | null {
    return this.maxEntry;
  }
}
