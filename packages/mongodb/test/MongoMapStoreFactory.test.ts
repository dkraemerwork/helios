import { describe, expect, test } from 'bun:test';
import { MongoMapStore } from '../src/MongoMapStore.js';

describe('MongoMapStore.factory()', () => {
  test('newMapStore("users") produces store with collection "users"', () => {
    const factory = MongoMapStore.factory({
      uri: 'mongodb://localhost:27017',
      database: 'testdb',
    });
    const store = factory.newMapStore('users', new Map()) as any;
    expect(store._collection).toBe('users');
  });

  test('two stores from same factory with different mapNames have independent collections', () => {
    const factory = MongoMapStore.factory({
      uri: 'mongodb://localhost:27017',
      database: 'testdb',
    });
    const usersStore = factory.newMapStore('users', new Map()) as any;
    const ordersStore = factory.newMapStore('orders', new Map()) as any;
    expect(usersStore._collection).toBe('users');
    expect(ordersStore._collection).toBe('orders');
    expect(usersStore._collection).not.toBe(ordersStore._collection);
  });
});
