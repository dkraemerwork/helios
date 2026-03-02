import type { Predicate } from '../../Predicate';
import type { IndexRegistry } from '../IndexRegistry';
import type { Visitor } from './Visitor';
import type { VisitablePredicate } from './VisitablePredicate';
import type { NegatablePredicate } from './NegatablePredicate';
import { AbstractIndexAwarePredicate } from './AbstractIndexAwarePredicate';
import { Comparables } from '../Comparables';
import { isNull } from './PredicateUtils';
import { EqualPredicate } from './EqualPredicate';

/**
 * Predicate that tests attribute inequality.
 * Equivalent to Java's NotEqualPredicate.
 */
export class NotEqualPredicate<K = unknown, V = unknown>
  extends AbstractIndexAwarePredicate<K, V>
  implements VisitablePredicate<K, V>, NegatablePredicate<K, V> {

  value: unknown;

  constructor(attributeName?: string, value?: unknown) {
    super(attributeName);
    this.value = value;
  }

  protected override applyForSingleAttributeValue(attributeValue: unknown): boolean {
    if (attributeValue === null || attributeValue === undefined) {
      // null != null → false (both are null)
      return !isNull(this.value);
    }
    if (isNull(this.value)) {
      return true; // non-null != null → true
    }
    this.value = this.convert(attributeValue, this.value);
    const attr = this.convertEnumValue(attributeValue);
    return !Comparables.equal(attr, this.value);
  }

  negate(): Predicate<K, V> {
    return new EqualPredicate<K, V>(this.attributeName, this.value);
  }

  accept(visitor: Visitor, indexes: IndexRegistry): Predicate<K, V> {
    return visitor.visitNotEqual(this, indexes) as Predicate<K, V>;
  }

  getClassId(): number {
    return 9; // PredicateDataSerializerHook.NOTEQUAL_PREDICATE
  }

  toString(): string {
    return `${this.attributeName} != ${String(this.value)}`;
  }
}
