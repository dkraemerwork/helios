import { describe, test, expect } from 'bun:test';
import { HyperLogLogImpl } from '@zenystx/core/cardinality/impl/HyperLogLogImpl';

// testEstimateErrorRateForBigCardinalities: @SlowTest — 10M iterations × 6 precisions, skipped

const PRECISIONS = [11, 12, 13, 14, 15, 16] as const;

for (const p of PRECISIONS) {
  describe(`HyperLogLogImpl precision=${p}`, () => {
    test('add', () => {
      const hll = new HyperLogLogImpl(p);
      hll.add(1000);
      expect(hll.estimate()).toBe(1);
    });

    test('addAll', () => {
      const hll = new HyperLogLogImpl(p);
      hll.addAll([1, 1, 2000, 3000, 40000]);
      expect(hll.estimate()).toBe(4);
    });
  });
}
