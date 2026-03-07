import type { Predicate } from '../../Predicate';
import { Comparables } from '../Comparables';
import type { IndexRegistry } from '../IndexRegistry';
import { AbstractIndexAwarePredicate } from './AbstractIndexAwarePredicate';
import type { NegatablePredicate } from './NegatablePredicate';
import { NotEqualPredicate } from './NotEqualPredicate';
import { isNull } from './PredicateUtils';
import type { VisitablePredicate } from './VisitablePredicate';
import type { Visitor } from './Visitor';

/**
 * Predicate that tests attribute equality using Java's Comparable semantics
 * (NaN == NaN, -0 != 0).
 * Equivalent to Java's EqualPredicate.
 */
export class EqualPredicate<K = unknown, V = unknown>
  extends AbstractIndexAwarePredicate<K, V>
  implements VisitablePredicate<K, V>, NegatablePredicate<K, V> {

  value: unknown;

  private _convertedValue: unknown = undefined;
  private _converted = false;

  constructor(attributeName?: string, value?: unknown) {
    super(attributeName);
    this.value = value;
  }

  protected override applyForSingleAttributeValue(attributeValue: unknown): boolean {
    if (attributeValue === null || attributeValue === undefined) {
      return isNull(this.value);
    }
    if (!this._converted) {
      this._convertedValue = this.convert(attributeValue, this.value);
      this._converted = true;
    }
    const attr = this.convertEnumValue(attributeValue);
    return Comparables.equal(attr, this._convertedValue);
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
