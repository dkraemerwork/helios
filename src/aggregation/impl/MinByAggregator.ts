import type { Aggregator } from '../Aggregator';
import { AbstractAggregator } from './AbstractAggregator';

type Comparable = number | string;

function compare(a: Comparable, b: Comparable): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Port of com.hazelcast.aggregation.impl.MinByAggregator */
export class MinByAggregator<I> extends AbstractAggregator<I, Comparable, I | null> {
  private minValue: Comparable | null = null;
  private minEntry: I | null = null;

  constructor(attributePath: string) {
    super(attributePath);
  }

  protected accumulateExtracted(entry: I, value: Comparable | null): void {
    if (this.isCurrentlyGreaterThan(value)) {
      this.minValue = value;
      this.minEntry = entry;
    }
  }

  private isCurrentlyGreaterThan(otherValue: Comparable | null | undefined): boolean {
    if (otherValue == null) return false;
    return this.minValue == null || compare(this.minValue, otherValue) > 0;
  }

  combine(aggregator: Aggregator<unknown, unknown>): void {
    const other = aggregator as MinByAggregator<I>;
    if (this.isCurrentlyGreaterThan(other.minValue)) {
      this.minValue = other.minValue;
      this.minEntry = other.minEntry;
    }
  }

  aggregate(): I | null {
    return this.minEntry;
  }
}
