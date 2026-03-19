import type { CompactSerializable } from '@zenystx/helios-core/internal/serialization/compact/CompactSerializer';
import { SchemaService, type Schema } from '@zenystx/helios-core/internal/serialization/compact/SchemaService';
import {
    SerializationConfig,
    type CustomSerializer,
    type DataSerializableFactory,
    type StreamSerializer,
} from '@zenystx/helios-core/internal/serialization/impl/SerializationConfig';
import { SerializationConstants } from '@zenystx/helios-core/internal/serialization/impl/SerializationConstants';
import { SerializationServiceImpl } from '@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl';
import type { ClassDefinition, PortableFactory } from '@zenystx/helios-core/internal/serialization/portable/PortableSerializer';

export class HazelcastSerializationConfig extends SerializationConfig {}

export class HazelcastSerializationService extends SerializationServiceImpl {
    constructor(config: HazelcastSerializationConfig = new HazelcastSerializationConfig()) {
        super(config);
    }

    override registerPortableFactory(factoryId: number, factory: PortableFactory): void {
        super.registerPortableFactory(factoryId, factory);
    }

    override registerClassDefinition(classDefinition: ClassDefinition): void {
        super.registerClassDefinition(classDefinition);
    }

    override registerDataSerializableFactory(factoryId: number, factory: DataSerializableFactory): void {
        super.registerDataSerializableFactory(factoryId, factory);
    }

    override registerCompactSerializer<T>(serializer: CompactSerializable<T>): void {
        super.registerCompactSerializer(serializer);
    }

    override registerCustomSerializer(serializer: CustomSerializer): void {
        super.registerCustomSerializer(serializer);
    }

    registerSchema(schema: Schema): void {
        this.schemaService.registerSchema(schema);
    }
}

export { SchemaService };
export type { ClassDefinition, CompactSerializable, CustomSerializer, DataSerializableFactory, PortableFactory, Schema, StreamSerializer };

export const HazelcastTypeIds = {
    NULL: SerializationConstants.CONSTANT_TYPE_NULL,
    PORTABLE: SerializationConstants.CONSTANT_TYPE_PORTABLE,
    IDENTIFIED_DATA_SERIALIZABLE: SerializationConstants.CONSTANT_TYPE_DATA_SERIALIZABLE,
    BYTE: SerializationConstants.CONSTANT_TYPE_BYTE,
    BOOLEAN: SerializationConstants.CONSTANT_TYPE_BOOLEAN,
    CHAR: SerializationConstants.CONSTANT_TYPE_CHAR,
    SHORT: SerializationConstants.CONSTANT_TYPE_SHORT,
    INTEGER: SerializationConstants.CONSTANT_TYPE_INTEGER,
    LONG: SerializationConstants.CONSTANT_TYPE_LONG,
    FLOAT: SerializationConstants.CONSTANT_TYPE_FLOAT,
    DOUBLE: SerializationConstants.CONSTANT_TYPE_DOUBLE,
    STRING: SerializationConstants.CONSTANT_TYPE_STRING,
    BYTE_ARRAY: SerializationConstants.CONSTANT_TYPE_BYTE_ARRAY,
    BOOLEAN_ARRAY: SerializationConstants.CONSTANT_TYPE_BOOLEAN_ARRAY,
    CHAR_ARRAY: SerializationConstants.CONSTANT_TYPE_CHAR_ARRAY,
    SHORT_ARRAY: SerializationConstants.CONSTANT_TYPE_SHORT_ARRAY,
    INTEGER_ARRAY: SerializationConstants.CONSTANT_TYPE_INTEGER_ARRAY,
    LONG_ARRAY: SerializationConstants.CONSTANT_TYPE_LONG_ARRAY,
    FLOAT_ARRAY: SerializationConstants.CONSTANT_TYPE_FLOAT_ARRAY,
    DOUBLE_ARRAY: SerializationConstants.CONSTANT_TYPE_DOUBLE_ARRAY,
    STRING_ARRAY: SerializationConstants.CONSTANT_TYPE_STRING_ARRAY,
    UUID: SerializationConstants.CONSTANT_TYPE_UUID,
    LOCAL_DATE: SerializationConstants.JAVA_DEFAULT_TYPE_LOCALDATE,
    LOCAL_TIME: SerializationConstants.JAVA_DEFAULT_TYPE_LOCALTIME,
    LOCAL_DATE_TIME: SerializationConstants.JAVA_DEFAULT_TYPE_LOCALDATETIME,
    OFFSET_DATE_TIME: SerializationConstants.JAVA_DEFAULT_TYPE_OFFSETDATETIME,
    COMPACT: SerializationConstants.TYPE_COMPACT,
    COMPACT_WITH_SCHEMA: SerializationConstants.TYPE_COMPACT_WITH_SCHEMA,
    JSON: SerializationConstants.JAVASCRIPT_JSON_SERIALIZATION_TYPE,
} as const;
