import { describe, it, expect } from 'bun:test';
import { HashUtil } from '@zenystx/helios-core/internal/util/HashUtil';

describe('HashUtilTest', () => {
  it('hashToIndex_whenHashPositive', () => {
    expect(HashUtil.hashToIndex(20, 100)).toEqual(20);
    expect(HashUtil.hashToIndex(420, 100)).toEqual(20);
  });

  it('hashToIndex_whenHashZero', () => {
    expect(HashUtil.hashToIndex(0, 100)).toEqual(0);
  });

  it('hashToIndex_whenHashNegative', () => {
    expect(HashUtil.hashToIndex(-420, 100)).toEqual(20);
  });

  it('hashToIndex_whenHashIntegerMinValue', () => {
    expect(HashUtil.hashToIndex(-2147483648, 100)).toEqual(0);
  });

  it('hashToIndex_whenItemCountZero', () => {
    expect(() => HashUtil.hashToIndex(0, 0)).toThrow();
  });
});
