import { describe, test, expect } from 'bun:test';
import type { Predicate } from '@zenystx/helios-core/query/Predicate';
import { Predicates } from '@zenystx/helios-core/query/Predicates';
import { AndPredicate } from '@zenystx/helios-core/query/impl/predicates/AndPredicate';
import { OrPredicate } from '@zenystx/helios-core/query/impl/predicates/OrPredicate';
import { NotPredicate } from '@zenystx/helios-core/query/impl/predicates/NotPredicate';
import {
  createMockNegatablePredicate,
  createMockVisitablePredicate,
  createPassthroughVisitor,
  createDelegatingVisitor,
} from './PredicateTestUtils';

/** Minimal stub implementing Predicate<unknown,unknown>. */
function mockPredicate(): Predicate {
  return { apply: () => false };
}

/** Stub IndexRegistry (unused in these tests). */
const mockIndexes = {} as never;

describe('AndPredicate', () => {

  test('negate_whenContainsNegatablePredicate_thenReturnOrPredicateWithNegationInside', () => {
    // ~(foo and bar)  -->  (~foo or ~bar)
    const negated = mockPredicate();
    const negatable = createMockNegatablePredicate(negated);

    const and = Predicates.and(negatable) as AndPredicate;
    const result = and.negate() as OrPredicate;

    expect(result).toBeInstanceOf(OrPredicate);
    expect(result.predicates).toHaveLength(1);
    expect(result.predicates[0]).toBe(negated);
  });

  test('negate_whenContainsNonNegatablePredicate_thenReturnOrPredicateWithNotInside', () => {
    // ~(foo and bar)  -->  (~foo or ~bar)
    const nonNegatable = mockPredicate();

    const and = Predicates.and(nonNegatable) as AndPredicate;
    const result = and.negate() as OrPredicate;

    expect(result).toBeInstanceOf(OrPredicate);
    expect(result.predicates).toHaveLength(1);

    const notPredicate = result.predicates[0] as NotPredicate;
    expect(notPredicate).toBeInstanceOf(NotPredicate);
    expect(notPredicate.predicate).toBe(nonNegatable);
  });

  test('accept_whenEmptyPredicate_thenReturnItself', () => {
    const visitor = createPassthroughVisitor();

    const andPredicate = new AndPredicate([]);
    const result = andPredicate.accept(visitor, mockIndexes);

    expect(result).toBe(andPredicate);
  });

  test('accept_whenInnerPredicateChangedOnAccept_thenReturnAndNewAndPredicate', () => {
    const visitor = createPassthroughVisitor();

    const transformed = mockPredicate();
    const innerPredicate = createMockVisitablePredicate(transformed);

    const andPredicate = new AndPredicate([innerPredicate]);
    const result = andPredicate.accept(visitor, mockIndexes) as AndPredicate;

    expect(result).not.toBe(andPredicate);
    expect(result).toBeInstanceOf(AndPredicate);
    expect(result.predicates).toHaveLength(1);
    expect(result.predicates[0]).toBe(transformed);
  });

  test('accept_whenVisitorReturnsNewInstance_thenReturnTheNewInstance', () => {
    const delegate = mockPredicate();
    const visitor = createDelegatingVisitor(delegate);
    const innerPredicate = mockPredicate();

    const andPredicate = new AndPredicate([innerPredicate]);
    const result = andPredicate.accept(visitor, mockIndexes);

    expect(result).toBe(delegate);
  });
});
