import { describe, it, expect } from 'bun:test';
import { MutableInteger } from '@zenystx/core/internal/util/MutableInteger';

describe('MutableIntegerTest', () => {
  it('testGetAndInc', () => {
    const m = new MutableInteger(13);
    expect(m.getAndInc()).toEqual(13);
    expect(m.value).toEqual(14);
  });

  it('testAddAndGet', () => {
    const m = new MutableInteger(13);
    expect(m.addAndGet(11)).toEqual(24);
    expect(m.value).toEqual(24);
  });
});
