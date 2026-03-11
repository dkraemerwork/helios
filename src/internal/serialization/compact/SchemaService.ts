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

// ── Schema ───────────────────────────────────────────────────────────────────

export interface SchemaField {
    readonly fieldName: string;
    readonly kind: FieldKind;
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

    /** Pre-built name→index map for O(1) field lookup. */
    private readonly _fieldIndex: ReadonlyMap<string, number>;

    constructor(typeName: string, fields: SchemaField[]) {
        this.typeName = typeName;
        // Fields sorted by name, matching Hazelcast Java ordering
        const sorted = [...fields].sort((a, b) => a.fieldName.localeCompare(b.fieldName));
        this.fields = sorted;
        this.schemaId = SchemaIdCalculator.fingerprint(typeName, sorted);
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
            fp = rabinFingerprintInt(fp, field.kind);
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
