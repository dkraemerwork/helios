import type { Predicate } from '../../Predicate';
import type { IndexRegistry } from '../IndexRegistry';

// Forward declarations (implementations are in separate files)
// Using 'any' here avoids circular imports; tests use concrete types directly.

/**
 * Visitor interface for predicate tree transformations.
 * Equivalent to Java's Visitor (method overloads renamed to avoid
 * TypeScript's lack of overload-by-parameter-type dispatch).
 */
export interface Visitor {
  visitAnd(predicate: import('./AndPredicate.ts').AndPredicate, indexes: IndexRegistry): Predicate;
  visitOr(predicate: import('./OrPredicate.ts').OrPredicate, indexes: IndexRegistry): Predicate;
  visitNot(predicate: import('./NotPredicate.ts').NotPredicate, indexes: IndexRegistry): Predicate;
  visitEqual(predicate: import('./EqualPredicate.ts').EqualPredicate, indexes: IndexRegistry): Predicate;
  visitNotEqual(predicate: import('./NotEqualPredicate.ts').NotEqualPredicate, indexes: IndexRegistry): Predicate;
  visitIn(predicate: import('./InPredicate.ts').InPredicate, indexes: IndexRegistry): Predicate;
  visitBetween(predicate: import('./BetweenPredicate.ts').BetweenPredicate, indexes: IndexRegistry): Predicate;
}
