import type { Predicate } from '../../Predicate';
import type { IndexRegistry } from '../IndexRegistry';
import type { VisitablePredicate } from './VisitablePredicate';
import type { Visitor } from './Visitor';

/**
 * Utility for accepting a Visitor across an array of predicates.
 * Copy-on-write: returns original array if nothing changed.
 * Equivalent to Java's VisitorUtils.
 */
export function acceptVisitor(
  predicates: Predicate[],
  visitor: Visitor,
  indexes: IndexRegistry,
): Predicate[] {
  let target = predicates;
  let copyCreated = false;

  for (let i = 0; i < predicates.length; i++) {
    const predicate = predicates[i]!;
    const visitable = predicate as Partial<VisitablePredicate>;
    if (typeof visitable.accept === 'function') {
      const transformed = visitable.accept(visitor, indexes);
      if (transformed !== predicate) {
        if (!copyCreated) {
          copyCreated = true;
          target = [...predicates];
        }
        target[i] = transformed;
      }
    }
  }

  return target;
}
