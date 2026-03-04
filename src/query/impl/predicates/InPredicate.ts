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
  private _lookup: Set<unknown> | null = null;
  private _hasNull: boolean = false;
  private _hasNaN: boolean = false;
  private _hasNegZero: boolean = false;

  constructor(attributeName?: string, ...values: unknown[]) {
    super(attributeName);
    if (attributeName !== undefined && values === null) {
      throw new Error("Array can't be null");
    }
    this._values = values;
  }

  protected override applyForSingleAttributeValue(attributeValue: unknown): boolean {
    if (attributeValue === null || attributeValue === undefined) {
      if (this._lookup === null) {
        this._buildLookup(attributeValue);
      }
      return this._hasNull;
    }

    if (this._lookup === null) {
      this._buildLookup(attributeValue);
    }

    const attr = this.convertEnumValue(attributeValue);

    if (typeof attr === 'number') {
      if (isNaN(attr)) return this._hasNaN;
      if (Object.is(attr, -0)) return this._hasNegZero;
      return this._lookup!.has(attr);
    }

    return this._lookup!.has(attr);
  }

  private _buildLookup(attributeValue: unknown): void {
    this._lookup = new Set<unknown>();
    for (const v of this._values) {
      if (isNull(v)) {
        this._hasNull = true;
        continue;
      }
      const converted = attributeValue !== null && attributeValue !== undefined
        ? this.convert(attributeValue, v)
        : v;
      if (typeof converted === 'number') {
        if (isNaN(converted)) {
          this._hasNaN = true;
        } else if (Object.is(converted, -0)) {
          this._hasNegZero = true;
        } else {
          this._lookup.add(converted);
        }
      } else {
        this._lookup.add(converted);
      }
    }
  }

  accept(visitor: Visitor, indexes: IndexRegistry): Predicate<K, V> {
    return visitor.visitIn(this, indexes) as Predicate<K, V>;
  }

  toString(): string {
    return `${this.attributeName} IN (${this._values.join(',')})`;
  }
}
