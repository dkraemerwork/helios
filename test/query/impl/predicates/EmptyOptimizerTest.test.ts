import type { Predicate } from '@zenystx/helios-core/query/Predicate';
import { EmptyOptimizer } from '@zenystx/helios-core/query/impl/predicates/EmptyOptimizer';
import { describe, expect, test } from 'bun:test';

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
