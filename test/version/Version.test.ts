import { describe, test, expect } from 'bun:test';
import { Version } from '@zenystx/helios-core/version/Version';

describe('VersionTest', () => {
  const V3_0 = Version.of(3, 0);

  test('getValue', () => {
    expect(V3_0.getMajor()).toBe(3);
    expect(V3_0.getMinor()).toBe(0);
  });

  test('isEqualTo', () => {
    expect(V3_0.isEqualTo(Version.of(3, 0))).toBe(true);
    expect(V3_0.isEqualTo(Version.of(4, 0))).toBe(false);
  });

  test('isGreaterThan', () => {
    expect(V3_0.isGreaterThan(Version.of(2, 0))).toBe(true);
    expect(V3_0.isGreaterThan(Version.of(3, 0))).toBe(false);
    expect(V3_0.isGreaterThan(Version.of(4, 0))).toBe(false);
  });

  test('isUnknownOrGreaterThan', () => {
    expect(V3_0.isUnknownOrGreaterThan(Version.of(2, 0))).toBe(true);
    expect(V3_0.isUnknownOrGreaterThan(Version.of(3, 0))).toBe(false);
    expect(V3_0.isUnknownOrGreaterThan(Version.of(4, 0))).toBe(false);
    expect(Version.UNKNOWN.isUnknownOrGreaterThan(Version.of(4, 0))).toBe(true);
  });

  test('isGreaterOrEqual', () => {
    expect(V3_0.isGreaterOrEqual(Version.of(2, 0))).toBe(true);
    expect(V3_0.isGreaterOrEqual(Version.of(3, 0))).toBe(true);
    expect(V3_0.isGreaterOrEqual(Version.of(4, 0))).toBe(false);
  });

  test('isUnknownGreaterOrEqual', () => {
    expect(V3_0.isUnknownOrGreaterOrEqual(Version.of(2, 0))).toBe(true);
    expect(V3_0.isUnknownOrGreaterOrEqual(Version.of(3, 0))).toBe(true);
    expect(V3_0.isUnknownOrGreaterOrEqual(Version.of(4, 0))).toBe(false);
    expect(Version.UNKNOWN.isUnknownOrGreaterOrEqual(Version.of(4, 0))).toBe(true);
  });

  test('isLessThan', () => {
    expect(V3_0.isLessThan(Version.of(2, 0))).toBe(false);
    expect(V3_0.isLessThan(Version.of(3, 0))).toBe(false);
    expect(V3_0.isLessThan(Version.of(3, 1))).toBe(true);
    expect(V3_0.isLessThan(Version.of(4, 0))).toBe(true);
    expect(V3_0.isLessThan(Version.of(100, 0))).toBe(true);
  });

  test('isUnknownOrLessThan', () => {
    expect(V3_0.isUnknownOrLessThan(Version.of(2, 0))).toBe(false);
    expect(V3_0.isUnknownOrLessThan(Version.of(3, 0))).toBe(false);
    expect(V3_0.isUnknownOrLessThan(Version.of(3, 1))).toBe(true);
    expect(V3_0.isUnknownOrLessThan(Version.of(4, 0))).toBe(true);
    expect(V3_0.isUnknownOrLessThan(Version.of(100, 0))).toBe(true);
    expect(Version.UNKNOWN.isUnknownOrLessThan(Version.of(100, 0))).toBe(true);
  });

  test('isLessOrEqual', () => {
    expect(V3_0.isLessOrEqual(Version.of(2, 0))).toBe(false);
    expect(V3_0.isLessOrEqual(Version.of(3, 0))).toBe(true);
    expect(V3_0.isLessOrEqual(Version.of(4, 0))).toBe(true);
  });

  test('isUnknownLessOrEqual', () => {
    expect(V3_0.isUnknownOrLessOrEqual(Version.of(2, 0))).toBe(false);
    expect(V3_0.isUnknownOrLessOrEqual(Version.of(3, 0))).toBe(true);
    expect(V3_0.isUnknownOrLessOrEqual(Version.of(4, 0))).toBe(true);
    expect(Version.UNKNOWN.isUnknownOrLessOrEqual(Version.of(4, 0))).toBe(true);
  });

  test('isBetween', () => {
    expect(V3_0.isBetween(Version.of(0, 0), Version.of(1, 0))).toBe(false);
    expect(V3_0.isBetween(Version.of(4, 0), Version.of(5, 0))).toBe(false);
    expect(V3_0.isBetween(Version.of(3, 0), Version.of(5, 0))).toBe(true);
    expect(V3_0.isBetween(Version.of(2, 0), Version.of(3, 0))).toBe(true);
    expect(V3_0.isBetween(Version.of(1, 0), Version.of(5, 0))).toBe(true);
  });

  test('isUnknown', () => {
    expect(Version.UNKNOWN.isUnknown()).toBe(true);
    expect(Version.of(Version.UNKNOWN_VERSION, Version.UNKNOWN_VERSION).isUnknown()).toBe(true);
    expect(Version.of(0, 0).isUnknown()).toBe(true);
  });

  test('equals', () => {
    expect(Version.UNKNOWN.equals(Version.UNKNOWN)).toBe(true);
    expect(Version.of(3, 0).equals(Version.of(3, 0))).toBe(true);
    expect(Version.of(3, 0).equals(Version.of(4, 0))).toBe(false);
    expect(Version.UNKNOWN.equals(Version.of(4, 0))).toBe(false);
    expect(Version.UNKNOWN.equals(new Object())).toBe(false);
  });

  test('compareTo', () => {
    expect(Version.of(3, 9).compareTo(Version.of(3, 9))).toBe(0);
    expect(Version.of(3, 10).compareTo(Version.of(3, 9))).toBeGreaterThan(0);
    expect(Version.of(4, 0).compareTo(Version.of(3, 9))).toBeGreaterThan(0);
    expect(Version.of(3, 9).compareTo(Version.of(3, 10))).toBeLessThan(0);
    expect(Version.of(3, 9).compareTo(Version.of(4, 10))).toBeLessThan(0);
  });

  test('hashCode', () => {
    expect(Version.UNKNOWN.hashCode()).toBe(Version.UNKNOWN.hashCode());
    expect(Version.UNKNOWN.hashCode()).not.toBe(Version.of(4, 0).hashCode());
  });

  test('ofString', () => {
    const v = Version.of('3.0');
    expect(v.equals(V3_0)).toBe(true);
  });

  test('ofMalformed throws', () => {
    expect(() => Version.of('3,9')).toThrow();
  });

  test('toString', () => {
    expect(Version.of(3, 8).toString()).toBe('3.8');
  });
});
