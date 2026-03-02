export interface HyperLogLog {
  estimate(): number;
  add(hash: number): void;
  addAll(hashes: number[]): void;
  merge(other: HyperLogLog): void;
}
