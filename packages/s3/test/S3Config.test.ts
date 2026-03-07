import { describe, expect, test } from 'bun:test';
import type { S3Config } from '../src/S3Config.js';
import { S3MapStore } from '../src/S3MapStore.js';

describe('S3Config defaults', () => {
  test('default suffix is .json', () => {
    const cfg: S3Config = { bucket: 'my-bucket' };
    // S3MapStore reads suffix with a default of '.json'
    const store = new S3MapStore(cfg);
    expect((store as any)._suffix).toBe('.json');
  });

  test('default serializer uses JSON.stringify / JSON.parse', () => {
    const cfg: S3Config = { bucket: 'my-bucket' };
    const store = new S3MapStore(cfg);
    const serializer = (store as any)._serializer;
    const obj = { hello: 'world', n: 42 };
    expect(JSON.parse(serializer.serialize(obj))).toEqual(obj);
    expect(serializer.deserialize(JSON.stringify(obj))).toEqual(obj);
  });
});
