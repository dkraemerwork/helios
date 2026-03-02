import { describe, it, expect } from 'bun:test';
import { ArrayIntQuickSorter } from '@helios/internal/util/sort/QuickSorter';

describe('QuickSorterTest', () => {
  it('testQuickSortInt', () => {
    const array = [5, 3, 8, 1, 9, 2, 7, 4, 6, 0];
    const sorter = new ArrayIntQuickSorter(array);
    sorter.sort(0, array.length);
    expect(array).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('testQuickSortLargeArray', () => {
    const n = 1000;
    const array: number[] = [];
    for (let i = n - 1; i >= 0; i--) array.push(i);
    const expected = [...array].sort((a, b) => a - b);
    const sorter = new ArrayIntQuickSorter(array);
    sorter.sort(0, array.length);
    expect(array).toEqual(expected);
  });
});
