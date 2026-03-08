/**
 * Port of {@code com.hazelcast.nio.serialization.IdentifiedDataSerializable}.
 *
 * Provides a unified factory-registry that can be used outside the core
 * SerializationServiceImpl, e.g. by subsystem hooks that need to register
 * additional factories at runtime.
 *
 * The actual wire-format serialization is handled by
 * {@code DataSerializableSerializer} (typeId -2).  This module exposes:
 *  - The public {@link IdentifiedDataSerializable} interface alias
 *  - A standalone {@link IdentifiedDataSerializerRegistry} for ad-hoc use
 *  - A re-export of the existing {@link DataSerializableFactory} type
 */
import type { ByteArrayObjectDataInput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataInput';
import type { ByteArrayObjectDataOutput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataOutput';
import { HazelcastSerializationError } from '@zenystx/helios-core/internal/serialization/impl/HazelcastSerializationError';
import type { DataSerializableFactory, IdentifiedDataSerializable } from '@zenystx/helios-core/internal/serialization/impl/SerializationConfig';

// Re-export for external consumers
export type { DataSerializableFactory, IdentifiedDataSerializable };

// ── DataSerializable (plain, non-identified) ──────────────────────────────────

/** Plain DataSerializable — no factory/class IDs.  Non-identified form. */
export interface DataSerializable {
    writeData(out: ByteArrayObjectDataOutput): void;
    readData(inp: ByteArrayObjectDataInput): void;
}

// ── IdentifiedDataSerializerRegistry ─────────────────────────────────────────

/**
 * A standalone registry mapping (factoryId, classId) pairs to
 * {@link IdentifiedDataSerializable} instance factories.
 *
 * Subsystems that need to register factories without going through
 * {@link SerializationServiceImpl} can use this class directly and then
 * contribute it via a {@link DataSerializerHook}.
 */
export class IdentifiedDataSerializerRegistry {
    private readonly _factories = new Map<number, DataSerializableFactory>();

    /** Register a factory for the given {@code factoryId}. */
    registerFactory(factoryId: number, factory: DataSerializableFactory): void {
        if (this._factories.has(factoryId)) {
            throw new HazelcastSerializationError(
                `A DataSerializableFactory is already registered for factoryId=${factoryId}`,
            );
        }
        this._factories.set(factoryId, factory);
    }

    /** Returns the factory for {@code factoryId}, or {@code undefined} if none. */
    getFactory(factoryId: number): DataSerializableFactory | undefined {
        return this._factories.get(factoryId);
    }

    /** Creates a blank instance for deserialization. */
    create(factoryId: number, classId: number): IdentifiedDataSerializable {
        const factory = this._factories.get(factoryId);
        if (!factory) {
            throw new HazelcastSerializationError(
                `No DataSerializableFactory registered for factoryId=${factoryId}`,
            );
        }
        const obj = factory.create(classId);
        if (!obj) {
            throw new HazelcastSerializationError(
                `DataSerializableFactory for factoryId=${factoryId} returned null for classId=${classId}`,
            );
        }
        return obj;
    }

    /** Whether a factory has been registered for {@code factoryId}. */
    hasFactory(factoryId: number): boolean {
        return this._factories.has(factoryId);
    }

    /** Registered factory IDs. */
    getFactoryIds(): ReadonlySet<number> {
        return new Set(this._factories.keys());
    }
}

// ── Helper: write an IDS object directly ──────────────────────────────────────

/**
 * Writes an {@link IdentifiedDataSerializable} to the given output stream
 * using the standard Hazelcast wire format:
 *   [header:byte=0x01][factoryId:int][classId:int][payload...]
 */
export function writeIdentifiedDataSerializable(
    out: ByteArrayObjectDataOutput,
    obj: IdentifiedDataSerializable,
): void {
    out.writeByte(0x01); // identified flag
    out.writeInt(obj.getFactoryId());
    out.writeInt(obj.getClassId());
    obj.writeData(out);
}

/**
 * Reads an {@link IdentifiedDataSerializable} from the given input stream.
 * The header byte must already have been consumed and verified as 0x01.
 */
export function readIdentifiedDataSerializable(
    inp: ByteArrayObjectDataInput,
    registry: IdentifiedDataSerializerRegistry,
): IdentifiedDataSerializable {
    const factoryId = inp.readInt();
    const classId = inp.readInt();
    const obj = registry.create(factoryId, classId);
    obj.readData(inp);
    return obj;
}
