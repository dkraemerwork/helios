import type { Predicate } from '../../Predicate';
import { Comparables } from '../Comparables';
import { AbstractIndexAwarePredicate } from './AbstractIndexAwarePredicate';
import type { NegatablePredicate } from './NegatablePredicate';

/**
 * Predicate for >, >=, <, <= comparisons.
 * - equal=true  → includes the boundary value (>=, <=)
 * - less=true   → tests for less-than; false → tests for greater-than
 * Equivalent to Java's GreaterLessPredicate.
 */
export class GreaterLessPredicate<K = unknown, V = unknown>
  extends AbstractIndexAwarePredicate<K, V>
  implements NegatablePredicate<K, V> {

  value: unknown;
  equal: boolean;
  less: boolean;

  constructor(attributeName?: string, value?: unknown, equal = false, less = false) {
    super(attributeName);
    if (attributeName !== undefined && value === null) {
      throw new Error("Arguments can't be null");
    }
    this.value = value;
    this.equal = equal;
    this.less = less;
  }

  protected override applyForSingleAttributeValue(attributeValue: unknown): boolean {
    if (attributeValue === null || attributeValue === undefined) {
      return false;
    }
    const givenValue = this.convert(attributeValue, this.value);
    const attr = this.convertEnumValue(attributeValue);
    const result = Comparables.compare(attr, givenValue);
    return (this.equal && result === 0) || (this.less ? result < 0 : result > 0);
  }

  negate(): Predicate<K, V> {
    return new GreaterLessPredicate<K, V>(this.attributeName, this.value, !this.equal, !this.less);
  }

  toString(): string {
    return `${this.attributeName}${this.less ? '<' : '>'}${this.equal ? '=' : ''}${String(this.value)}`;
  }
}
