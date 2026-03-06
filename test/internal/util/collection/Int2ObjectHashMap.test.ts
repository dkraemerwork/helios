import { describe, it, expect, beforeEach } from 'bun:test';
import { Int2ObjectHashMap } from '@zenystx/helios-core/internal/util/collection/Int2ObjectHashMap';

describe('Int2ObjectHashMapTest', () => {
  let map: Int2ObjectHashMap<string>;

  beforeEach(() => {
    map = new Int2ObjectHashMap();
  });

  it('shouldDoPutAndThenGet', () => {
    map.put(7, 'Seven');
    expect(map.get(7)).toEqual('Seven');
  });

  it('shouldReplaceExistingValueForTheSameKey', () => {
    map.put(7, 'Seven');
    const old = map.put(7, 'New Seven');
    expect(map.get(7)).toEqual('New Seven');
    expect(old).toEqual('Seven');
    expect(map.size()).toEqual(1);
  });

  it('shouldGrowWhenThresholdExceeded', () => {
    const m = new Int2ObjectHashMap<string>(32, 0.5);
    for (let i = 0; i < 16; i++) m.put(i, String(i));

    expect(m.resizeThreshold()).toEqual(16);
    expect(m.capacity()).toEqual(32);
    expect(m.size()).toEqual(16);

    m.put(16, '16');

    expect(m.resizeThreshold()).toEqual(32);
    expect(m.capacity()).toEqual(64);
    expect(m.size()).toEqual(17);
    expect(m.get(16)).toEqual('16');
    expect(Math.abs(m.loadFactor() - 0.5)).toBeLessThan(1e-9);
  });

  it('shouldHandleCollisionAndThenLinearProbe', () => {
    const m = new Int2ObjectHashMap<string>(32, 0.5);
    const key = 7;
    m.put(key, 'Seven');
    const collisionKey = key + m.capacity();
    m.put(collisionKey, String(collisionKey));
    expect(m.get(key)).toEqual('Seven');
    expect(m.get(collisionKey)).toEqual(String(collisionKey));
  });

  it('shouldClearCollection', () => {
    for (let i = 0; i < 15; i++) map.put(i, String(i));
    expect(map.size()).toEqual(15);
    map.clear();
    expect(map.size()).toEqual(0);
    expect(map.get(1)).toBeNull();
  });

  it('shouldContainValue', () => {
    map.put(7, 'Seven');
    expect(map.containsValue('Seven')).toBe(true);
    expect(map.containsValue('NoKey')).toBe(false);
  });

  it('shouldContainKey', () => {
    map.put(7, 'Seven');
    expect(map.containsKey(7)).toBe(true);
    expect(map.containsKey(0)).toBe(false);
  });

  it('shouldRemoveEntry', () => {
    map.put(7, 'Seven');
    expect(map.containsKey(7)).toBe(true);
    map.remove(7);
    expect(map.containsKey(7)).toBe(false);
  });

  it('shouldIterateValues', () => {
    const expected = new Set<string>();
    for (let i = 0; i < 11; i++) {
      map.put(i, String(i));
      expected.add(String(i));
    }
    const actual = new Set(map.values());
    expect(actual).toEqual(expected);
  });
});
