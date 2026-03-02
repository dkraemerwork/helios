import type { Predicate } from '../../Predicate';
import type { IndexRegistry } from '../IndexRegistry';
import type { Visitor } from './Visitor';
import type { VisitablePredicate } from './VisitablePredicate';
import type { NegatablePredicate } from './NegatablePredicate';
import { AbstractIndexAwarePredicate } from './AbstractIndexAwarePredicate';
import { Comparables } from '../Comparables';
import { isNull } from './PredicateUtils';
import { NotEqualPredicate } from './NotEqualPredicate';

/**
 * Predicate that tests attribute equality using Java's Comparable semantics
 * (NaN == NaN, -0 != 0).
 * Equivalent to Java's EqualPredicate.
 */
export class EqualPredicate<K = unknown, V = unknown>
  extends AbstractIndexAwarePredicate<K, V>
  implements VisitablePredicate<K, V>, NegatablePredicate<K, V> {

  value: unknown;

  constructor(attributeName?: string, value?: unknown) {
    super(attributeName);
    this.value = value;
  }

  protected override applyForSingleAttributeValue(attributeValue: unknown): boolean {
    if (attributeValue === null || attributeValue === undefined) {
      return isNull(this.value);
    }
    this.value = this.convert(attributeValue, this.value);
    const attr = this.convertEnumValue(attributeValue);
    return Comparables.equal(attr, this.value);
  }

  negate(): Predicate<K, V> {
    return new NotEqualPredicate<K, V>(this.attributeName, this.value);
  }

  accept(visitor: Visitor, indexes: IndexRegistry): Predicate<K, V> {
    return visitor.visitEqual(this, indexes) as Predicate<K, V>;
  }

  getClassId(): number {
    return 7; // PredicateDataSerializerHook.EQUAL_PREDICATE
  }

  toString(): string {
    return `${this.attributeName}=${String(this.value)}`;
  }
}
