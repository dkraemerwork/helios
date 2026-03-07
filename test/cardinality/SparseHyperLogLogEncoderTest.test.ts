import { SparseHyperLogLogEncoder } from '@zenystx/helios-core/cardinality/impl/SparseHyperLogLogEncoder';
import { describe, expect, test } from 'bun:test';

// testEstimateErrorRateForBigCardinalities: runLength=40000 × histogram — skipped.

describe('SparseHyperLogLogEncoder', () => {
  // from HyperLogLogEncoderAbstractTest
  test('add', () => {
    const encoder = new SparseHyperLogLogEncoder(14);
    expect(encoder.add(1000)).toBe(true);
    expect(encoder.estimate()).toBe(1);
  });
});
