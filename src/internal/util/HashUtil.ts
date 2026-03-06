import { Preconditions } from '@zenystx/helios-core/internal/util/Preconditions';

/** Hash utility methods. Port of com.hazelcast.internal.util.HashUtil. */
export class HashUtil {
  private constructor() {}

  /**
   * MurmurHash3 x64 64-bit variant.
   * Returns a 64-bit hash as bigint.
   */
  static MurmurHash3_x64_64(data: Buffer | Uint8Array, offset: number, len: number): bigint {
    const seed = 0xe17a1465n;
    const c1 = 0x87c37b91114253d5n;
    const c2 = 0x4cf5ad432745937fn;
    const mask64 = 0xffffffffffffffffn;

    let h1 = seed;
    let h2 = seed;

    let i = offset;
    const nblocks = len >> 4;

    for (let block = 0; block < nblocks; block++) {
      let k1 = readLongLE(data, i);
      let k2 = readLongLE(data, i + 8);
      i += 16;

      k1 = mulBig(k1, c1) & mask64;
      k1 = rotl64(k1, 31n);
      k1 = mulBig(k1, c2) & mask64;
      h1 ^= k1;

      h1 = rotl64(h1, 27n);
      h1 = (h1 + h2) & mask64;
      h1 = (mulBig(h1, 5n) + 0x52dce729n) & mask64;

      k2 = mulBig(k2, c2) & mask64;
      k2 = rotl64(k2, 33n);
      k2 = mulBig(k2, c1) & mask64;
      h2 ^= k2;

      h2 = rotl64(h2, 31n);
      h2 = (h2 + h1) & mask64;
      h2 = (mulBig(h2, 5n) + 0x38495ab5n) & mask64;
    }

    // tail
    let k1 = 0n;
    let k2 = 0n;
    const tail = i;
    switch (len & 15) {
      case 15: k2 ^= BigInt(data[tail + 14]) << 48n; // falls through
      case 14: k2 ^= BigInt(data[tail + 13]) << 40n; // falls through
      case 13: k2 ^= BigInt(data[tail + 12]) << 32n; // falls through
      case 12: k2 ^= BigInt(data[tail + 11]) << 24n; // falls through
      case 11: k2 ^= BigInt(data[tail + 10]) << 16n; // falls through
      case 10: k2 ^= BigInt(data[tail + 9]) << 8n;   // falls through
      case 9:
        k2 ^= BigInt(data[tail + 8]);
        k2 = mulBig(k2, c2) & mask64;
        k2 = rotl64(k2, 33n);
        k2 = mulBig(k2, c1) & mask64;
        h2 ^= k2;
        // falls through
      case 8: k1 ^= BigInt(data[tail + 7]) << 56n; // falls through
      case 7: k1 ^= BigInt(data[tail + 6]) << 48n; // falls through
      case 6: k1 ^= BigInt(data[tail + 5]) << 40n; // falls through
      case 5: k1 ^= BigInt(data[tail + 4]) << 32n; // falls through
      case 4: k1 ^= BigInt(data[tail + 3]) << 24n; // falls through
      case 3: k1 ^= BigInt(data[tail + 2]) << 16n; // falls through
      case 2: k1 ^= BigInt(data[tail + 1]) << 8n;  // falls through
      case 1:
        k1 ^= BigInt(data[tail]);
        k1 = mulBig(k1, c1) & mask64;
        k1 = rotl64(k1, 31n);
        k1 = mulBig(k1, c2) & mask64;
        h1 ^= k1;
    }

    h1 ^= BigInt(len);
    h2 ^= BigInt(len);
    h1 = (h1 + h2) & mask64;
    h2 = (h2 + h1) & mask64;
    h1 = fmix64(h1) & mask64;
    h2 = fmix64(h2) & mask64;
    h1 = (h1 + h2) & mask64;
    h2 = (h2 + h1) & mask64;

    return BigInt.asIntN(64, h1);
  }

  /**
   * Returns the index of the item in an array of the given size.
   * Handles negative hashes by using Math.abs.
   * @throws if itemCount <= 0
   */
  static hashToIndex(hash: number, itemCount: number): number {
    Preconditions.checkPositive(itemCount, `Item count must be positive, was ${itemCount}`);
    if (hash === -2147483648) return 0; // Integer.MIN_VALUE special case
    return Math.abs(hash) % itemCount;
  }

  /** MurmurHash3 32-bit finalizer mix */
  static MurmurHash3_fmix(k: number): number {
    k ^= k >>> 16;
    k = Math.imul(k, 0x85ebca6b);
    k ^= k >>> 13;
    k = Math.imul(k, 0xc2b2ae35);
    k ^= k >>> 16;
    return k;
  }

  /** MurmurHash3_x86_32 on a byte array */
  static MurmurHash3_x86_32(data: Buffer | Uint8Array, offset: number, len: number): number {
    const seed = 0x01000193;
    let h1 = seed;
    const c1 = 0xcc9e2d51;
    const c2 = 0x1b873593;

    let i = offset;
    const end = offset + len;

    while (i + 4 <= end) {
      let k1 = (data[i] & 0xff) |
               ((data[i + 1] & 0xff) << 8) |
               ((data[i + 2] & 0xff) << 16) |
               ((data[i + 3] & 0xff) << 24);
      k1 = Math.imul(k1, c1);
      k1 = (k1 << 15) | (k1 >>> 17);
      k1 = Math.imul(k1, c2);
      h1 ^= k1;
      h1 = (h1 << 13) | (h1 >>> 19);
      h1 = (Math.imul(h1, 5) + 0xe6546b64) | 0;
      i += 4;
    }

    let k1 = 0;
    switch (end - i) {
      case 3: k1 ^= (data[i + 2] & 0xff) << 16; // falls through
      case 2: k1 ^= (data[i + 1] & 0xff) << 8;  // falls through
      case 1:
        k1 ^= data[i] & 0xff;
        k1 = Math.imul(k1, c1);
        k1 = (k1 << 15) | (k1 >>> 17);
        k1 = Math.imul(k1, c2);
        h1 ^= k1;
    }

    h1 ^= len;
    return HashUtil.MurmurHash3_fmix(h1);
  }
}

// ── private helpers for MurmurHash3_x64_64 ──────────────────────────────────

function readLongLE(data: Buffer | Uint8Array, pos: number): bigint {
    return BigInt(data[pos]) |
           (BigInt(data[pos + 1]) << 8n) |
           (BigInt(data[pos + 2]) << 16n) |
           (BigInt(data[pos + 3]) << 24n) |
           (BigInt(data[pos + 4]) << 32n) |
           (BigInt(data[pos + 5]) << 40n) |
           (BigInt(data[pos + 6]) << 48n) |
           (BigInt(data[pos + 7]) << 56n);
}

function rotl64(x: bigint, r: bigint): bigint {
    return ((x << r) | (x >> (64n - r))) & 0xffffffffffffffffn;
}

function mulBig(a: bigint, b: bigint): bigint {
    // Multiply two 64-bit values, keeping lower 64 bits
    return BigInt.asUintN(64, a * b);
}

function fmix64(k: bigint): bigint {
    const mask64 = 0xffffffffffffffffn;
    k = (k ^ (k >> 33n)) & mask64;
    k = mulBig(k, 0xff51afd7ed558ccdn);
    k = (k ^ (k >> 33n)) & mask64;
    k = mulBig(k, 0xc4ceb9fe1a85ec53n);
    k = (k ^ (k >> 33n)) & mask64;
    return k;
}
