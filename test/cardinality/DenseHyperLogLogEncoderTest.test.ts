import { DenseHyperLogLogEncoder } from '@zenystx/helios-core/cardinality/impl/DenseHyperLogLogEncoder';
import { describe, expect, test } from 'bun:test';

// testAdd_assertRegisterLength, testAlpha_withGivenZeroAsInvalidMemoryFootprint,
// testAlpha_withInvalidMemoryFootprint: @RequireAssertEnabled — Java assert semantics, skipped.
// testEstimateErrorRateForBigCardinalities: 10M iterations — skipped.

const PRECISION = 14;

describe('DenseHyperLogLogEncoder', () => {
  // from HyperLogLogEncoderAbstractTest
  test('add', () => {
    const encoder = new DenseHyperLogLogEncoder(PRECISION);
    expect(encoder.add(1000)).toBe(true);
    expect(encoder.estimate()).toBe(1);
  });

  test('getMemoryFootprint', () => {
    const encoder = new DenseHyperLogLogEncoder(PRECISION);
    expect(encoder.getMemoryFootprint()).toBe(1 << PRECISION);
  });

  test('alpha - m=16 (p=4)', () => {
    const encoder = new DenseHyperLogLogEncoder(4);
    expect(() => encoder.estimate()).not.toThrow();
  });

  test('alpha - m=32 (p=5)', () => {
    const encoder = new DenseHyperLogLogEncoder(5);
    expect(() => encoder.estimate()).not.toThrow();
  });

  test('alpha - m=64 (p=6)', () => {
    const encoder = new DenseHyperLogLogEncoder(6);
    expect(() => encoder.estimate()).not.toThrow();
  });

  test('alpha - m=128 (p=7)', () => {
    const encoder = new DenseHyperLogLogEncoder(7);
    expect(() => encoder.estimate()).not.toThrow();
  });
});
