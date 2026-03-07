import type { Predicate } from '@zenystx/helios-core/query/Predicate';
import { Predicates } from '@zenystx/helios-core/query/Predicates';
import { AndPredicate } from '@zenystx/helios-core/query/impl/predicates/AndPredicate';
import { NotPredicate } from '@zenystx/helios-core/query/impl/predicates/NotPredicate';
import { OrPredicate } from '@zenystx/helios-core/query/impl/predicates/OrPredicate';
import { describe, expect, test } from 'bun:test';
import { createMockNegatablePredicate } from './PredicateTestUtils';

function mockPredicate(): Predicate {
  return { apply: () => false };
}

describe('OrPredicate', () => {

  test('negate_whenContainsNegatablePredicate_thenReturnAndPredicateWithNegationInside', () => {
    // ~(foo or bar)  -->  (~foo and ~bar)
    const negated = mockPredicate();
    const negatable = createMockNegatablePredicate(negated);

    const or = Predicates.or(negatable) as OrPredicate;
    const result = or.negate() as AndPredicate;

    expect(result).toBeInstanceOf(AndPredicate);
    expect(result.predicates).toHaveLength(1);
    expect(result.predicates[0]).toBe(negated);
  });

  test('negate_whenContainsNonNegatablePredicate_thenReturnAndPredicateWithNotInside', () => {
    // ~(foo or bar)  -->  (~foo and ~bar)
    const nonNegatable = mockPredicate();

    const or = Predicates.or(nonNegatable) as OrPredicate;
    const result = or.negate() as AndPredicate;

    expect(result).toBeInstanceOf(AndPredicate);
    expect(result.predicates).toHaveLength(1);

    const notPredicate = result.predicates[0] as NotPredicate;
    expect(notPredicate).toBeInstanceOf(NotPredicate);
    expect(notPredicate.predicate).toBe(nonNegatable);
  });
});
