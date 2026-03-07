import { describe, expect, test } from 'bun:test';
import { MongoMapStore } from '../src/MongoMapStore.js';

describe('MongoConfig defaults', () => {
  test('default serializer uses JSON.stringify / JSON.parse', () => {
    const store = new MongoMapStore({ uri: 'mongodb://localhost', database: 'testdb' });
    const serializer = (store as any)._serializer;
    const obj = { hello: 'world', n: 42 };
    expect(JSON.parse(serializer.serialize(obj))).toEqual(obj);
    expect(serializer.deserialize(JSON.stringify(obj))).toEqual(obj);
  });

  test('collection field is undefined when not provided in config', () => {
    const store = new MongoMapStore({ uri: 'mongodb://localhost', database: 'testdb' });
    expect((store as any)._collection).toBeUndefined();
  });
});
