import { describe, expect, test } from 'bun:test';
import { MongoPropertyResolver } from '../src/MongoPropertyResolver.js';

describe('MongoPropertyResolver', () => {
  test('resolves defaults when no properties are set', () => {
    const props = new Map<string, string>();
    const resolved = MongoPropertyResolver.resolve(props);

    expect(resolved.mode).toBe('document');
    expect(resolved.idColumn).toBe('_id');
    expect(resolved.externalName).toBeNull();
    expect(resolved.columns).toBeNull();
    expect(resolved.singleColumnAsValue).toBe(false);
    expect(resolved.replaceStrategy).toBe('updateOne');
    expect(resolved.loadAllKeys).toBe(true);
    expect(resolved.upsert).toBe(true);
  });

  test('resolves all supported properties from Map', () => {
    const props = new Map<string, string>([
      ['connection-string', 'mongodb://remote:27017'],
      ['database', 'mydb'],
      ['external-name', 'my_collection'],
      ['id-column', 'userId'],
      ['columns', 'name,email,age'],
      ['single-column-as-value', 'false'],
      ['replace-strategy', 'updateOne'],
      ['load-all-keys', 'false'],
      ['upsert', 'false'],
    ]);
    const resolved = MongoPropertyResolver.resolve(props);

    expect(resolved.connectionString).toBe('mongodb://remote:27017');
    expect(resolved.database).toBe('mydb');
    expect(resolved.externalName).toBe('my_collection');
    expect(resolved.idColumn).toBe('userId');
    expect(resolved.columns).toEqual(['name', 'email', 'age']);
    expect(resolved.singleColumnAsValue).toBe(false);
    expect(resolved.replaceStrategy).toBe('updateOne');
    expect(resolved.loadAllKeys).toBe(false);
    expect(resolved.upsert).toBe(false);
  });

  test('rejects mode=blob with fast-fail error', () => {
    const props = new Map<string, string>([['mode', 'blob']]);
    expect(() => MongoPropertyResolver.resolve(props)).toThrow(/blob.*not supported/i);
  });

  test('rejects single-column-as-value=true without exactly one non-id column', () => {
    const props = new Map<string, string>([
      ['single-column-as-value', 'true'],
      ['columns', 'name,email'],
    ]);
    expect(() => MongoPropertyResolver.resolve(props)).toThrow(/single-column-as-value.*exactly one/i);
  });

  test('allows single-column-as-value=true with exactly one column', () => {
    const props = new Map<string, string>([
      ['single-column-as-value', 'true'],
      ['columns', 'name'],
    ]);
    const resolved = MongoPropertyResolver.resolve(props);
    expect(resolved.singleColumnAsValue).toBe(true);
    expect(resolved.columns).toEqual(['name']);
  });

  test('rejects replaceStrategy=replaceOne when columns is set', () => {
    const props = new Map<string, string>([
      ['replace-strategy', 'replaceOne'],
      ['columns', 'name,email'],
    ]);
    expect(() => MongoPropertyResolver.resolve(props)).toThrow(/replaceOne.*columns/i);
  });

  test('requires replaceStrategy=updateOne when columns is set', () => {
    const props = new Map<string, string>([
      ['columns', 'name,email'],
    ]);
    const resolved = MongoPropertyResolver.resolve(props);
    expect(resolved.replaceStrategy).toBe('updateOne');
  });

  test('rejects invalid boolean property values', () => {
    const props = new Map<string, string>([['load-all-keys', 'yes']]);
    expect(() => MongoPropertyResolver.resolve(props)).toThrow(/load-all-keys.*true.*false/i);
  });

  test('rejects invalid replace-strategy values', () => {
    const props = new Map<string, string>([['replace-strategy', 'insertOne']]);
    expect(() => MongoPropertyResolver.resolve(props)).toThrow(/replace-strategy/i);
  });
});
