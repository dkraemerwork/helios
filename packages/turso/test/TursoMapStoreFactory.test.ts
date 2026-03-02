import { describe, test, expect } from 'bun:test';
import { TursoMapStore } from '../src/TursoMapStore.js';

describe('TursoMapStore.factory()', () => {
  test('newMapStore("users") produces store with tableName "users"', async () => {
    const factory = TursoMapStore.factory({ url: ':memory:' });
    const store = factory.newMapStore('users', new Map()) as any;
    // tableName is set from config (before init)
    expect(store._config.tableName).toBe('users');
  });

  test('two stores from same factory with different mapNames use independent tables', async () => {
    const factory = TursoMapStore.factory({ url: ':memory:' });
    const usersStore = factory.newMapStore('users', new Map()) as any;
    const ordersStore = factory.newMapStore('orders', new Map()) as any;
    expect(usersStore._config.tableName).toBe('users');
    expect(ordersStore._config.tableName).toBe('orders');
    expect(usersStore._config.tableName).not.toBe(ordersStore._config.tableName);
  });
});
