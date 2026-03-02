import { HyperLogLogEncoding } from './HyperLogLogEncoding';

export interface HyperLogLogEncoder {
  estimate(): number;
  add(hash: number): boolean;
  getMemoryFootprint(): number;
  getEncodingType(): HyperLogLogEncoding;
  merge(encoder: HyperLogLogEncoder): HyperLogLogEncoder;
}
