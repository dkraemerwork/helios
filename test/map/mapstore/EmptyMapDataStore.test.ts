import { EmptyMapDataStore } from '@zenystx/helios-core/map/impl/mapstore/EmptyMapDataStore';
import { describe, expect, test } from 'bun:test';

describe('EmptyMapDataStore', () => {
  test('singleton identity — empty() returns same instance', () => {
    const a = EmptyMapDataStore.empty<string, string>();
    const b = EmptyMapDataStore.empty<string, string>();
    expect(a).toBe(b);
  });

  test('isWithStore() returns false', () => {
    expect(EmptyMapDataStore.empty().isWithStore()).toBe(false);
  });

  test('hasPendingWrites() returns false', () => {
    expect(EmptyMapDataStore.empty().hasPendingWrites()).toBe(false);
  });

  test('all async methods resolve without side effects', async () => {
    const store = EmptyMapDataStore.empty<string, string>();
    await store.add('k', 'v', Date.now());
    await store.remove('k', Date.now());
    const loaded = await store.load('k');
    expect(loaded).toBeNull();
    const loadedAll = await store.loadAll(['k1', 'k2']);
    expect(loadedAll.size).toBe(0);
    await store.flush();
    await store.clear();
  });
});
