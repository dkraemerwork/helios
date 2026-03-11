/**
 * Port of {@code com.hazelcast.internal.serialization.impl.compact.SchemaService}.
 *
 * Manages Compact serialization schemas:
 *  - In-memory schema cache keyed by schema ID (64-bit Rabin fingerprint)
 *  - Schema registration (local and cluster-wide replication)
 *  - Schema lookup (local first, then optionally fetched from the cluster)
 *
 * Schema ID algorithm:
 *   Hazelcast uses a 64-bit Rabin fingerprint over the canonical schema
 *   representation: typeName + sorted field descriptors.
 *
 * Reference: com.hazelcast.internal.serialization.impl.compact.RabinFingerprint
 */

import { FieldKind } from '@zenystx/helios-core/internal/serialization/GenericRecord';

export function compactFieldKindToWire(kind: FieldKind): number {
    switch (kind) {
        case FieldKind.NOT_AVAILABLE:
        case FieldKind.BOOLEAN:
        case FieldKind.ARRAY_OF_BOOLEAN:
        case FieldKind.INT8:
        case FieldKind.ARRAY_OF_INT8:
            return kind;
        case FieldKind.INT16: return 7;
        case FieldKind.ARRAY_OF_INT16: return 8;
        case FieldKind.INT32: return 9;
        case FieldKind.ARRAY_OF_INT32: return 10;
        case FieldKind.INT64: return 11;
        case FieldKind.ARRAY_OF_INT64: return 12;
        case FieldKind.FLOAT32: return 13;
        case FieldKind.ARRAY_OF_FLOAT32: return 14;
        case FieldKind.FLOAT64: return 15;
        case FieldKind.ARRAY_OF_FLOAT64: return 16;
        case FieldKind.STRING: return 17;
        case FieldKind.ARRAY_OF_STRING: return 18;
        case FieldKind.DECIMAL: return 19;
        case FieldKind.ARRAY_OF_DECIMAL: return 20;
        case FieldKind.TIME: return 21;
        case FieldKind.ARRAY_OF_TIME: return 22;
        case FieldKind.DATE: return 23;
        case FieldKind.ARRAY_OF_DATE: return 24;
        case FieldKind.TIMESTAMP: return 25;
        case FieldKind.ARRAY_OF_TIMESTAMP: return 26;
        case FieldKind.TIMESTAMP_WITH_TIMEZONE: return 27;
        case FieldKind.ARRAY_OF_TIMESTAMP_WITH_TIMEZONE: return 28;
        case FieldKind.COMPACT: return 29;
        case FieldKind.ARRAY_OF_COMPACT: return 30;
        case FieldKind.NULLABLE_BOOLEAN: return 33;
        case FieldKind.ARRAY_OF_NULLABLE_BOOLEAN: return 34;
        case FieldKind.NULLABLE_INT8: return 35;
        case FieldKind.ARRAY_OF_NULLABLE_INT8: return 36;
        case FieldKind.NULLABLE_INT16: return 37;
        case FieldKind.ARRAY_OF_NULLABLE_INT16: return 38;
        case FieldKind.NULLABLE_INT32: return 39;
        case FieldKind.ARRAY_OF_NULLABLE_INT32: return 40;
        case FieldKind.NULLABLE_INT64: return 41;
        case FieldKind.ARRAY_OF_NULLABLE_INT64: return 42;
        case FieldKind.NULLABLE_FLOAT32: return 43;
        case FieldKind.ARRAY_OF_NULLABLE_FLOAT32: return 44;
        case FieldKind.NULLABLE_FLOAT64: return 45;
        case FieldKind.ARRAY_OF_NULLABLE_FLOAT64: return 46;
        default:
            return kind;
    }
}

export function compactFieldKindFromWire(kind: number): FieldKind {
    switch (kind) {
        case 0:
        case 1:
        case 2:
        case 3:
        case 4:
            return kind as FieldKind;
        case 7: return FieldKind.INT16;
        case 8: return FieldKind.ARRAY_OF_INT16;
        case 9: return FieldKind.INT32;
        case 10: return FieldKind.ARRAY_OF_INT32;
        case 11: return FieldKind.INT64;
        case 12: return FieldKind.ARRAY_OF_INT64;
        case 13: return FieldKind.FLOAT32;
        case 14: return FieldKind.ARRAY_OF_FLOAT32;
        case 15: return FieldKind.FLOAT64;
        case 16: return FieldKind.ARRAY_OF_FLOAT64;
        case 17: return FieldKind.STRING;
        case 18: return FieldKind.ARRAY_OF_STRING;
        case 19: return FieldKind.DECIMAL;
        case 20: return FieldKind.ARRAY_OF_DECIMAL;
        case 21: return FieldKind.TIME;
        case 22: return FieldKind.ARRAY_OF_TIME;
        case 23: return FieldKind.DATE;
        case 24: return FieldKind.ARRAY_OF_DATE;
        case 25: return FieldKind.TIMESTAMP;
        case 26: return FieldKind.ARRAY_OF_TIMESTAMP;
        case 27: return FieldKind.TIMESTAMP_WITH_TIMEZONE;
        case 28: return FieldKind.ARRAY_OF_TIMESTAMP_WITH_TIMEZONE;
        case 29: return FieldKind.COMPACT;
        case 30: return FieldKind.ARRAY_OF_COMPACT;
        case 33: return FieldKind.NULLABLE_BOOLEAN;
        case 34: return FieldKind.ARRAY_OF_NULLABLE_BOOLEAN;
        case 35: return FieldKind.NULLABLE_INT8;
        case 36: return FieldKind.ARRAY_OF_NULLABLE_INT8;
        case 37: return FieldKind.NULLABLE_INT16;
        case 38: return FieldKind.ARRAY_OF_NULLABLE_INT16;
        case 39: return FieldKind.NULLABLE_INT32;
        case 40: return FieldKind.ARRAY_OF_NULLABLE_INT32;
        case 41: return FieldKind.NULLABLE_INT64;
        case 42: return FieldKind.ARRAY_OF_NULLABLE_INT64;
        case 43: return FieldKind.NULLABLE_FLOAT32;
        case 44: return FieldKind.ARRAY_OF_NULLABLE_FLOAT32;
        case 45: return FieldKind.NULLABLE_FLOAT64;
        case 46: return FieldKind.ARRAY_OF_NULLABLE_FLOAT64;
        default:
            return kind as FieldKind;
    }
}

// ── Schema ───────────────────────────────────────────────────────────────────

export interface SchemaField {
    readonly fieldName: string;
    readonly kind: FieldKind;
    offset?: number;
    bitOffset?: number;
    index?: number;
}

/**
 * Immutable descriptor for a Compact-serialized type.
 * The schema ID is a 64-bit Rabin fingerprint derived from
 * the type name and all field names + kinds.
 */
export class Schema {
    readonly typeName: string;
    readonly fields: ReadonlyArray<SchemaField>;
    readonly schemaId: bigint;
    readonly fixedSizeFieldsLength: number;
    readonly numberVarSizeFields: number;

    /** Pre-built name→index map for O(1) field lookup. */
    private readonly _fieldIndex: ReadonlyMap<string, number>;

    constructor(typeName: string, fields: SchemaField[]) {
        this.typeName = typeName;
        // Fields sorted by name, matching Hazelcast Java ordering
        const sorted = [...fields].sort((a, b) => a.fieldName.localeCompare(b.fieldName));
        const { fixedSizeFieldsLength, numberVarSizeFields } = initializeSchemaFields(sorted);
        this.fields = sorted;
        this.schemaId = SchemaIdCalculator.fingerprint(typeName, sorted);
        this.fixedSizeFieldsLength = fixedSizeFieldsLength;
        this.numberVarSizeFields = numberVarSizeFields;
        const idx = new Map<string, number>();
        for (let i = 0; i < sorted.length; i++) {
            idx.set(sorted[i].fieldName, i);
        }
        this._fieldIndex = idx;
    }

    getField(fieldName: string): SchemaField | undefined {
        const i = this._fieldIndex.get(fieldName);
        return i !== undefined ? this.fields[i] : undefined;
    }

    hasField(fieldName: string): boolean {
        return this._fieldIndex.has(fieldName);
    }

    getFieldIndex(fieldName: string): number {
        const i = this._fieldIndex.get(fieldName);
        if (i === undefined) {
            throw new Error(`Field '${fieldName}' not found in schema '${this.typeName}'`);
        }
        return i;
    }

    getFieldCount(): number {
        return this.fields.length;
    }
}

function initializeSchemaFields(fields: SchemaField[]): { fixedSizeFieldsLength: number; numberVarSizeFields: number } {
    const fixedSizeFields: SchemaField[] = [];
    const booleanFields: SchemaField[] = [];
    const variableSizeFields: SchemaField[] = [];

    for (const field of fields) {
        if (kindSizeInBytes(field.kind) === -1) {
            variableSizeFields.push(field);
        } else if (field.kind === FieldKind.BOOLEAN) {
            booleanFields.push(field);
        } else {
            fixedSizeFields.push(field);
        }
    }

    fixedSizeFields.sort((left, right) => kindSizeInBytes(right.kind) - kindSizeInBytes(left.kind));

    let offset = 0;
    for (const field of fixedSizeFields) {
        field.offset = offset;
        offset += kindSizeInBytes(field.kind);
    }

    let bitOffset = 0;
    for (const field of booleanFields) {
        field.offset = offset;
        field.bitOffset = bitOffset % 8;
        bitOffset += 1;
        if (bitOffset % 8 === 0) {
            offset += 1;
        }
    }

    if (bitOffset % 8 !== 0) {
        offset += 1;
    }

    for (let index = 0; index < variableSizeFields.length; index++) {
        variableSizeFields[index]!.index = index;
    }

    return { fixedSizeFieldsLength: offset, numberVarSizeFields: variableSizeFields.length };
}

function kindSizeInBytes(kind: FieldKind): number {
    switch (kind) {
        case FieldKind.BOOLEAN:
            return 0;
        case FieldKind.INT8:
            return 1;
        case FieldKind.INT16:
            return 2;
        case FieldKind.INT32:
        case FieldKind.FLOAT32:
            return 4;
        case FieldKind.INT64:
        case FieldKind.FLOAT64:
            return 8;
        default:
            return -1;
    }
}

// ── SchemaBuilder ─────────────────────────────────────────────────────────────

export class SchemaBuilder {
    private readonly _typeName: string;
    private readonly _fields: SchemaField[] = [];

    constructor(typeName: string) {
        this._typeName = typeName;
    }

    addField(fieldName: string, kind: FieldKind): this {
        this._fields.push({ fieldName, kind });
        return this;
    }

    build(): Schema {
        return new Schema(this._typeName, this._fields);
    }
}

// ── Rabin fingerprint ─────────────────────────────────────────────────────────

/**
 * Port of {@code com.hazelcast.internal.serialization.impl.compact.RabinFingerprint}.
 *
 * Computes a 64-bit Rabin fingerprint using the same polynomial as Hazelcast Java:
 *   INIT = 0xc15d213aa4d7a795n
 *   For each byte b: fp = table[(fp ^ b) & 0xff] ^ (fp >> 8)
 *
 * The schema ID is computed over:
 *   typeName bytes (UTF-8) + for each field in sorted order:
 *     fieldName bytes (UTF-8) + kind byte
 */
const RABIN_INIT = 0xc15d213aa4d7a795n;

/** Pre-computed lookup table for the Rabin fingerprint. */
const RABIN_TABLE: bigint[] = (() => {
    const table: bigint[] = new Array(256);
    for (let i = 0; i < 256; i++) {
        let fp = BigInt(i);
        for (let j = 0; j < 8; j++) {
            if ((fp & 1n) !== 0n) {
                fp = (fp >> 1n) ^ RABIN_INIT;
            } else {
                fp >>= 1n;
            }
        }
        table[i] = BigInt.asUintN(64, fp);
    }
    return table;
})();

function rabinFingerprintByte(fp: bigint, b: number): bigint {
    const idx = Number((fp ^ BigInt(b)) & 0xffn);
    return BigInt.asUintN(64, RABIN_TABLE[idx] ^ (fp >> 8n));
}

function rabinFingerprintBuffer(fp: bigint, buf: Buffer): bigint {
    let f = fp;
    for (let i = 0; i < buf.length; i++) {
        f = rabinFingerprintByte(f, buf[i]);
    }
    return f;
}

function rabinFingerprintInt(fp: bigint, v: number): bigint {
    let f = fp;
    f = rabinFingerprintByte(f, (v) & 0xff);
    f = rabinFingerprintByte(f, (v >> 8) & 0xff);
    f = rabinFingerprintByte(f, (v >> 16) & 0xff);
    f = rabinFingerprintByte(f, (v >> 24) & 0xff);
    return f;
}

export const SchemaIdCalculator = {
    /**
     * Computes the 64-bit schema ID for the given type name and sorted fields.
     * Matches the algorithm in Hazelcast Java RabinFingerprint.fingerprint64().
     */
    fingerprint(typeName: string, fields: readonly SchemaField[]): bigint {
        let fp = RABIN_INIT;

        // Type name
        const typeNameBytes = Buffer.from(typeName, 'utf8');
        fp = rabinFingerprintInt(fp, typeNameBytes.length);
        fp = rabinFingerprintBuffer(fp, typeNameBytes);

        // Field count
        fp = rabinFingerprintInt(fp, fields.length);

        // Each field: name + kind
        for (const field of fields) {
            const nameBytes = Buffer.from(field.fieldName, 'utf8');
            fp = rabinFingerprintInt(fp, nameBytes.length);
            fp = rabinFingerprintBuffer(fp, nameBytes);
            fp = rabinFingerprintInt(fp, compactFieldKindToWire(field.kind));
        }

        return BigInt.asIntN(64, fp);
    },
};

// ── SchemaService ─────────────────────────────────────────────────────────────

/** Callback invoked when a schema needs to be fetched from the cluster. */
export type SchemaFetcher = (schemaId: bigint) => Promise<Schema | undefined>;

/** Callback invoked when a new schema should be replicated to cluster members. */
export type SchemaReplicator = (schema: Schema) => Promise<void>;

/**
 * In-memory schema cache with optional cluster integration.
 *
 * For server-side use:
 *   - On first serialization of a compact object, the schema is auto-registered
 *     locally and asynchronously replicated to all cluster members.
 *
 * For client-side use:
 *   - On encountering an unknown schema ID during deserialization, the schema
 *     is fetched from the server, cached, and deserialization retried.
 */
export class SchemaService {
    private readonly _schemas = new Map<bigint, Schema>();
    private readonly _fetcher: SchemaFetcher | undefined;
    private readonly _replicator: SchemaReplicator | undefined;

    constructor(fetcher?: SchemaFetcher, replicator?: SchemaReplicator) {
        this._fetcher = fetcher;
        this._replicator = replicator;
    }

    /**
     * Register a schema locally. If a replicator is configured, it is invoked
     * asynchronously (fire-and-forget; errors are ignored in this path).
     */
    registerSchema(schema: Schema): void {
        if (!this._schemas.has(schema.schemaId)) {
            this._schemas.set(schema.schemaId, schema);
            if (this._replicator) {
                void this._replicator(schema).catch(() => {
                    // Replication failures are non-fatal for local operation
                });
            }
        }
    }

    /** Returns a locally cached schema, or {@code undefined} if not found. */
    getSchema(schemaId: bigint): Schema | undefined {
        return this._schemas.get(schemaId);
    }

    /**
     * Returns a schema, fetching it from the cluster if necessary.
     * Throws if the schema is not found locally and no fetcher is configured,
     * or if the fetcher returns {@code undefined}.
     */
    async getSchemaAsync(schemaId: bigint): Promise<Schema> {
        const local = this._schemas.get(schemaId);
        if (local) return local;

        if (!this._fetcher) {
            throw new Error(
                `Schema not found locally for ID ${schemaId} and no fetcher is configured. ` +
                'Register the schema before deserializing, or configure a SchemaFetcher.',
            );
        }

        const fetched = await this._fetcher(schemaId);
        if (!fetched) {
            throw new Error(`Schema not found for ID ${schemaId}`);
        }
        this._schemas.set(fetched.schemaId, fetched);
        return fetched;
    }

    /** Whether a schema with the given ID is cached locally. */
    hasSchema(schemaId: bigint): boolean {
        return this._schemas.has(schemaId);
    }

    /** All locally cached schemas. */
    getAllSchemas(): ReadonlyMap<bigint, Schema> {
        return this._schemas;
    }

    /** Remove all cached schemas (primarily for testing). */
    clear(): void {
        this._schemas.clear();
    }
}
