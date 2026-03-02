import type { Predicate } from '../../Predicate';
import type { IndexRegistry } from '../IndexRegistry';
import type { QueryableEntry } from '../QueryableEntry';
import type { Visitor } from './Visitor';
import type { VisitablePredicate } from './VisitablePredicate';
import type { NegatablePredicate } from './NegatablePredicate';

/**
 * Logical NOT wrapper around a single predicate.
 * negate() returns the inner predicate (double negation elimination).
 * Equivalent to Java's NotPredicate.
 */
export class NotPredicate<K = unknown, V = unknown>
  implements Predicate<K, V>, VisitablePredicate<K, V>, NegatablePredicate<K, V> {

  predicate: Predicate<K, V> | null;

  constructor(predicate?: Predicate<K, V> | null) {
    this.predicate = predicate ?? null;
  }

  apply(entry: QueryableEntry<K, V>): boolean {
    return !this.predicate!.apply(entry);
  }

  accept(visitor: Visitor, indexes: IndexRegistry): Predicate<K, V> {
    let target: Predicate<K, V> | null = this.predicate;
    if (this.predicate !== null) {
      const visitable = this.predicate as Partial<VisitablePredicate<K, V>>;
      if (typeof visitable.accept === 'function') {
        target = visitable.accept(visitor, indexes) as Predicate<K, V>;
      }
    }
    if (target === this.predicate) {
      return visitor.visitNot(this, indexes) as Predicate<K, V>;
    }
    const copy = new NotPredicate<K, V>(target);
    return visitor.visitNot(copy, indexes) as Predicate<K, V>;
  }

  negate(): Predicate<K, V> {
    return this.predicate as Predicate<K, V>;
  }

  toString(): string {
    return `NOT(${String(this.predicate)})`;
  }
}
