import { describe, it, expect } from 'bun:test';
import { QuickMath } from '@zenystx/core/internal/util/QuickMath';

describe('QuickMathTest', () => {
  it('testIsPowerOfTwo', () => {
    expect(QuickMath.isPowerOfTwo(1)).toBe(true);
    expect(QuickMath.isPowerOfTwo(2)).toBe(true);
    expect(QuickMath.isPowerOfTwo(3)).toBe(false);
    expect(QuickMath.isPowerOfTwo(1024)).toBe(true);
    expect(QuickMath.isPowerOfTwo(1023)).toBe(false);
  });

  it('testNextPowerOfTwo_int', () => {
    expect(QuickMath.nextPowerOfTwo(0)).toEqual(1);
    expect(QuickMath.nextPowerOfTwo(1)).toEqual(1);
    expect(QuickMath.nextPowerOfTwo(2)).toEqual(2);
    expect(QuickMath.nextPowerOfTwo(999)).toEqual(1024);
    expect(QuickMath.nextPowerOfTwo((1 << 23) - 1)).toEqual(1 << 23);
    expect(QuickMath.nextPowerOfTwo(1 << 23)).toEqual(1 << 23);
  });

  it('testModPowerOfTwo', () => {
    expect(QuickMath.modPowerOfTwo(0, 4)).toEqual(0);
    expect(QuickMath.modPowerOfTwo(1, 4)).toEqual(1);
    expect(QuickMath.modPowerOfTwo(5, 4)).toEqual(1);
    expect(QuickMath.modPowerOfTwo(7, 4)).toEqual(3);
  });

  it('testLog2', () => {
    expect(QuickMath.log2(1)).toEqual(0);
    expect(QuickMath.log2(2)).toEqual(1);
    expect(QuickMath.log2(4)).toEqual(2);
    expect(QuickMath.log2(8)).toEqual(3);
  });

  it('testNormalize', () => {
    expect(QuickMath.normalize(5, 4)).toEqual(8);
    expect(QuickMath.normalize(4, 4)).toEqual(4);
    expect(QuickMath.normalize(0, 4)).toEqual(0);
  });

  it('testBytesToHex', () => {
    const data = Buffer.from([0x03, 0xc3]);
    const result = QuickMath.bytesToHex(data);
    expect(result).toEqual('03c3');
  });
});
