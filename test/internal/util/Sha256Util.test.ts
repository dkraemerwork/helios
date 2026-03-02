import { describe, it, expect } from 'bun:test';
import { Sha256Util } from '@helios/internal/util/Sha256Util';

describe('Sha256UtilTest', () => {
  it('testBytesToHex', () => {
    const data = Buffer.from([
      3, -61 & 0xff, -37 & 0xff, -66 & 0xff, 125, -120 & 0xff, 21, -109 & 0xff,
      126, 53, 75, -115 & 0xff, 44, 76, -17 & 0xff, -53 & 0xff, 2, 6, 61, -45 & 0xff,
      32, -19 & 0xff, 35, -15 & 0xff, 109, -114 & 0xff, 92, -13 & 0xff, 109, -44 & 0xff,
      -7 & 0xff, 42,
    ]);
    const result = Sha256Util.bytesToHex(data);
    expect(result.length % 2).toEqual(0);
    expect(result).toEqual('03c3dbbe7d8815937e354b8d2c4cefcb02063dd320ed23f16d8e5cf36dd4f92a');
  });

  it('testCalculateSha256Hex', () => {
    const data = Buffer.from([0]);
    const result = Sha256Util.calculateSha256Hex(data);
    expect(result).toEqual('6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d');
  });

  it('testLeadingZeroWithLength', () => {
    const data = Buffer.from([
      11, 52, -94 & 0xff, -104 & 0xff, 3, 89, -126 & 0xff, 7, 49, -84 & 0xff, 67, 111,
      -81 & 0xff, 15, 69, -19 & 0xff, 69, 99, -112 & 0xff, -110 & 0xff, -89 & 0xff,
      -42 & 0xff, 87, -12 & 0xff, 37, -114 & 0xff, -116 & 0xff, -47 & 0xff, -83 & 0xff,
      -28 & 0xff, 5, -83 & 0xff,
    ]);
    const result = Sha256Util.calculateSha256HexWithLength(data, 32);
    expect(result).toEqual('0dd0af6f7fe8a8816856fadf34cbf7ca5ff7c5af088da656c94c49ff60aea20f');
  });

  it('testLeadingZero', () => {
    const data = Buffer.from([
      -103 & 0xff, -109 & 0xff, 6, 90, -72 & 0xff, 68, 41, 7, -45 & 0xff, 42, 12, -38 & 0xff,
      -50 & 0xff, 123, -100 & 0xff, 102, 95, 65, 5, 30, 64, 85, 126, -26 & 0xff, 5, 54, 18,
      -98 & 0xff, -85 & 0xff, -101 & 0xff, 109, -91 & 0xff,
    ]);
    const result = Sha256Util.calculateSha256Hex(data);
    expect(result).toEqual('07b18fecd4bcb1a726fbab1bd4c017e57e20f6f962a342789c57e531667f603b');
  });

  it('testTwoLeadingZeros', () => {
    const data = Buffer.from([
      -67 & 0xff, 65, -32 & 0xff, -95 & 0xff, 16, 21, -123 & 0xff, 112, -40 & 0xff, -40 & 0xff,
      -58 & 0xff, -97 & 0xff, -59 & 0xff, 48, 100, 79, 67, -86 & 0xff, 68, 119, -104 & 0xff,
      77, -63 & 0xff, 9, -55 & 0xff, -74 & 0xff, -27 & 0xff, 123, -125 & 0xff, 64, 85, -7 & 0xff,
    ]);
    const result = Sha256Util.calculateSha256Hex(data);
    expect(result).toEqual('0078723ef3412533bfc5f362ce0de7d9e18b847a0360dfa4d9a37c3923585097');
  });
});
