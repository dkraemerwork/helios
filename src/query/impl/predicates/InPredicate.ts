import type { Predicate } from '../../Predicate';
import type { IndexRegistry } from '../IndexRegistry';
import type { Visitor } from './Visitor';
import type { VisitablePredicate } from './VisitablePredicate';
import { AbstractIndexAwarePredicate } from './AbstractIndexAwarePredicate';
import { isNull } from './PredicateUtils';

/**
 * Predicate that checks if attribute value is one of a set of values.
 * Uses Object.is equality to match Java's Double.equals semantics
 * (NaN == NaN, -0 != 0).
 * Equivalent to Java's InPredicate.
 */
export class InPredicate<K = unknown, V = unknown>
  extends AbstractIndexAwarePredicate<K, V>
  implements VisitablePredicate<K, V> {

  _values: unknown[];
  private _convertedValues: unknown[] | null = null;
  private _valuesContainNull: boolean | null = null;

  constructor(attributeName?: string, ...values: unknown[]) {
    super(attributeName);
    if (attributeName !== undefined && values === null) {
      throw new Error("Array can't be null");
    }
    this._values = values;
  }

  protected override applyForSingleAttributeValue(attributeValue: unknown): boolean {
    // Handle null attribute
    if ((attributeValue === null || attributeValue === undefined) && this._convertedValues === null) {
      if (this._valuesContainNull !== null) {
        return this._valuesContainNull;
      }
      for (const v of this._values) {
        if (isNull(v)) {
          this._valuesContainNull = true;
          return true;
        }
      }
      this._valuesContainNull = false;
      return false;
    }

    if (this._convertedValues === null) {
      this._convertedValues = this._values.map(v => {
        if (isNull(v)) return null;
        return this.convert(attributeValue, v);
      });
    }

    const attr = this.convertEnumValue(attributeValue);
    return this._convertedValues.some(v => this._isMemberOf(attr, v));
  }

  /** Membership check using Object.is for numbers (NaN==NaN, -0!==0). */
  private _isMemberOf(attrValue: unknown, storedValue: unknown): boolean {
    if (typeof attrValue === 'number' && typeof storedValue === 'number') {
      return Object.is(attrValue, storedValue);
    }
    return attrValue === storedValue;
  }

  accept(visitor: Visitor, indexes: IndexRegistry): Predicate<K, V> {
    return visitor.visitIn(this, indexes) as Predicate<K, V>;
  }

  toString(): string {
    return `${this.attributeName} IN (${this._values.join(',')})`;
  }
}
