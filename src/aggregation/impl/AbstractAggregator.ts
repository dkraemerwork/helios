import type { Aggregator } from '../Aggregator';

/** Interface for map entry (key-value pair) */
export interface MapEntry<K, V> {
  getKey(): K;
  getValue(): V;
}

/** Interface for objects that support attribute-path extraction */
export interface Extractable {
  getAttributeValue(path: string): unknown;
}

function isMapEntry(v: unknown): v is MapEntry<unknown, unknown> {
  return v != null && typeof v === 'object' && typeof (v as MapEntry<unknown, unknown>).getValue === 'function';
}

function isExtractable(v: unknown): v is Extractable {
  return v != null && typeof v === 'object' && typeof (v as Extractable).getAttributeValue === 'function';
}

/**
 * Port of com.hazelcast.aggregation.impl.AbstractAggregator.
 * Abstract base providing extraction for use in accumulation phase.
 *
 * Extraction rules:
 * - If attributePath is null and input is MapEntry → accumulates entry.getValue()
 * - If attributePath is set and input is Extractable → accumulates getAttributeValue(attributePath)
 */
export abstract class AbstractAggregator<I, E, R> implements Aggregator<I, R> {
  protected attributePath: string | null;

  constructor(attributePath?: string) {
    this.attributePath = attributePath ?? null;
  }

  accumulate(entry: I): void {
    const extracted = this.extract(entry);
    this.accumulateExtracted(entry, extracted as E);
  }

  onAccumulationFinished(): void {}
  onCombinationFinished(): void {}

  private extract(input: I): unknown {
    if (this.attributePath == null) {
      if (isMapEntry(input)) {
        return input.getValue();
      }
    } else if (isExtractable(input)) {
      return input.getAttributeValue(this.attributePath);
    }
    throw new Error(`Can't extract '${this.attributePath}' from the given input`);
  }

  protected abstract accumulateExtracted(entry: I, value: E): void;
  abstract combine(aggregator: Aggregator<unknown, unknown>): void;
  abstract aggregate(): R;
}
