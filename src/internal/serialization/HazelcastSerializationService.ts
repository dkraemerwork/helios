/**
 * Central serialization service that handles ALL Hazelcast serialization formats.
 *
 * This is the Block-E entry point.  It extends {@link SerializationServiceImpl}
 * by adding:
 *   - Portable serialization (typeId -1) via {@link PortableSerializer}
 *   - Compact serialization (typeId -55) via {@link CompactStreamSerializer}
 *   - IdentifiedDataSerializable (typeId -2) — already in base class
 *   - Full type-ID registry consistent with the Hazelcast Java constants
 *
 * Type ID registry (Hazelcast canonical values):
 *
 *   NULL                         =   0
 *   PORTABLE                     =  -1
 *   IDENTIFIED_DATA_SERIALIZABLE =  -2
 *   BYTE                         =  -3
 *   BOOLEAN                      =  -4
 *   CHAR                         =  -5
 *   SHORT                        =  -6
 *   INTEGER                      =  -7
 *   LONG                         =  -8
 *   FLOAT                        =  -9
 *   DOUBLE                       = -10
 *   STRING                       = -11
 *   BYTE_ARRAY                   = -12
 *   BOOLEAN_ARRAY                = -13
 *   CHAR_ARRAY                   = -14
 *   SHORT_ARRAY                  = -15
 *   INTEGER_ARRAY                = -16
 *   LONG_ARRAY                   = -17
 *   FLOAT_ARRAY                  = -18
 *   DOUBLE_ARRAY                 = -19
 *   STRING_ARRAY                 = -20
 *   UUID                         = -21
 *   COMPACT                      = -55
 *   COMPACT_WITH_SCHEMA          = -56
 *   JSON (JavaScript)            = -130
 *
 * The above match {@link SerializationConstants} exactly.
 */

import { ByteArrayObjectDataInput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataInput';
import { SerializationConfig } from '@zenystx/helios-core/internal/serialization/impl/SerializationConfig';
import { SerializationConstants } from '@zenystx/helios-core/internal/serialization/impl/SerializationConstants';
import { SerializationServiceImpl } from '@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl';
import type { SerializerAdapter } from '@zenystx/helios-core/internal/serialization/impl/SerializerAdapter';
import {
    CompactStreamSerializer,
    type CompactSerializable,
} from '@zenystx/helios-core/internal/serialization/compact/CompactSerializer';
import { SchemaService } from '@zenystx/helios-core/internal/serialization/compact/SchemaService';
import {
    PortableRegistry,
    PortableSerializer,
    type Portable,
    type PortableFactory,
    type ClassDefinition,
} from '@zenystx/helios-core/internal/serialization/portable/PortableSerializer';
import type { DataSerializableFactory } from '@zenystx/helios-core/internal/serialization/impl/SerializationConfig';
import type { DataSerializerHook } from '@zenystx/helios-core/internal/serialization/impl/DataSerializerHook';

// ── HazelcastSerializationConfig ──────────────────────────────────────────────

export class HazelcastSerializationConfig extends SerializationConfig {
    /** Portable factories: factoryId → PortableFactory */
    portableFactories: Map<number, PortableFactory> = new Map();
    /** Pre-registered ClassDefinitions for Portable serialization. */
    classDefinitions: ClassDefinition[] = [];
    /** Default Portable version (used if no class-level version set). */
    portableVersion: number = 0;
    /** User-defined compact serializers. */
    compactSerializers: CompactSerializable<unknown>[] = [];
    /** Schema service (supply a custom one for cluster-aware schema exchange). */
    schemaService: SchemaService = new SchemaService();
}

// ── HazelcastSerializationService ────────────────────────────────────────────

/**
 * Full Hazelcast serialization service with all formats enabled.
 *
 * Usage:
 * ```ts
 * const config = new HazelcastSerializationConfig();
 * config.portableFactories.set(1, myPortableFactory);
 * config.compactSerializers.push(myCompactSerializer);
 *
 * const service = new HazelcastSerializationService(config);
 * const data = service.toData(myObject);
 * const obj  = service.toObject(data);
 * ```
 */
export class HazelcastSerializationService extends SerializationServiceImpl {
    readonly portableRegistry: PortableRegistry;
    readonly schemaService: SchemaService;
    readonly compactSerializer: CompactStreamSerializer;

    /** Extended type-ID dispatch: typeId → SerializerAdapter (for typeId < -23). */
    private readonly _extended = new Map<number, SerializerAdapter>();

    constructor(config: HazelcastSerializationConfig = new HazelcastSerializationConfig()) {
        super(config);

        // ── Portable ──────────────────────────────────────────────────────
        this.portableRegistry = new PortableRegistry();
        this.portableRegistry.portableVersion = config.portableVersion;

        for (const [factoryId, factory] of config.portableFactories) {
            this.portableRegistry.registerFactory(factoryId, factory);
        }
        for (const cd of config.classDefinitions) {
            this.portableRegistry.registerClassDefinition(cd);
        }

        const portableSerializer = new PortableSerializer(this.portableRegistry);
        this._extended.set(SerializationConstants.CONSTANT_TYPE_PORTABLE, portableSerializer);

        // ── Compact ───────────────────────────────────────────────────────
        this.schemaService = config.schemaService;
        this.compactSerializer = new CompactStreamSerializer(this.schemaService);

        for (const cs of config.compactSerializers) {
            this.compactSerializer.registerSerializer(cs as CompactSerializable<unknown>);
        }

        this._extended.set(SerializationConstants.TYPE_COMPACT, this.compactSerializer);
        this._extended.set(SerializationConstants.TYPE_COMPACT_WITH_SCHEMA, this.compactSerializer);
    }

    // ── Registration helpers ──────────────────────────────────────────────────

    /** Register a PortableFactory at runtime. */
    registerPortableFactory(factoryId: number, factory: PortableFactory): void {
        this.portableRegistry.registerFactory(factoryId, factory);
    }

    /** Register a ClassDefinition at runtime. */
    registerClassDefinition(cd: ClassDefinition): void {
        this.portableRegistry.registerClassDefinition(cd);
    }

    /** Register a DataSerializableFactory at runtime. */
    registerDataSerializableFactory(factoryId: number, factory: DataSerializableFactory): void {
        // Delegate to the base class's DataSerializableSerializer
        // by contributing a hook-like structure
        const hook: DataSerializerHook = {
            getFactoryId: () => factoryId,
            createFactory: () => factory,
        };
        this._applyHook(hook);
    }

    /** Register a CompactSerializable at runtime. */
    registerCompactSerializer<T>(serializer: CompactSerializable<T>): void {
        this.compactSerializer.registerSerializer(serializer);
    }

    // ── SerializerAdapter dispatch override ───────────────────────────────────

    /**
     * Overrides the base serializerForTypeId to also check the extended map.
     * The base class handles all constant type IDs (-1 through -23) and
     * language-specific type IDs (-130 etc.). We intercept before the base
     * throws for unknown IDs.
     */
    override readObject<T>(inp: ByteArrayObjectDataInput, aClass?: unknown, useBigEndianForTypeId = false): T {
        // Peek at typeId, check extended map first, then delegate to super
        const savedPos = inp.position();
        let typeId: number;
        if (useBigEndianForTypeId) {
            typeId = inp.readInt('BE');
        } else {
            typeId = inp.readInt();
        }

        const extended = this._extended.get(typeId);
        if (extended) {
            return extended.read(inp) as T;
        }

        // Restore position and let the base class handle it
        inp.position(savedPos);
        return super.readObject<T>(inp, aClass, useBigEndianForTypeId);
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private _applyHook(hook: DataSerializerHook): void {
        // Reach into the base class's dataSerializableSerializer
        // The base class exposes it through the public API indirectly;
        // we use the config-level approach by reconstructing with updated config.
        // Since we can't call the private base method directly, we add the factory
        // to the DataSerializableSerializer that was registered during construction.
        // The DataSerializableSerializer is accessible through the constant array
        // at index 2 (-(-2) = 2). We cast to access registerFactory.
        const adapter = this._getConstantSerializer(SerializationConstants.CONSTANT_TYPE_DATA_SERIALIZABLE);
        if (adapter && 'registerFactory' in adapter) {
            (adapter as { registerFactory(id: number, f: DataSerializableFactory): void })
                .registerFactory(hook.getFactoryId(), hook.createFactory());
        }
    }

    /** Access the constant serializer array (base class is package-private; we use casting). */
    private _getConstantSerializer(typeId: number): SerializerAdapter | null {
        // Access via the public readObject path with a fake input
        // Instead, expose the serializer through a helper input
        // In practice, the base SerializationServiceImpl exposes no accessor.
        // We type-cast for internal use only.
        type BaseInternal = { constantSerializers: (SerializerAdapter | null)[] };
        const base = this as unknown as BaseInternal;
        const idx = -typeId;
        return base.constantSerializers?.[idx] ?? null;
    }
}

// ── Type ID constants re-export for consumers ─────────────────────────────────

export const HazelcastTypeIds = {
    NULL:                          SerializationConstants.CONSTANT_TYPE_NULL,
    PORTABLE:                      SerializationConstants.CONSTANT_TYPE_PORTABLE,
    IDENTIFIED_DATA_SERIALIZABLE:  SerializationConstants.CONSTANT_TYPE_DATA_SERIALIZABLE,
    BYTE:                          SerializationConstants.CONSTANT_TYPE_BYTE,
    BOOLEAN:                       SerializationConstants.CONSTANT_TYPE_BOOLEAN,
    CHAR:                          SerializationConstants.CONSTANT_TYPE_CHAR,
    SHORT:                         SerializationConstants.CONSTANT_TYPE_SHORT,
    INTEGER:                       SerializationConstants.CONSTANT_TYPE_INTEGER,
    LONG:                          SerializationConstants.CONSTANT_TYPE_LONG,
    FLOAT:                         SerializationConstants.CONSTANT_TYPE_FLOAT,
    DOUBLE:                        SerializationConstants.CONSTANT_TYPE_DOUBLE,
    STRING:                        SerializationConstants.CONSTANT_TYPE_STRING,
    BYTE_ARRAY:                    SerializationConstants.CONSTANT_TYPE_BYTE_ARRAY,
    BOOLEAN_ARRAY:                 SerializationConstants.CONSTANT_TYPE_BOOLEAN_ARRAY,
    CHAR_ARRAY:                    SerializationConstants.CONSTANT_TYPE_CHAR_ARRAY,
    SHORT_ARRAY:                   SerializationConstants.CONSTANT_TYPE_SHORT_ARRAY,
    INTEGER_ARRAY:                 SerializationConstants.CONSTANT_TYPE_INTEGER_ARRAY,
    LONG_ARRAY:                    SerializationConstants.CONSTANT_TYPE_LONG_ARRAY,
    FLOAT_ARRAY:                   SerializationConstants.CONSTANT_TYPE_FLOAT_ARRAY,
    DOUBLE_ARRAY:                  SerializationConstants.CONSTANT_TYPE_DOUBLE_ARRAY,
    STRING_ARRAY:                  SerializationConstants.CONSTANT_TYPE_STRING_ARRAY,
    UUID:                          SerializationConstants.CONSTANT_TYPE_UUID,
    LOCAL_DATE:                    SerializationConstants.JAVA_DEFAULT_TYPE_LOCALDATE,
    LOCAL_TIME:                    SerializationConstants.JAVA_DEFAULT_TYPE_LOCALTIME,
    LOCAL_DATE_TIME:               SerializationConstants.JAVA_DEFAULT_TYPE_LOCALDATETIME,
    OFFSET_DATE_TIME:              SerializationConstants.JAVA_DEFAULT_TYPE_OFFSETDATETIME,
    COMPACT:                       SerializationConstants.TYPE_COMPACT,
    COMPACT_WITH_SCHEMA:           SerializationConstants.TYPE_COMPACT_WITH_SCHEMA,
    JSON:                          SerializationConstants.JAVASCRIPT_JSON_SERIALIZATION_TYPE,
} as const;
