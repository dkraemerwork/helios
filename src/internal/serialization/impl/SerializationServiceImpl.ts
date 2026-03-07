/**
 * Port of {@code com.hazelcast.internal.serialization.impl.AbstractSerializationService}
 * and {@code SerializationServiceV1}.
 *
 * Production implementation of InternalSerializationService with full dispatch chain,
 * BufferPool wiring, and DataSerializerHook registration.
 */
import { Bits } from '@zenystx/helios-core/internal/nio/Bits';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import { BufferPool } from '@zenystx/helios-core/internal/serialization/impl/bufferpool/BufferPool';
import { ByteArrayObjectDataInput, type ByteOrder } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataInput';
import { ByteArrayObjectDataOutput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataOutput';
import { HazelcastSerializationError } from '@zenystx/helios-core/internal/serialization/impl/HazelcastSerializationError';
import { HeapData } from '@zenystx/helios-core/internal/serialization/impl/HeapData';
import { SerializationConfig } from '@zenystx/helios-core/internal/serialization/impl/SerializationConfig';
import { SerializationConstants } from '@zenystx/helios-core/internal/serialization/impl/SerializationConstants';
import type { SerializerAdapter } from '@zenystx/helios-core/internal/serialization/impl/SerializerAdapter';
import type { InternalSerializationService } from '@zenystx/helios-core/internal/serialization/InternalSerializationService';

// ── Built-in serializers ──
import { BooleanArraySerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/BooleanArraySerializer';
import { BooleanSerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/BooleanSerializer';
import { ByteArraySerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/ByteArraySerializer';
import { ByteSerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/ByteSerializer';
import { CharArraySerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/CharArraySerializer';
import { CharSerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/CharSerializer';
import { DataSerializableSerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/DataSerializableSerializer';
import { DoubleArraySerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/DoubleArraySerializer';
import { DoubleSerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/DoubleSerializer';
import { FloatArraySerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/FloatArraySerializer';
import { FloatSerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/FloatSerializer';
import { IntegerArraySerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/IntegerArraySerializer';
import { IntegerSerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/IntegerSerializer';
import { JavaScriptJsonSerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/JavaScriptJsonSerializer';
import { LongArraySerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/LongArraySerializer';
import { LongSerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/LongSerializer';
import { NullSerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/NullSerializer';
import { ShortArraySerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/ShortArraySerializer';
import { ShortSerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/ShortSerializer';
import { StringArraySerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/StringArraySerializer';
import { StringSerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/StringSerializer';
import { UuidSerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/UuidSerializer';

export class SerializationServiceImpl implements InternalSerializationService {
    private readonly byteOrder: ByteOrder;
    private readonly constantSerializers: (SerializerAdapter | null)[];
    private readonly specialSerializers: Map<number, SerializerAdapter>;
    private readonly customSerializers: Map<number, SerializerAdapter>;
    private readonly bufferPool: BufferPool;
    private readonly dataSerializableSerializer: DataSerializableSerializer;

    constructor(config: SerializationConfig = new SerializationConfig()) {
        this.byteOrder = config.byteOrder;

        // Build constant serializer array indexed by -typeId (0..56)
        this.constantSerializers = new Array<SerializerAdapter | null>(
            SerializationConstants.CONSTANT_SERIALIZERS_LENGTH,
        ).fill(null);

        const register = (s: SerializerAdapter): void => {
            const idx = -s.getTypeId();
            if (idx >= 0 && idx < this.constantSerializers.length) {
                this.constantSerializers[idx] = s;
            }
        };

        register(NullSerializer);
        register(BooleanSerializer);
        register(ByteSerializer);
        register(CharSerializer);
        register(ShortSerializer);
        register(IntegerSerializer);
        register(LongSerializer);
        register(FloatSerializer);
        register(DoubleSerializer);
        register(StringSerializer);
        register(ByteArraySerializer);
        register(BooleanArraySerializer);
        register(CharArraySerializer);
        register(ShortArraySerializer);
        register(IntegerArraySerializer);
        register(LongArraySerializer);
        register(FloatArraySerializer);
        register(DoubleArraySerializer);
        register(StringArraySerializer);
        register(UuidSerializer);

        this.dataSerializableSerializer = new DataSerializableSerializer();
        register(this.dataSerializableSerializer);

        // Language-specific serializers (typeId < -56)
        this.specialSerializers = new Map<number, SerializerAdapter>();
        this.specialSerializers.set(JavaScriptJsonSerializer.getTypeId(), JavaScriptJsonSerializer);

        // User-defined serializers (typeId > 0) — empty for now
        this.customSerializers = new Map<number, SerializerAdapter>();

        // BufferPool
        this.bufferPool = new BufferPool(this, this.byteOrder);

        // Register factories from config (user-provided)
        for (const [factoryId, factory] of config.dataSerializableFactories) {
            this.dataSerializableSerializer.registerFactory(factoryId, factory);
        }

        // Register factories from hooks (subsystem-provided)
        for (const hook of config.dataSerializerHooks) {
            this.dataSerializableSerializer.registerFactory(
                hook.getFactoryId(), hook.createFactory(),
            );
        }
    }

    toData(obj: unknown): Data | null {
        if (obj == null) return null;
        if (obj instanceof HeapData) return obj;

        const adapter = this.serializerFor(obj);
        const out = this.bufferPool.takeOutputBuffer();
        try {
            out.writeInt(0);                       // partitionHash = 0
            out.writeInt(adapter.getTypeId());     // typeId
            adapter.write(out, obj);               // payload
            return new HeapData(out.toByteArray());
        } finally {
            this.bufferPool.returnOutputBuffer(out);
        }
    }

    toObject<T>(data: Data | null): T | null {
        if (data == null) return null;
        const bytes = data.toByteArray();
        if (bytes == null || bytes.length === 0) return null;
        const typeId = data.getType();
        if (typeId === SerializationConstants.CONSTANT_TYPE_NULL) return null;
        const adapter = this.serializerForTypeId(typeId);
        const inp = this.bufferPool.takeInputBuffer(data);
        try {
            return adapter.read(inp) as T;
        } finally {
            this.bufferPool.returnInputBuffer(inp);
        }
    }

    writeObject(out: ByteArrayObjectDataOutput, obj: unknown): void {
        if (obj instanceof HeapData) {
            throw new HazelcastSerializationError(
                'Cannot writeObject a Data instance — use writeData() instead',
            );
        }
        const adapter = this.serializerFor(obj);
        out.writeInt(adapter.getTypeId());
        adapter.write(out, obj);
    }

    readObject<T>(inp: ByteArrayObjectDataInput, _aClass?: unknown, useBigEndianForTypeId = false): T {
        let typeId: number;
        if (useBigEndianForTypeId) {
            // Read 4 bytes in BIG_ENDIAN regardless of stream byte order
            const p = inp.pos;
            inp.checkAvailable(p, Bits.INT_SIZE_IN_BYTES);
            typeId = Bits.readInt(inp.data!, p, true);
            inp.pos = p + Bits.INT_SIZE_IN_BYTES;
        } else {
            typeId = inp.readInt();
        }
        const adapter = this.serializerForTypeId(typeId);
        return adapter.read(inp) as T;
    }

    getClassLoader(): null {
        return null;
    }

    /** N19 FIX: drain buffer pool on shutdown. */
    destroy(): void {
        this.bufferPool.clear();
    }

    // ── Private dispatch ──

    private serializerFor(obj: unknown): SerializerAdapter {
        // 1. null / undefined
        if (obj == null) return NullSerializer;

        // 2. HeapData — should not reach here (caught in toData), but guard
        if (obj instanceof HeapData) {
            throw new HazelcastSerializationError(
                'Cannot serialize a Data instance — use writeData() instead',
            );
        }

        // 3. number
        if (typeof obj === 'number') {
            if (Object.is(obj, -0)) return DoubleSerializer;
            if (Number.isInteger(obj)) {
                if (obj >= -2147483648 && obj <= 2147483647) return IntegerSerializer;
                return LongSerializer;
            }
            return DoubleSerializer;
        }

        // 4. bigint
        if (typeof obj === 'bigint') return LongSerializer;

        // 5. boolean
        if (typeof obj === 'boolean') return BooleanSerializer;

        // 6. string
        if (typeof obj === 'string') return StringSerializer;

        // 7. Buffer (N8 FIX: Buffer.isBuffer, NOT instanceof Uint8Array)
        if (Buffer.isBuffer(obj)) return ByteArraySerializer;

        // 8. IdentifiedDataSerializable duck-type (before array check)
        if (isIdentifiedDataSerializable(obj)) return this.dataSerializableSerializer;

        // 9. Array
        if (Array.isArray(obj)) return this.arraySerializer(obj);

        // 10. Fallback — JSON
        return JavaScriptJsonSerializer;
    }

    private arraySerializer(arr: unknown[]): SerializerAdapter {
        if (arr.length === 0) return JavaScriptJsonSerializer;
        if (arr.some(el => el == null)) return JavaScriptJsonSerializer;

        const first = arr[0];
        if (typeof first === 'boolean') {
            if (arr.every(el => typeof el === 'boolean')) return BooleanArraySerializer;
            return JavaScriptJsonSerializer;
        }
        if (typeof first === 'bigint') {
            if (arr.every(el => typeof el === 'bigint')) return LongArraySerializer;
            return JavaScriptJsonSerializer;
        }
        if (typeof first === 'number') {
            if (arr.every(el => typeof el === 'number')) {
                if (arr.every(el => Number.isInteger(el as number) && (el as number) >= -2147483648 && (el as number) <= 2147483647)) {
                    return IntegerArraySerializer;
                }
                return DoubleArraySerializer;
            }
            return JavaScriptJsonSerializer;
        }
        if (typeof first === 'string') {
            if (arr.every(el => typeof el === 'string')) return StringArraySerializer;
            return JavaScriptJsonSerializer;
        }
        return JavaScriptJsonSerializer;
    }

    private serializerForTypeId(typeId: number): SerializerAdapter {
        let adapter: SerializerAdapter | null | undefined;
        if (typeId <= 0) {
            const index = -typeId;
            if (index < this.constantSerializers.length) {
                adapter = this.constantSerializers[index] ?? undefined;
            }
        }
        if (!adapter) {
            adapter = this.specialSerializers.get(typeId);
        }
        if (!adapter) {
            adapter = this.customSerializers.get(typeId);
        }
        if (!adapter) {
            throw new HazelcastSerializationError(
                `No suitable deserializer for typeId ${typeId}. ` +
                'This is likely caused by serialization configuration differences between nodes.',
            );
        }
        return adapter;
    }
}

function isIdentifiedDataSerializable(obj: unknown): boolean {
    if (typeof obj !== 'object' || obj === null) return false;
    const o = obj as Record<string, unknown>;
    return typeof o.getFactoryId === 'function'
        && typeof o.getClassId === 'function'
        && typeof o.writeData === 'function'
        && typeof o.readData === 'function';
}
