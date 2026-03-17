/**
 * Port of {@code com.hazelcast.query.impl.predicates.PartitionPredicateImpl}.
 * Wraps a target predicate with a single partition key, restricting query
 * execution to entries in that partition only.
 *
 * IMPORTANT: apply() throws UnsupportedOperationException — PartitionPredicate
 * is NEVER evaluated directly. The query engine must unwrap it first.
 */
import type { ByteArrayObjectDataInput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataInput';
import type { ByteArrayObjectDataOutput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataOutput';
import type { IdentifiedDataSerializable } from '@zenystx/helios-core/internal/serialization/impl/SerializationConfig';
import type { Predicate } from '../../Predicate';
import type { QueryableEntry } from '../QueryableEntry';

/** Factory ID for the predicate subsystem serializer hook. */
const PREDICATE_DS_FACTORY_ID = -20;
/** Class ID for PartitionPredicateImpl. */
const PARTITION_PREDICATE_CLASS_ID = 16;

export class PartitionPredicateImpl<K = unknown, V = unknown> implements Predicate<K, V>, IdentifiedDataSerializable {
    private readonly _partitionKey: K;
    private readonly _target: Predicate<K, V>;

    constructor(partitionKey: K, target: Predicate<K, V>) {
        this._partitionKey = partitionKey;
        this._target = target;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    apply(_entry: QueryableEntry<K, V>): boolean {
        throw new Error('PartitionPredicate is never evaluated directly — unwrap via getTarget() first');
    }

    getPartitionKey(): K {
        return this._partitionKey;
    }

    /** Returns an array containing the single partition key. */
    getPartitionKeys(): K[] {
        return [this._partitionKey];
    }

    getTarget(): Predicate<K, V> {
        return this._target;
    }

    getFactoryId(): number {
        return PREDICATE_DS_FACTORY_ID;
    }

    getClassId(): number {
        return PARTITION_PREDICATE_CLASS_ID;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    writeData(_out: ByteArrayObjectDataOutput): void {
        // Serialization not required for local query engine use
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    readData(_inp: ByteArrayObjectDataInput): void {
        // Deserialization not required for local query engine use
    }

    toString(): string {
        return `PartitionPredicate{partitionKey=${String(this._partitionKey)}, target=${String(this._target)}}`;
    }
}
