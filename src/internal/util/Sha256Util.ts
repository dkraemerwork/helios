import { createHash } from 'crypto';

/** Utility class for hashing with SHA-256. */
export class Sha256Util {
  private constructor() {}

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

  static calculateSha256Hex(data: Buffer | Uint8Array): string {
    return Sha256Util.calculateSha256HexWithLength(data, data.length);
  }

  static calculateSha256HexWithLength(data: Buffer | Uint8Array, length: number): string {
    const hash = createHash('sha256');
    hash.update(data.slice(0, length) as Buffer);
    return hash.digest('hex');
  }
}
