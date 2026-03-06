import { describe, test, expect } from 'bun:test';
import type { Predicate } from '@zenystx/helios-core/query/Predicate';
import { Predicates } from '@zenystx/helios-core/query/Predicates';
import { AndPredicate } from '@zenystx/helios-core/query/impl/predicates/AndPredicate';
import { OrPredicate } from '@zenystx/helios-core/query/impl/predicates/OrPredicate';
import { NotPredicate } from '@zenystx/helios-core/query/impl/predicates/NotPredicate';
import { FlatteningVisitor } from '@zenystx/helios-core/query/impl/predicates/FlatteningVisitor';
import type { NegatablePredicate } from '@zenystx/helios-core/query/impl/predicates/NegatablePredicate';

const mockIndexes = {} as never;

describe('FlatteningVisitor', () => {

  test('visitAndPredicate_whenHasInnerAndPredicate_thenFlattenIt', () => {
    // (a1 = 1 and (a2 = 2 and a3 = 3))  -->  (a1 = 1 and a2 = 2 and a3 = 3)
    const visitor = new FlatteningVisitor();

    const a1 = Predicates.equal('a1', 1);
    const a2 = Predicates.equal('a2', 2);
    const a3 = Predicates.equal('a3', 3);

    const innerAnd = Predicates.and(a2, a3) as AndPredicate;
    const outerAnd = Predicates.and(a1, innerAnd) as AndPredicate;

    const result = visitor.visitAnd(outerAnd, mockIndexes) as AndPredicate;
    expect(result.predicates).toHaveLength(3);
  });

  test('visitOrPredicate_whenHasInnerOrPredicate_thenFlattenIt', () => {
    // (a1 = 1 or (a2 = 2 or a3 = 3))  -->  (a1 = 1 or a2 = 2 or a3 = 3)
    const visitor = new FlatteningVisitor();

    const a1 = Predicates.equal('a1', 1);
    const a2 = Predicates.equal('a2', 2);
    const a3 = Predicates.equal('a3', 3);

    const innerOr = Predicates.or(a2, a3) as OrPredicate;
    const outerOr = Predicates.or(a1, innerOr) as OrPredicate;

    const result = visitor.visitOr(outerOr, mockIndexes) as OrPredicate;
    expect(result.predicates).toHaveLength(3);
  });

  test('visitNotPredicate_whenContainsNegatablePredicate_thenFlattenIt', () => {
    // (not(equals(foo, 1)))  -->  (notEquals(foo, 1))
    const visitor = new FlatteningVisitor();

    const negated: Predicate = { apply: () => false };
    const negatablePredicate: Predicate & NegatablePredicate = {
      apply: () => false,
      negate: () => negated,
    };

    const outerPredicate = Predicates.not(negatablePredicate) as NotPredicate;
    const result = visitor.visitNot(outerPredicate, mockIndexes);

    expect(result).toBe(negated);
  });
});
