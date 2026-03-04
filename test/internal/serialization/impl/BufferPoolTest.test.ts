import { describe, test, expect } from 'bun:test';
import { BufferPool } from '@helios/internal/serialization/impl/bufferpool/BufferPool';
import { ByteArrayObjectDataOutput } from '@helios/internal/serialization/impl/ByteArrayObjectDataOutput';
import { ByteArrayObjectDataInput } from '@helios/internal/serialization/impl/ByteArrayObjectDataInput';
import { HeapData } from '@helios/internal/serialization/impl/HeapData';
import { HazelcastSerializationError } from '@helios/internal/serialization/impl/HazelcastSerializationError';
import { SerializerAdapter } from '@helios/internal/serialization/impl/SerializerAdapter';
import { DataSerializerHook } from '@helios/internal/serialization/impl/DataSerializerHook';
import { SerializationConfig, type DataSerializableFactory } from '@helios/internal/serialization/impl/SerializationConfig';
import type { InternalSerializationService } from '@helios/internal/serialization/InternalSerializationService';
import type { Data } from '@helios/internal/serialization/Data';
import { BIG_ENDIAN, LITTLE_ENDIAN } from '@helios/internal/serialization/impl/ByteArrayObjectDataInput';

// Minimal stub for InternalSerializationService (only needed as constructor arg)
const stubService: InternalSerializationService = {
    toData: () => null,
    toObject: () => null,
    writeObject: () => { throw new Error('stub'); },
    readObject: () => { throw new Error('stub'); },
    getClassLoader: () => null,
};

describe('HazelcastSerializationError', () => {
    test('should be an instance of Error', () => {
        const err = new HazelcastSerializationError('test message');
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe('HazelcastSerializationError');
        expect(err.message).toBe('test message');
    });

    test('should capture cause when provided', () => {
        const cause = new TypeError('original');
        const err = new HazelcastSerializationError('wrapper', cause);
        expect(err.cause).toBe(cause);
    });

    test('should not set cause for non-Error cause', () => {
        const err = new HazelcastSerializationError('wrapper', 'string cause');
        expect(err.cause).toBeUndefined();
    });
});

describe('SerializerAdapter', () => {
    test('interface shape should be satisfied by object literal', () => {
        const adapter: SerializerAdapter = {
            getTypeId: () => -7,
            write: (_out, _obj) => {},
            read: (_inp) => 42,
        };
        expect(adapter.getTypeId()).toBe(-7);
        expect(adapter.read(null as any)).toBe(42);
    });
});

describe('DataSerializerHook', () => {
    test('interface shape should be satisfied by object literal', () => {
        const factory: DataSerializableFactory = {
            create: (_classId: number) => ({
                getFactoryId: () => 1,
                getClassId: () => 1,
                writeData: () => {},
                readData: () => {},
            }),
        };
        const hook: DataSerializerHook = {
            getFactoryId: () => 1,
            createFactory: () => factory,
        };
        expect(hook.getFactoryId()).toBe(1);
        expect(hook.createFactory()).toBe(factory);
    });
});

describe('SerializationConfig', () => {
    test('should have default BIG_ENDIAN byte order', () => {
        const config = new SerializationConfig();
        expect(config.byteOrder).toBe(BIG_ENDIAN);
    });

    test('should have empty factories and hooks by default', () => {
        const config = new SerializationConfig();
        expect(config.dataSerializableFactories.size).toBe(0);
        expect(config.dataSerializerHooks.length).toBe(0);
    });

    test('should allow setting byte order to LITTLE_ENDIAN', () => {
        const config = new SerializationConfig();
        config.byteOrder = LITTLE_ENDIAN;
        expect(config.byteOrder).toBe(LITTLE_ENDIAN);
    });
});

describe('BufferPool', () => {
    test('takeOutputBuffer should return a new buffer when pool is empty', () => {
        const pool = new BufferPool(stubService, BIG_ENDIAN);
        const out = pool.takeOutputBuffer();
        expect(out).toBeInstanceOf(ByteArrayObjectDataOutput);
    });

    test('returnOutputBuffer + takeOutputBuffer should reuse buffers', () => {
        const pool = new BufferPool(stubService, BIG_ENDIAN);
        const out1 = pool.takeOutputBuffer();
        pool.returnOutputBuffer(out1);
        const out2 = pool.takeOutputBuffer();
        expect(out2).toBe(out1);
    });

    test('should pool at most 3 output buffers', () => {
        const pool = new BufferPool(stubService, BIG_ENDIAN);
        const buffers = Array.from({ length: 5 }, () => pool.takeOutputBuffer());
        for (const b of buffers) pool.returnOutputBuffer(b);
        // Take 3 — all should be reused
        const reused = Array.from({ length: 3 }, () => pool.takeOutputBuffer());
        expect(reused.every(b => buffers.includes(b))).toBe(true);
        // 4th should be a new one
        const fresh = pool.takeOutputBuffer();
        expect(buffers.includes(fresh)).toBe(false);
    });

    test('takeInputBuffer should create input from Data', () => {
        const pool = new BufferPool(stubService, BIG_ENDIAN);
        // HeapData needs at least 8 bytes (4 partition hash + 4 type id)
        const payload = Buffer.alloc(12);
        payload.writeInt32BE(0, 0); // partition hash
        payload.writeInt32BE(-7, 4); // typeId
        payload.writeInt32BE(42, 8); // data
        const data = new HeapData(payload);
        const inp = pool.takeInputBuffer(data);
        expect(inp).toBeInstanceOf(ByteArrayObjectDataInput);
    });

    test('should reuse input buffers', () => {
        const pool = new BufferPool(stubService, BIG_ENDIAN);
        const payload = Buffer.alloc(12);
        const data = new HeapData(payload);
        const inp1 = pool.takeInputBuffer(data);
        pool.returnInputBuffer(inp1);
        const inp2 = pool.takeInputBuffer(data);
        expect(inp2).toBe(inp1);
    });

    test('clear should drain all pooled buffers', () => {
        const pool = new BufferPool(stubService, BIG_ENDIAN);
        const out = pool.takeOutputBuffer();
        pool.returnOutputBuffer(out);
        pool.clear();
        // After clear, next take should return a new buffer
        const out2 = pool.takeOutputBuffer();
        expect(out2).not.toBe(out);
    });

    test('returnOutputBuffer with null should be a no-op', () => {
        const pool = new BufferPool(stubService, BIG_ENDIAN);
        pool.returnOutputBuffer(null as any);
        // Should not throw — pool is still empty
        const out = pool.takeOutputBuffer();
        expect(out).toBeInstanceOf(ByteArrayObjectDataOutput);
    });
});
