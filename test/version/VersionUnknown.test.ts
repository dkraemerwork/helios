import { Version } from '@zenystx/helios-core/version/Version';
import { describe, expect, test } from 'bun:test';

describe('VersionUnknownTest', () => {
  const UNKNOWN = Version.UNKNOWN;
  const ANY_VERSION = Version.of(3, 7);

  test('unknown equals to itself', () => {
    expect(UNKNOWN.equals(UNKNOWN)).toBe(true);
  });

  test('unknown notEquals to any', () => {
    expect(UNKNOWN.equals(ANY_VERSION)).toBe(false);
  });

  test('unknown isNot greaterThan any', () => {
    expect(UNKNOWN.isGreaterThan(ANY_VERSION)).toBe(false);
  });

  test('unknown isNot greaterThan unknown', () => {
    expect(UNKNOWN.isGreaterThan(UNKNOWN)).toBe(false);
  });

  test('unknown isNot greaterOrEqual any', () => {
    expect(UNKNOWN.isGreaterOrEqual(ANY_VERSION)).toBe(false);
  });

  test('unknown is greaterOrEqual unknown', () => {
    expect(UNKNOWN.isGreaterOrEqual(UNKNOWN)).toBe(true);
  });

  test('unknown isNot lessThan any', () => {
    expect(UNKNOWN.isLessThan(ANY_VERSION)).toBe(false);
  });

  test('unknown isNot lessThan unknown', () => {
    expect(UNKNOWN.isLessThan(UNKNOWN)).toBe(false);
  });

  test('unknown isNot lessOrEqual any', () => {
    expect(UNKNOWN.isLessOrEqual(ANY_VERSION)).toBe(false);
  });

  test('unknown is lessOrEqual unknown', () => {
    expect(UNKNOWN.isLessOrEqual(UNKNOWN)).toBe(true);
  });

  test('unknown is unknownOrGreaterThan any', () => {
    expect(UNKNOWN.isUnknownOrGreaterThan(ANY_VERSION)).toBe(true);
  });

  test('unknown is unknownOrGreaterThan unknown', () => {
    expect(UNKNOWN.isUnknownOrGreaterThan(UNKNOWN)).toBe(true);
  });

  test('unknown is unknownOrLessThan any', () => {
    expect(UNKNOWN.isUnknownOrLessThan(ANY_VERSION)).toBe(true);
  });

  test('unknown is unknownOrLessThan unknown', () => {
    expect(UNKNOWN.isUnknownOrLessThan(UNKNOWN)).toBe(true);
  });

  test('unknown is unknownGreaterOrEqual any', () => {
    expect(UNKNOWN.isUnknownOrGreaterOrEqual(ANY_VERSION)).toBe(true);
  });

  test('unknown is unknownGreaterOrEqual unknown', () => {
    expect(UNKNOWN.isUnknownOrGreaterOrEqual(UNKNOWN)).toBe(true);
  });

  test('unknown is unknownLessOrEqual any', () => {
    expect(UNKNOWN.isUnknownOrLessOrEqual(ANY_VERSION)).toBe(true);
  });

  test('unknown is unknownLessOrEqual unknown', () => {
    expect(UNKNOWN.isUnknownOrLessOrEqual(UNKNOWN)).toBe(true);
  });

  test('any notEquals to unknown', () => {
    expect(ANY_VERSION.equals(UNKNOWN)).toBe(false);
  });

  test('any isNot greaterThan unknown', () => {
    expect(ANY_VERSION.isGreaterThan(UNKNOWN)).toBe(false);
  });

  test('any isNot greaterOrEqual unknown', () => {
    expect(ANY_VERSION.isGreaterOrEqual(UNKNOWN)).toBe(false);
  });

  test('any isNot lessThan unknown', () => {
    expect(ANY_VERSION.isLessThan(UNKNOWN)).toBe(false);
  });

  test('any isNot lessOrEqual unknown', () => {
    expect(ANY_VERSION.isLessOrEqual(UNKNOWN)).toBe(false);
  });

  test('any isNot unknownOrGreaterThan unknown', () => {
    expect(ANY_VERSION.isUnknownOrGreaterThan(UNKNOWN)).toBe(false);
  });

  test('any isNot unknownOrLessThan unknown', () => {
    expect(ANY_VERSION.isUnknownOrLessThan(UNKNOWN)).toBe(false);
  });

  test('any isNot unknownGreaterOrEqual unknown', () => {
    expect(ANY_VERSION.isUnknownOrGreaterOrEqual(UNKNOWN)).toBe(false);
  });

  test('any isNot unknownLessOrEqual unknown', () => {
    expect(ANY_VERSION.isUnknownOrLessOrEqual(UNKNOWN)).toBe(false);
  });
});
