import type { Predicate } from '../../Predicate';
import type { IndexRegistry } from '../IndexRegistry';
import type { QueryableEntry } from '../QueryableEntry';
import { AndPredicate } from './AndPredicate';
import type { CompoundPredicate } from './CompoundPredicate';
import type { NegatablePredicate } from './NegatablePredicate';
import { NotPredicate } from './NotPredicate';
import type { VisitablePredicate } from './VisitablePredicate';
import type { Visitor } from './Visitor';
import { acceptVisitor } from './VisitorUtils';

/**
 * Logical OR of multiple predicates.
 * Equivalent to Java's OrPredicate.
 */
export class OrPredicate<K = unknown, V = unknown>
  implements Predicate<K, V>, VisitablePredicate<K, V>, NegatablePredicate<K, V>, CompoundPredicate<K, V> {

  predicates: Predicate<K, V>[];
  private _predicatesSet: boolean;

  constructor(predicates?: Predicate<K, V>[]) {
    if (predicates !== undefined) {
      this.predicates = predicates;
      this._predicatesSet = true;
    } else {
      this.predicates = [];
      this._predicatesSet = false;
    }
  }

  apply(entry: QueryableEntry<K, V>): boolean {
    for (const p of this.predicates) {
      if (p.apply(entry)) return true;
    }
    return false;
  }

  accept(visitor: Visitor, indexes: IndexRegistry): Predicate<K, V> {
    const result = acceptVisitor(this.predicates as Predicate[], visitor, indexes);
    if (result !== (this.predicates as Predicate[])) {
      return visitor.visitOr(new OrPredicate<K, V>(result as Predicate<K, V>[]), indexes) as Predicate<K, V>;
    }
    return visitor.visitOr(this, indexes) as Predicate<K, V>;
  }

  negate(): Predicate<K, V> {
    const inners = this.predicates.map(p => {
      const neg = p as Partial<NegatablePredicate<K, V>>;
      return typeof neg.negate === 'function'
        ? neg.negate()
        : new NotPredicate<K, V>(p);
    });
    return new AndPredicate<K, V>(inners as Predicate<K, V>[]);
  }

  getPredicates(): Predicate<K, V>[] {
    return this.predicates;
  }

  setPredicates(predicates: Predicate<K, V>[]): void {
    if (this._predicatesSet) {
      throw new Error('Cannot reset predicates in an OrPredicate after they have been already set.');
    }
    this.predicates = predicates;
    this._predicatesSet = true;
  }

  toString(): string {
    return `(${this.predicates.join(' OR ')})`;
  }
}
