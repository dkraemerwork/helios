import { describe, test, expect } from 'bun:test';
import type { Predicate } from '@helios/query/Predicate';
import { Predicates } from '@helios/query/Predicates';
import { NotPredicate } from '@helios/query/impl/predicates/NotPredicate';
import { TruePredicate } from '@helios/query/impl/predicates/TruePredicate';
import { createMockVisitablePredicate, createPassthroughVisitor } from './PredicateTestUtils';

function mockPredicate(): Predicate {
  return { apply: () => false };
}

const mockIndexes = {} as never;

describe('NotPredicate', () => {

  test('negate_thenReturnInnerPredicate', () => {
    const inner = mockPredicate();
    const notPredicate = new NotPredicate(inner);
    const negate = notPredicate.negate();

    expect(negate).toBe(inner);
  });

  test('apply', () => {
    // NOT(alwaysTrue) → false
    expect(new NotPredicate(Predicates.alwaysTrue()).apply({} as never)).toBe(false);
    // NOT(alwaysFalse) → true
    expect(new NotPredicate(Predicates.alwaysFalse()).apply({} as never)).toBe(true);
  });

  test('accept_whenNullPredicate_thenReturnItself', () => {
    const visitor = createPassthroughVisitor();

    const notPredicate = new NotPredicate(null as unknown as Predicate);
    const result = notPredicate.accept(visitor, mockIndexes) as NotPredicate;

    expect(result).toBe(notPredicate);
  });

  test('accept_whenPredicateChangedOnAccept_thenReturnNewNotPredicate', () => {
    const visitor = createPassthroughVisitor();

    const transformed = mockPredicate();
    const predicate = createMockVisitablePredicate(transformed);

    const notPredicate = new NotPredicate(predicate);
    const result = notPredicate.accept(visitor, mockIndexes) as NotPredicate;

    expect(result).not.toBe(notPredicate);
    expect(result).toBeInstanceOf(NotPredicate);
    expect(result.predicate).toBe(transformed);
  });
});
