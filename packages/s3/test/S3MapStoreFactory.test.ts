import { describe, expect, test } from 'bun:test';
import { S3MapStore } from '../src/S3MapStore.js';

describe('S3MapStore.factory()', () => {
  test('newMapStore("users") produces store with prefix "users/"', () => {
    const factory = S3MapStore.factory({ bucket: 'my-bucket', region: 'us-east-1' });
    const store = factory.newMapStore('users', new Map()) as any;
    expect(store._prefix).toBe('users/');
  });

  test('two stores from same factory with different mapNames have independent prefixes', () => {
    const factory = S3MapStore.factory({ bucket: 'my-bucket', region: 'us-east-1' });
    const usersStore = factory.newMapStore('users', new Map()) as any;
    const ordersStore = factory.newMapStore('orders', new Map()) as any;
    expect(usersStore._prefix).toBe('users/');
    expect(ordersStore._prefix).toBe('orders/');
    expect(usersStore._prefix).not.toBe(ordersStore._prefix);
  });
});
