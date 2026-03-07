import type { Predicate } from '../../Predicate';
import type { IndexRegistry } from '../IndexRegistry';
import type { AndPredicate } from './AndPredicate';
import type { BetweenPredicate } from './BetweenPredicate';
import type { EqualPredicate } from './EqualPredicate';
import type { InPredicate } from './InPredicate';
import type { NotEqualPredicate } from './NotEqualPredicate';
import type { NotPredicate } from './NotPredicate';
import type { OrPredicate } from './OrPredicate';
import type { Visitor } from './Visitor';

/**
 * Base visitor that returns every predicate unchanged.
 * Concrete visitors override only the methods they need.
 * Equivalent to Java's AbstractVisitor.
 */
export class AbstractVisitor implements Visitor {
  visitAnd(predicate: AndPredicate, _indexes: IndexRegistry): Predicate { return predicate; }
  visitOr(predicate: OrPredicate, _indexes: IndexRegistry): Predicate { return predicate; }
  visitNot(predicate: NotPredicate, _indexes: IndexRegistry): Predicate { return predicate; }
  visitEqual(predicate: EqualPredicate, _indexes: IndexRegistry): Predicate { return predicate; }
  visitNotEqual(predicate: NotEqualPredicate, _indexes: IndexRegistry): Predicate { return predicate; }
  visitIn(predicate: InPredicate, _indexes: IndexRegistry): Predicate { return predicate; }
  visitBetween(predicate: BetweenPredicate, _indexes: IndexRegistry): Predicate { return predicate; }
}
