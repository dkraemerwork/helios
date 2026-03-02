import type { Predicate } from '../../Predicate';
import type { IndexRegistry } from '../IndexRegistry';
import type { Visitor } from './Visitor';
import type { VisitablePredicate } from './VisitablePredicate';
import { AbstractIndexAwarePredicate } from './AbstractIndexAwarePredicate';
import { Comparables } from '../Comparables';

/**
 * Predicate testing attribute value is between two bounds (inclusive on both ends).
 * Equivalent to Java's BetweenPredicate.
 */
export class BetweenPredicate<K = unknown, V = unknown>
  extends AbstractIndexAwarePredicate<K, V>
  implements VisitablePredicate<K, V> {

  from: unknown;
  to: unknown;

  constructor(attributeName?: string, from?: unknown, to?: unknown) {
    super(attributeName);
    if (attributeName !== undefined && (from === null || to === null)) {
      throw new Error("Arguments can't be null");
    }
    this.from = from;
    this.to = to;
  }

  protected override applyForSingleAttributeValue(attributeValue: unknown): boolean {
    if (attributeValue === null || attributeValue === undefined) {
      return false;
    }
    const fromConverted = this.convert(attributeValue, this.from);
    const toConverted = this.convert(attributeValue, this.to);
    if (fromConverted === null || fromConverted === undefined) return false;
    if (toConverted === null || toConverted === undefined) return false;
    const attr = this.convertEnumValue(attributeValue);
    return Comparables.compare(attr, fromConverted) >= 0 &&
           Comparables.compare(attr, toConverted) <= 0;
  }

  accept(visitor: Visitor, indexes: IndexRegistry): Predicate<K, V> {
    return visitor.visitBetween(this, indexes) as Predicate<K, V>;
  }

  toString(): string {
    return `${this.attributeName} BETWEEN ${String(this.from)} AND ${String(this.to)}`;
  }
}
