import type { Predicate } from '../../Predicate';
import type { IndexRegistry } from '../IndexRegistry';
import { AbstractVisitor } from './AbstractVisitor';
import { AndPredicate } from './AndPredicate';
import type { NegatablePredicate } from './NegatablePredicate';
import { NotPredicate } from './NotPredicate';
import { OrPredicate } from './OrPredicate';

/**
 * Visitor that rewrites predicate trees by:
 * 1. Flattening nested AndPredicates: (a AND (b AND c)) → (a AND b AND c)
 * 2. Flattening nested OrPredicates:  (a OR (b OR c))  → (a OR b OR c)
 * 3. Not-elimination: NOT(P) where P is NegatablePredicate → P.negate()
 * Equivalent to Java's FlatteningVisitor.
 */
export class FlatteningVisitor extends AbstractVisitor {

  override visitAnd(andPredicate: AndPredicate, _indexes: IndexRegistry): Predicate {
    const original = andPredicate.predicates;
    const flattened: Predicate[] = [];
    let modified = false;

    for (const p of original) {
      if (p instanceof AndPredicate) {
        modified = true;
        flattened.push(...p.predicates);
      } else {
        flattened.push(p);
      }
    }

    if (!modified) return andPredicate;
    return new AndPredicate(flattened);
  }

  override visitOr(orPredicate: OrPredicate, _indexes: IndexRegistry): Predicate {
    const original = orPredicate.predicates;
    const flattened: Predicate[] = [];
    let modified = false;

    for (const p of original) {
      if (p instanceof OrPredicate) {
        modified = true;
        flattened.push(...p.predicates);
      } else {
        flattened.push(p);
      }
    }

    if (!modified) return orPredicate;
    return new OrPredicate(flattened);
  }

  override visitNot(predicate: NotPredicate, _indexes: IndexRegistry): Predicate {
    const inner = predicate.predicate;
    if (inner !== null) {
      const neg = inner as Partial<NegatablePredicate>;
      if (typeof neg.negate === 'function') {
        return neg.negate();
      }
    }
    return predicate;
  }
}
