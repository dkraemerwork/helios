/** Optimized mathematical operations. */
export class QuickMath {
  private constructor() {}

  static isPowerOfTwo(x: number): boolean {
    return x > 0 && (x & (x - 1)) === 0;
  }

  static modPowerOfTwo(a: number, b: number): number {
    return a & (b - 1);
  }

  static nextPowerOfTwo(value: number): number {
    if (value <= 1) return 1;
    return 1 << (32 - Math.clz32(value - 1));
  }

  static log2(value: number): number {
    return 31 - Math.clz32(value);
  }

  static divideByAndCeilToInt(d: number, k: number): number {
    return Math.ceil(d / k);
  }

  static divideByAndCeilToLong(d: number, k: number): number {
    return Math.ceil(d / k);
  }

  static divideByAndRoundToInt(d: number, k: number): number {
    return Math.round(d / k);
  }

  static divideByAndRoundToLong(d: number, k: number): number {
    return Math.round(d / k);
  }

  static normalize(value: number, factor: number): number {
    return QuickMath.divideByAndCeilToInt(value, factor) * factor;
  }

  static bytesToHex(data: Buffer | Uint8Array): string {
    const hexArray = '0123456789abcdef';
    let result = '';
    for (let i = 0; i < data.length; i++) {
      const v = data[i] & 0xff;
      result += hexArray[v >>> 4];
      result += hexArray[v & 0xf];
    }
    return result;
  }

  static compareIntegers(i1: number, i2: number): number {
    return i1 < i2 ? -1 : i1 > i2 ? 1 : 0;
  }

  static compareLongs(l1: number, l2: number): number {
    return l1 < l2 ? -1 : l1 > l2 ? 1 : 0;
  }
}
