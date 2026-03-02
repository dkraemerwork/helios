import { HyperLogLog } from '../HyperLogLog';
import { HyperLogLogEncoding } from './HyperLogLogEncoding';
import { HyperLogLogEncoder } from './HyperLogLogEncoder';
import { SparseHyperLogLogEncoder } from './SparseHyperLogLogEncoder';

const LOWER_P_BOUND = 4;
const UPPER_P_BOUND = 16;
const DEFAULT_P = 14;

export class HyperLogLogImpl implements HyperLogLog {
  private m: number;
  private encoder: HyperLogLogEncoder;
  private cachedEstimate: number | null = null;

  constructor(p: number = DEFAULT_P) {
    if (p < LOWER_P_BOUND || p > UPPER_P_BOUND) {
      throw new Error('Precision (p) outside valid range [4..16].');
    }
    this.m = 1 << p;
    this.encoder = new SparseHyperLogLogEncoder(p);
  }

  estimate(): number {
    if (this.cachedEstimate === null) {
      this.cachedEstimate = this.encoder.estimate();
    }
    return this.cachedEstimate;
  }

  add(hash: number): void {
    this.convertToDenseIfNeeded();
    const changed = this.encoder.add(hash);
    if (changed) {
      this.cachedEstimate = null;
    }
  }

  addAll(hashes: number[]): void {
    for (const hash of hashes) {
      this.add(hash);
    }
  }

  merge(other: HyperLogLog): void {
    if (!(other instanceof HyperLogLogImpl)) {
      throw new Error(`Can't merge ${other} into ${this}`);
    }
    this.encoder = this.encoder.merge((other as HyperLogLogImpl).encoder);
    this.cachedEstimate = null;
  }

  private convertToDenseIfNeeded(): void {
    const shouldConvert =
      this.encoder.getEncodingType() === HyperLogLogEncoding.SPARSE &&
      this.encoder.getMemoryFootprint() >= this.m;
    if (shouldConvert) {
      this.encoder = (this.encoder as SparseHyperLogLogEncoder).asDense();
    }
  }
}
