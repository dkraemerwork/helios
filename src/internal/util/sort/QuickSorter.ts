/**
 * Abstract base class for QuickSort implementations.
 * Port of com.hazelcast.internal.util.sort.QuickSorter (TypeScript-native version).
 */
export abstract class QuickSorter {
  sort(startIndex: number, length: number): void {
    this._quickSort(startIndex, length - 1);
  }

  protected abstract loadPivot(index: number): void;
  protected abstract isLessThanPivot(index: number): boolean;
  protected abstract isGreaterThanPivot(index: number): boolean;
  protected abstract swap(index1: number, index2: number): void;

  private _quickSort(lo: number, hi: number): void {
    if (lo >= hi) return;
    const p = this._partition(lo, hi);
    this._quickSort(lo, p);
    this._quickSort(p + 1, hi);
  }

  private _partition(lo: number, hi: number): number {
    this.loadPivot((lo + hi) >>> 1);
    let i = lo - 1;
    let j = hi + 1;
    while (true) {
      do { i++; } while (this.isLessThanPivot(i));
      do { j--; } while (this.isGreaterThanPivot(j));
      if (i >= j) return j;
      this.swap(i, j);
    }
  }
}

/** Concrete QuickSorter that operates on a plain number[] array. */
export class ArrayIntQuickSorter extends QuickSorter {
  private readonly array: number[];
  private pivot = 0;

  constructor(array: number[]) {
    super();
    this.array = array;
  }

  protected loadPivot(index: number): void {
    this.pivot = this.array[index];
  }

  protected isLessThanPivot(index: number): boolean {
    return this.array[index] < this.pivot;
  }

  protected isGreaterThanPivot(index: number): boolean {
    return this.array[index] > this.pivot;
  }

  protected swap(index1: number, index2: number): void {
    const tmp = this.array[index1];
    this.array[index1] = this.array[index2];
    this.array[index2] = tmp;
  }
}
