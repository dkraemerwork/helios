import { describe, it, expect } from 'bun:test';
import { MutableLong } from '@zenystx/helios-core/internal/util/MutableLong';

describe('MutableLongTest', () => {
  it('testAddAndGet', () => {
    const m = MutableLong.valueOf(13);
    expect(m.addAndGet(11)).toEqual(24);
    expect(m.value).toEqual(24);
  });

  it('testGetAndInc', () => {
    const m = MutableLong.valueOf(13);
    expect(m.getAndInc()).toEqual(13);
    expect(m.value).toEqual(14);
  });

  it('testToString', () => {
    const m = new MutableLong();
    expect(m.toString()).toEqual('MutableLong{value=0}');
  });

  it('testEquals', () => {
    expect(MutableLong.valueOf(0).equals(MutableLong.valueOf(0))).toBe(true);
    expect(MutableLong.valueOf(10).equals(MutableLong.valueOf(10))).toBe(true);
    expect(MutableLong.valueOf(0).equals(MutableLong.valueOf(10))).toBe(false);
    expect(MutableLong.valueOf(0).equals(null)).toBe(false);
    expect(MutableLong.valueOf(0).equals('foo')).toBe(false);
    const self = MutableLong.valueOf(0);
    expect(self.equals(self)).toBe(true);
  });

  it('testHash', () => {
    expect(MutableLong.valueOf(10).hashCode()).toEqual(MutableLong.valueOf(10).hashCode());
  });
});
