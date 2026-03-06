import { describe, test, expect } from 'bun:test';
import type { Predicate } from '@zenystx/helios-core/query/Predicate';
import { acceptVisitor } from '@zenystx/helios-core/query/impl/predicates/VisitorUtils';
import { createMockVisitablePredicate, createPassthroughVisitor } from './PredicateTestUtils';

function mockPredicate(): Predicate {
  return { apply: () => false };
}

const mockIndexes = {} as never;

describe('VisitorUtils', () => {

  test('acceptVisitor_whenEmptyInputArray_thenReturnOriginalArray', () => {
    const visitor = createPassthroughVisitor();
    const predicates: Predicate[] = [];
    const result = acceptVisitor(predicates, visitor, mockIndexes);

    expect(result).toBe(predicates);
  });

  test('acceptVisitor_whenNoChange_thenReturnOriginalArray', () => {
    const visitor = createPassthroughVisitor();

    const predicate = createMockVisitablePredicate();
    const predicates: Predicate[] = [predicate];

    const result = acceptVisitor(predicates, visitor, mockIndexes);
    expect(result).toBe(predicates);
  });

  test('acceptVisitor_whenThereIsChange_thenReturnNewArray', () => {
    const visitor = createPassthroughVisitor();

    const p1 = createMockVisitablePredicate();
    const transformed = mockPredicate();
    const p2 = createMockVisitablePredicate(transformed);
    const predicates: Predicate[] = [p1, p2];

    const result = acceptVisitor(predicates, visitor, mockIndexes);
    expect(result).not.toBe(predicates);
    expect(result).toHaveLength(2);
    expect(result).toContain(p1);
    expect(result).toContain(transformed);
  });

  test('acceptVisitor_whenThereIsNonVisitablePredicateAndNewArrayIsCreated_thenJustCopyTheNonVisitablePredicate', () => {
    const visitor = createPassthroughVisitor();

    const p1 = mockPredicate(); // non-visitable
    const transformed = mockPredicate();
    const p2 = createMockVisitablePredicate(transformed);
    const p3 = mockPredicate(); // non-visitable
    const predicates: Predicate[] = [p1, p2, p3];

    const result = acceptVisitor(predicates, visitor, mockIndexes);
    expect(result).not.toBe(predicates);
    expect(result).toHaveLength(3);
    expect(result).toContain(p1);
    expect(result).toContain(transformed);
    expect(result).toContain(p3);
  });
});
