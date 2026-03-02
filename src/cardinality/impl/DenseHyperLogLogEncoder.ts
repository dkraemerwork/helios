import { HyperLogLogEncoding } from './HyperLogLogEncoding';
import { HyperLogLogEncoder } from './HyperLogLogEncoder';
import { BIAS_DATA, RAW_ESTIMATE_DATA, THRESHOLD } from './DenseHyperLogLogConstants';
import type { SparseHyperLogLogEncoder } from './SparseHyperLogLogEncoder';

// Counts trailing zero bits in a 32-bit integer.
function numberOfTrailingZeros(n: number): number {
  if (n === 0) return 32;
  return 31 - Math.clz32(n & -n);
}

export class DenseHyperLogLogEncoder implements HyperLogLogEncoder {
  private p: number;
  private register: Int8Array;
  private numOfEmptyRegs: number = 0;
  private invPowLookup: number[];
  private m: number;
  private pFenseMask: number;

  constructor(p: number, register?: Int8Array) {
    this.p = p;
    this.m = 1 << p;
    this.register = register ?? new Int8Array(this.m);
    this.invPowLookup = new Array<number>(64 - p + 1);
    // Java: 1 << (64 - p) - 1  => additive has higher prec than shift =>  1 << (63 - p)
    // In JS, same precedence rules: 1 << (63 - p), masked to 32 bits by <<
    this.pFenseMask = 1 << (63 - p);
    this.numOfEmptyRegs = this.m;
    this.prePopulateInvPowLookup();
  }

  add(hash: number): boolean {
    const index = hash & (this.register.length - 1);
    const value = numberOfTrailingZeros(((hash >>> this.p) | this.pFenseMask)) + 1;

    if (value > this.register[index]) {
      this.register[index] = value;
      return true;
    }
    return false;
  }

  estimate(): number {
    const raw = (1 / this.computeE()) * this.alpha() * this.m * this.m;
    return this.applyRangeCorrection(raw);
  }

  merge(encoder: HyperLogLogEncoder): HyperLogLogEncoder {
    let otherDense: DenseHyperLogLogEncoder;
    if (encoder.getEncodingType() === HyperLogLogEncoding.SPARSE) {
      otherDense = (encoder as SparseHyperLogLogEncoder).asDense() as DenseHyperLogLogEncoder;
    } else {
      otherDense = encoder as DenseHyperLogLogEncoder;
    }
    for (let i = 0; i < this.register.length; i++) {
      this.register[i] = Math.max(this.register[i], otherDense.register[i]);
    }
    return this;
  }

  getMemoryFootprint(): number {
    return this.m;
  }

  getEncodingType(): HyperLogLogEncoding {
    return HyperLogLogEncoding.DENSE;
  }

  getRegister(): Int8Array {
    return this.register;
  }

  private alpha(): number {
    if (this.m >= 128) {
      return 0.7213 / (1 + 1.079 / this.m);
    }
    if (this.m === 64) return 0.709;
    if (this.m === 32) return 0.697;
    if (this.m === 16) return 0.673;
    return -1;
  }

  private applyRangeCorrection(e: number): number {
    const ePrime = e <= this.m * 5 ? (e - this.estimateBias(e)) : e;
    const h = this.numOfEmptyRegs !== 0 ? this.linearCounting(this.m, this.numOfEmptyRegs) : ePrime;
    return Math.trunc(this.exceedsThreshold(h) ? ePrime : h);
  }

  private computeE(): number {
    let e = 0;
    this.numOfEmptyRegs = 0;
    for (let i = 0; i < this.register.length; i++) {
      const r = this.register[i];
      if (r > 0) {
        e += this.invPow(r);
      } else {
        this.numOfEmptyRegs++;
      }
    }
    return e + this.numOfEmptyRegs;
  }

  private estimateBias(e: number): number {
    const rawEstimates = RAW_ESTIMATE_DATA[this.p - 4];
    let closestToZero = Math.abs(e - rawEstimates[0]);

    // Build sorted distance map: distance -> index
    const distances: Array<[number, number]> = [];
    for (let i = 0; i < rawEstimates.length; i++) {
      const distance = e - rawEstimates[i];
      distances.push([distance, i]);
      if (Math.abs(distance) < closestToZero) {
        closestToZero = Math.abs(distance);
      }
    }
    distances.sort((a, b) => a[0] - b[0]);

    // kNN: take 3 below and 3 above closestToZero
    const kNN = 6;
    let sum = 0;

    // Java logic: firstX iterates descending from closestToZero (going left/negative),
    // lastX iterates ascending from closestToZero (going right/positive)
    // kNNLeft starts at kNN, decrements. while(kNNLeft-- > kNN/2) takes kNN/2 = 3 entries from firstX
    // then while(kNNLeft-- >= 0) takes remaining 3 from lastX

    // Find split point in sorted array
    let splitIdx = distances.findIndex(([d]) => d >= closestToZero - 1e-12);
    if (splitIdx < 0) splitIdx = distances.length;

    // firstX: descending from split (indices splitIdx-1 down to 0)
    let kNNLeft = kNN;
    let fi = splitIdx - 1;
    while (kNNLeft-- > kNN / 2 && fi >= 0) {
      sum += BIAS_DATA[this.p - 4][distances[fi][1]];
      fi--;
    }

    // lastX: ascending from split (indices splitIdx up)
    let li = splitIdx;
    while (kNNLeft-- >= 0 && li < distances.length) {
      sum += BIAS_DATA[this.p - 4][distances[li][1]];
      li++;
    }

    return sum / kNN;
  }

  private exceedsThreshold(e: number): boolean {
    return e >= THRESHOLD[this.p - 4];
  }

  private invPow(index: number): number {
    return this.invPowLookup[index];
  }

  private linearCounting(total: number, empty: number): number {
    return total * Math.log(total / empty);
  }

  private prePopulateInvPowLookup(): void {
    this.invPowLookup[0] = 1;
    for (let i = 1; i <= 64 - this.p; i++) {
      this.invPowLookup[i] = Math.pow(2, -i);
    }
  }
}
