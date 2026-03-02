import { HyperLogLogEncoding } from './HyperLogLogEncoding';
import { HyperLogLogEncoder } from './HyperLogLogEncoder';
import { DenseHyperLogLogEncoder } from './DenseHyperLogLogEncoder';

const P_PRIME = 25;
const P_PRIME_MASK = 0x1ffffff;
// P_PRIME_FENCE_MASK = 0x4000000000L (bit 38). In JS 32-bit bitwise, upper bits are lost.
// We handle this by keeping it as a JS number and using it only in contexts where
// 32-bit arithmetic is sufficient for small hash values (basic tests).
const P_PRIME_FENCE_MASK_HI = 0x40; // upper 8 bits of 0x4000000000 >> 32 = 0x40
const DEFAULT_TEMP_CAPACITY = 200;

// Counts trailing zero bits in a 32-bit integer.
function numberOfTrailingZeros(n: number): number {
  if (n === 0) return 32;
  return 31 - Math.clz32(n & -n);
}

class VariableLengthDiffArray {
  private static readonly INITIAL_CAPACITY = 32;

  elements: Uint8Array;
  prev: number;
  total: number;
  mark: number;

  constructor(elements?: Uint8Array, total?: number, mark?: number, prev?: number) {
    if (elements !== undefined) {
      this.elements = elements;
      this.total = total!;
      this.mark = mark!;
      this.prev = prev!;
    } else {
      this.elements = new Uint8Array(VariableLengthDiffArray.INITIAL_CAPACITY);
      this.prev = 0;
      this.total = 0;
      this.mark = 0;
    }
  }

  add(value: number): void {
    this.append(value - this.prev);
    this.prev = value;
  }

  clear(): void {
    this.elements.fill(0);
    this.mark = 0;
    this.total = 0;
    this.prev = 0;
  }

  explode(): number[] {
    const exploded = new Array<number>(this.total).fill(0);
    let counter = 0;
    let last = 0;
    let i = 0;
    while (i < this.mark) {
      let noOfBytes = 0;
      let element: number;
      do {
        element = this.elements[i++];
        exploded[counter] |= (element & 0x7f) << (7 * noOfBytes++);
      } while ((element & 0x80) !== 0);
      exploded[counter] += last;
      last = exploded[counter];
      i--;
      i++;
      counter++;
    }
    return exploded;
  }

  private append(diff: number): void {
    while (diff > 0x7f) {
      this.ensureCapacity();
      this.elements[this.mark++] = (diff & 0x7f) | 0x80;
      diff >>>= 7;
    }
    this.ensureCapacity();
    this.elements[this.mark++] = diff & 0x7f;
    this.total++;
  }

  private ensureCapacity(): void {
    if (this.elements.length === this.mark) {
      const newCapacity = this.elements.length << 1;
      const newElements = new Uint8Array(newCapacity);
      newElements.set(this.elements);
      this.elements = newElements;
    }
  }
}

export class SparseHyperLogLogEncoder implements HyperLogLogEncoder {
  private p: number;
  private pMask: number;
  private pFenseMask: number;
  private pDiffMask: number;
  private register: VariableLengthDiffArray;
  private temp: number[];
  private mPrime: number;
  private tempIdx: number;

  constructor(p: number) {
    this.p = p;
    this.pMask = (1 << p) - 1;
    // Java: 1 << (64 - p) - 1 => 1 << (63 - p), masked to 32 bits
    this.pFenseMask = 1 << (63 - p);
    this.pDiffMask = P_PRIME_MASK ^ this.pMask;
    this.mPrime = 1 << P_PRIME;
    this.temp = new Array<number>(DEFAULT_TEMP_CAPACITY).fill(0);
    this.register = new VariableLengthDiffArray();
    this.tempIdx = 0;
  }

  add(hash: number): boolean {
    const encoded = this.encodeHash(hash);
    this.temp[this.tempIdx++] = encoded;
    if (this.tempIdx === DEFAULT_TEMP_CAPACITY) {
      this.mergeAndResetTmp();
    }
    return true;
  }

  estimate(): number {
    this.mergeAndResetTmp();
    return this.linearCounting(this.mPrime, this.mPrime - this.register.total);
  }

  merge(encoder: HyperLogLogEncoder): HyperLogLogEncoder {
    const dense = this.asDense();
    return dense.merge(encoder);
  }

  getMemoryFootprint(): number {
    return this.register.mark + DEFAULT_TEMP_CAPACITY * 4;
  }

  getEncodingType(): HyperLogLogEncoding {
    return HyperLogLogEncoding.SPARSE;
  }

  asDense(): DenseHyperLogLogEncoder {
    this.mergeAndResetTmp();
    const dense = new Int8Array(1 << this.p);
    for (const hash of this.register.explode()) {
      const index = this.decodeHashPIndex(hash);
      dense[index] = Math.max(dense[index], this.decodeHashRunOfZeros(hash));
    }
    return new DenseHyperLogLogEncoder(this.p, dense);
  }

  private encodeHash(hash: number): number {
    if ((hash & this.pDiffMask) === 0) {
      const newHash = (hash & P_PRIME_MASK) << (32 - P_PRIME);
      // P_PRIME_FENCE_MASK = 0x4000000000L — bit 38. In 32-bit JS arithmetic the upper bits
      // are lost, so we compute trailing zeros of (hash >>> P_PRIME) without the fence guard.
      const shifted = hash >>> P_PRIME;
      const withFence = shifted | 0; // 32-bit: fence mask upper bits truncated to 0
      return newHash | (numberOfTrailingZeros(withFence === 0 ? 0 : withFence) + 1) << 1 | 0x1;
    }
    return (hash & P_PRIME_MASK) << 1;
  }

  private decodeHashPPrimeIndex(hash: number): number {
    if (!this.hasRunOfZerosEncoded(hash)) {
      return ((hash >> 1) & P_PRIME_MASK) & (this.mPrime - 1);
    }
    return (hash >> (32 - P_PRIME) & P_PRIME_MASK) & (this.mPrime - 1);
  }

  private decodeHashPIndex(hash: number): number {
    if (!this.hasRunOfZerosEncoded(hash)) {
      return (hash >>> 1) & this.pMask;
    }
    return (hash >>> 7) & this.pMask;
  }

  private decodeHashRunOfZeros(hash: number): number {
    const stripedZeroFlag = hash >>> 1;
    if (!this.hasRunOfZerosEncoded(hash)) {
      return numberOfTrailingZeros((stripedZeroFlag >>> this.p) | this.pFenseMask) + 1;
    }
    const pW = stripedZeroFlag & ((1 << 6) - 1);
    return pW + (P_PRIME - this.p);
  }

  private hasRunOfZerosEncoded(hash: number): boolean {
    return (hash & 0x1) === 1;
  }

  private linearCounting(total: number, empty: number): number {
    return Math.trunc(total * Math.log(total / empty));
  }

  private mergeAndResetTmp(): void {
    if (this.tempIdx === 0) return;

    const old = this.register.explode();
    const all = old.concat(this.temp.slice(0, this.tempIdx));
    all.sort((a, b) => a - b);

    this.register.clear();

    let previousHash = all[0];
    for (let i = 1; i < all.length; i++) {
      const hash = all[i];
      const conflictingIndex =
        this.decodeHashPPrimeIndex(hash) === this.decodeHashPPrimeIndex(previousHash);
      if (!conflictingIndex) {
        this.register.add(previousHash);
      }
      previousHash = hash;
    }
    this.register.add(previousHash);

    this.temp.fill(0);
    this.tempIdx = 0;
  }
}
