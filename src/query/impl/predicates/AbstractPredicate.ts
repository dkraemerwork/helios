import type { Predicate } from '../../Predicate';
import { canonicalizeAttribute } from '../IndexUtils';
import type { QueryableEntry } from '../QueryableEntry';
import { isNull } from './PredicateUtils';

/**
 * Abstract base for predicates that filter entries by a named attribute.
 * Handles attribute value extraction and basic type conversion.
 * Equivalent to Java's AbstractPredicate<K, V>.
 */
export abstract class AbstractPredicate<K = unknown, V = unknown>
  implements Predicate<K, V> {

  attributeName: string;

  protected constructor(attributeName?: string) {
    this.attributeName = attributeName ? canonicalizeAttribute(attributeName) : '';
  }

  apply(entry: QueryableEntry<K, V>): boolean {
    const attributeValue = entry.getAttributeValue(this.attributeName);
    return this.applyForSingleAttributeValue(
      attributeValue === undefined ? null : attributeValue
    );
  }

  protected abstract applyForSingleAttributeValue(attributeValue: unknown): boolean;

  /**
   * Converts givenAttributeValue to match the type of entryAttributeValue.
   * In TypeScript/Bun, numeric types are unified; string conversion is done
   * only when needed.
   */
  protected convert(entryAttributeValue: unknown, givenAttributeValue: unknown): unknown {
    if (isNull(givenAttributeValue)) return givenAttributeValue;
    if (entryAttributeValue === null || entryAttributeValue === undefined) {
      return givenAttributeValue;
    }
    // Same type → no conversion needed
    if (typeof entryAttributeValue === typeof givenAttributeValue) {
      return givenAttributeValue;
    }
    // Number coercion: entry is number, given is string
    if (typeof entryAttributeValue === 'number' && typeof givenAttributeValue === 'string') {
      const n = Number(givenAttributeValue);
      return isNaN(n) ? givenAttributeValue : n;
    }
    return givenAttributeValue;
  }

  protected convertEnumValue(attributeValue: unknown): unknown {
    // In TypeScript, enum values are plain strings/numbers — no conversion needed
    return attributeValue;
  }
}
