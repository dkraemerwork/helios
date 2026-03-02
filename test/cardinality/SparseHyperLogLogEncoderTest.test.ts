import { describe, test, expect } from 'bun:test';
import { SparseHyperLogLogEncoder } from '@helios/cardinality/impl/SparseHyperLogLogEncoder';

// testEstimateErrorRateForBigCardinalities: runLength=40000 × histogram — skipped.

describe('SparseHyperLogLogEncoder', () => {
  // from HyperLogLogEncoderAbstractTest
  test('add', () => {
    const encoder = new SparseHyperLogLogEncoder(14);
    expect(encoder.add(1000)).toBe(true);
    expect(encoder.estimate()).toBe(1);
  });
});
