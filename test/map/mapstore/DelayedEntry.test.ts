import { addedEntry, DelayedEntryType, deletedEntry } from '@zenystx/helios-core/map/impl/mapstore/writebehind/DelayedEntry';
import { describe, expect, test } from 'bun:test';

describe('DelayedEntry', () => {
  test('addedEntry() sets type=ADD and value', () => {
    const entry = addedEntry('key', 'value', 1000);
    expect(entry.type).toBe(DelayedEntryType.ADD);
    expect(entry.key).toBe('key');
    expect(entry.value).toBe('value');
    expect(entry.storeTime).toBe(1000);
  });

  test('deletedEntry() sets type=DELETE and value=null', () => {
    const entry = deletedEntry('key', 2000);
    expect(entry.type).toBe(DelayedEntryType.DELETE);
    expect(entry.key).toBe('key');
    expect(entry.value).toBeNull();
    expect(entry.storeTime).toBe(2000);
  });

  test('sequence is monotonically increasing', () => {
    const e1 = addedEntry('a', 'x', 0);
    const e2 = addedEntry('b', 'y', 0);
    const e3 = deletedEntry('c', 0);
    expect(e2.sequence).toBeGreaterThan(e1.sequence);
    expect(e3.sequence).toBeGreaterThan(e2.sequence);
  });
});
