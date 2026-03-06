import { describe, test, expect } from 'bun:test';
import { MongoDocumentMapper } from '../src/MongoDocumentMapper.js';

describe('MongoDocumentMapper', () => {
  test('toDocument maps object fields with default _id key', () => {
    const mapper = new MongoDocumentMapper({ idColumn: '_id' });
    const doc = mapper.toDocument('key1', { name: 'Alice', age: 30 });
    expect(doc).toEqual({ _id: 'key1', name: 'Alice', age: 30 });
  });

  test('fromDocument extracts value and key with default _id', () => {
    const mapper = new MongoDocumentMapper({ idColumn: '_id' });
    const result = mapper.fromDocument({ _id: 'key1', name: 'Alice', age: 30 });
    expect(result.key).toBe('key1');
    expect(result.value).toEqual({ name: 'Alice', age: 30 });
  });

  test('toDocument uses custom id-column', () => {
    const mapper = new MongoDocumentMapper({ idColumn: 'userId' });
    const doc = mapper.toDocument('u1', { name: 'Bob' });
    expect(doc).toEqual({ userId: 'u1', name: 'Bob' });
    expect(doc._id).toBeUndefined();
  });

  test('fromDocument uses custom id-column', () => {
    const mapper = new MongoDocumentMapper({ idColumn: 'userId' });
    const result = mapper.fromDocument({ userId: 'u1', name: 'Bob' });
    expect(result.key).toBe('u1');
    expect(result.value).toEqual({ name: 'Bob' });
  });

  test('null value maps to document with only key field', () => {
    const mapper = new MongoDocumentMapper({ idColumn: '_id' });
    const doc = mapper.toDocument('key1', null);
    expect(doc).toEqual({ _id: 'key1' });
  });

  test('undefined value maps to document with only key field', () => {
    const mapper = new MongoDocumentMapper({ idColumn: '_id' });
    const doc = mapper.toDocument('key1', undefined);
    expect(doc).toEqual({ _id: 'key1' });
  });

  test('fromDocument returns null value for document with only key field', () => {
    const mapper = new MongoDocumentMapper({ idColumn: '_id' });
    const result = mapper.fromDocument({ _id: 'key1' });
    expect(result.key).toBe('key1');
    expect(result.value).toBeNull();
  });

  test('column projection filters fields in toDocument', () => {
    const mapper = new MongoDocumentMapper({ idColumn: '_id', columns: ['name'] });
    const doc = mapper.toDocument('key1', { name: 'Alice', age: 30, email: 'a@b.com' });
    expect(doc).toEqual({ _id: 'key1', name: 'Alice' });
  });

  test('column projection filters fields in fromDocument', () => {
    const mapper = new MongoDocumentMapper({ idColumn: '_id', columns: ['name'] });
    const result = mapper.fromDocument({ _id: 'key1', name: 'Alice', age: 30, extra: true });
    expect(result.value).toEqual({ name: 'Alice' });
  });

  test('single-column-as-value stores scalar value directly', () => {
    const mapper = new MongoDocumentMapper({ idColumn: '_id', columns: ['name'], singleColumnAsValue: true });
    const doc = mapper.toDocument('key1', 'Alice');
    expect(doc).toEqual({ _id: 'key1', name: 'Alice' });
  });

  test('single-column-as-value loads scalar value directly', () => {
    const mapper = new MongoDocumentMapper({ idColumn: '_id', columns: ['name'], singleColumnAsValue: true });
    const result = mapper.fromDocument({ _id: 'key1', name: 'Alice' });
    expect(result.value).toBe('Alice');
  });

  test('toUpdateDoc generates $set for updateOne strategy', () => {
    const mapper = new MongoDocumentMapper({ idColumn: '_id', replaceStrategy: 'updateOne' });
    const update = mapper.toUpdateDoc({ name: 'Alice', age: 30 });
    expect(update).toEqual({ $set: { name: 'Alice', age: 30 } });
  });

  test('toUpdateDoc generates full replacement for replaceOne strategy', () => {
    const mapper = new MongoDocumentMapper({ idColumn: '_id', replaceStrategy: 'replaceOne' });
    const replacement = mapper.toUpdateDoc({ name: 'Alice', age: 30 });
    expect(replacement).toEqual({ name: 'Alice', age: 30 });
  });

  test('extra fields in document are preserved in fromDocument without column projection', () => {
    const mapper = new MongoDocumentMapper({ idColumn: '_id' });
    const result = mapper.fromDocument({ _id: 'key1', name: 'Alice', _internal: true });
    expect(result.value).toEqual({ name: 'Alice', _internal: true });
  });
});
