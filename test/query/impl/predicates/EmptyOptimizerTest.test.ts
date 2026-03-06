import { describe, test, expect } from 'bun:test';
import type { Predicate } from '@zenystx/core/query/Predicate';
import { EmptyOptimizer } from '@zenystx/core/query/impl/predicates/EmptyOptimizer';

function mockPredicate(): Predicate {
  return { apply: () => false };
}

const mockIndexes = {} as never;

describe('EmptyOptimizer', () => {

  test('optimize_returnsOriginalPredicate', () => {
    const emptyOptimizer = new EmptyOptimizer();
    const predicate = mockPredicate();

    const result = emptyOptimizer.optimize(predicate, mockIndexes);
    expect(result).toBe(predicate);
  });
});
