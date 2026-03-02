import { describe, test, expect } from 'bun:test';
import { MemberVersion } from '@helios/version/MemberVersion';
import { Version } from '@helios/version/Version';

describe('MemberVersionTest', () => {
  const version = MemberVersion.of(3, 8, 0);
  const versionSameAttributes = MemberVersion.of(3, 8, 0);
  const versionOtherMajor = MemberVersion.of(4, 8, 0);
  const versionOtherMinor = MemberVersion.of(3, 9, 0);
  const versionOtherPatch = MemberVersion.of(3, 8, 1);

  test('testIsUnknown', () => {
    expect(MemberVersion.UNKNOWN.isUnknown()).toBe(true);
  });

  test('testVersionOf_whenVersionIsUnknown', () => {
    expect(MemberVersion.of(0, 0, 0).equals(MemberVersion.UNKNOWN)).toBe(true);
  });

  // Expanded from @CsvSource
  test('testVersionOf: 3.8-SNAPSHOT -> 3.8.0', () => {
    const parsed = MemberVersion.of('3.8-SNAPSHOT');
    expect(parsed.equals(MemberVersion.of(3, 8, 0))).toBe(true);
    expect(parsed.isUnknown()).toBe(false);
  });

  test('testVersionOf: 3.8-beta-2 -> 3.8.0', () => {
    const parsed = MemberVersion.of('3.8-beta-2');
    expect(parsed.equals(MemberVersion.of(3, 8, 0))).toBe(true);
    expect(parsed.isUnknown()).toBe(false);
  });

  test('testVersionOf: 3.8.1-beta-1 -> 3.8.1', () => {
    const parsed = MemberVersion.of('3.8.1-beta-1');
    expect(parsed.equals(MemberVersion.of(3, 8, 1))).toBe(true);
    expect(parsed.isUnknown()).toBe(false);
  });

  test('testVersionOf: 3.8.1-beta-2 -> 3.8.1', () => {
    const parsed = MemberVersion.of('3.8.1-beta-2');
    expect(parsed.equals(MemberVersion.of(3, 8, 1))).toBe(true);
    expect(parsed.isUnknown()).toBe(false);
  });

  test('testVersionOf: 3.8.1-RC1 -> 3.8.1', () => {
    const parsed = MemberVersion.of('3.8.1-RC1');
    expect(parsed.equals(MemberVersion.of(3, 8, 1))).toBe(true);
    expect(parsed.isUnknown()).toBe(false);
  });

  test('testVersionOf: 3.8.2 -> 3.8.2', () => {
    const parsed = MemberVersion.of('3.8.2');
    expect(parsed.equals(MemberVersion.of(3, 8, 2))).toBe(true);
    expect(parsed.isUnknown()).toBe(false);
  });

  test('test_constituents', () => {
    const expected = MemberVersion.of(3, 8, 2);
    expect(expected.getMajor()).toBe(3);
    expect(expected.getMinor()).toBe(8);
    expect(expected.getPatch()).toBe(2);
  });

  test('testVersionOf_unknown: null', () => {
    expect(MemberVersion.of(null).equals(MemberVersion.UNKNOWN)).toBe(true);
  });

  test('testVersionOf_unknown: "0.0.0"', () => {
    expect(MemberVersion.of('0.0.0').equals(MemberVersion.UNKNOWN)).toBe(true);
  });

  test('testEquals', () => {
    expect(version.equals(version)).toBe(true);
    expect(version.equals(versionSameAttributes)).toBe(true);

    expect(version.equals(null)).toBe(false);
    expect(version.equals(new Object())).toBe(false);

    expect(version.equals(versionOtherMajor)).toBe(false);
    expect(version.equals(versionOtherMinor)).toBe(false);
    expect(version.equals(versionOtherPatch)).toBe(false);
  });

  test('testHashCode', () => {
    expect(version.hashCode()).toBe(version.hashCode());
    expect(version.hashCode()).toBe(versionSameAttributes.hashCode());

    expect(version.hashCode()).not.toBe(versionOtherMajor.hashCode());
    expect(version.hashCode()).not.toBe(versionOtherMinor.hashCode());
    expect(version.hashCode()).not.toBe(versionOtherPatch.hashCode());
  });

  test('testCompareTo', () => {
    expect(version.compareTo(version)).toBe(0);
    expect(version.compareTo(versionOtherMinor)).toBeLessThan(0);
    expect(version.compareTo(versionOtherPatch)).toBeLessThan(0);

    expect(versionOtherMinor.compareTo(version)).toBeGreaterThan(0);
    expect(versionOtherMinor.compareTo(versionOtherPatch)).toBeGreaterThan(0);
  });

  test('testMajorMinorVersionComparator', () => {
    const cmp = MemberVersion.MAJOR_MINOR_VERSION_COMPARATOR;
    expect(cmp(version, versionOtherPatch)).toBe(0);
    expect(cmp(versionOtherMinor, version)).toBeGreaterThan(0);
    expect(cmp(version, versionOtherMinor)).toBeLessThan(0);
    expect(cmp(versionOtherMinor, versionOtherPatch)).toBeGreaterThan(0);
    expect(cmp(versionOtherPatch, versionOtherMinor)).toBeLessThan(0);
  });

  test('testAsClusterVersion', () => {
    const clusterVersion = MemberVersion.of(3, 8, 2).asVersion();
    expect(clusterVersion.getMajor()).toBe(3);
    expect(clusterVersion.getMinor()).toBe(8);
  });

  test('testAsSerializationVersion', () => {
    const v = MemberVersion.of(4, 0, 2).asVersion();
    expect(v.equals(Version.of(4, 0))).toBe(true);
  });

  test('testEmpty', () => {
    const v = new MemberVersion();
    expect(v.getMajor()).toBe(0);
    expect(v.getMinor()).toBe(0);
    expect(v.getPatch()).toBe(0);
  });

  test('toStringTest', () => {
    expect(MemberVersion.of('3.8.2').toString()).toBe('3.8.2');
  });
});
