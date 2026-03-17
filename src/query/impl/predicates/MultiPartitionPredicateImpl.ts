/**
 * Port of {@code com.hazelcast.query.impl.predicates.MultiPartitionPredicateImpl}.
 * Wraps a target predicate with multiple partition keys.
 */
import type { ByteArrayObjectDataInput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataInput';
import type { ByteArrayObjectDataOutput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataOutput';
import type { IdentifiedDataSerializable } from '@zenystx/helios-core/internal/serialization/impl/SerializationConfig';
import type { Predicate } from '../../Predicate';
import type { QueryableEntry } from '../QueryableEntry';

/** Factory ID for the predicate subsystem serializer hook. */
const PREDICATE_DS_FACTORY_ID = -20;
/** Class ID for MultiPartitionPredicateImpl. */
const MULTI_PARTITION_PREDICATE_CLASS_ID = 21;

export class MultiPartitionPredicateImpl<K = unknown, V = unknown> implements Predicate<K, V>, IdentifiedDataSerializable {
    private readonly _partitionKeys: Set<K>;
    private readonly _target: Predicate<K, V>;

    constructor(partitionKeys: Iterable<K>, target: Predicate<K, V>) {
        this._partitionKeys = new Set(partitionKeys);
        this._target = target;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    apply(_entry: QueryableEntry<K, V>): boolean {
        throw new Error('MultiPartitionPredicate is never evaluated directly — unwrap via getTarget() first');
    }

    getPartitionKeys(): K[] {
        return [...this._partitionKeys];
    }

    getTarget(): Predicate<K, V> {
        return this._target;
    }

    getFactoryId(): number {
        return PREDICATE_DS_FACTORY_ID;
    }

    getClassId(): number {
        return MULTI_PARTITION_PREDICATE_CLASS_ID;
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
        return `MultiPartitionPredicate{keys=${this._partitionKeys.size}, target=${String(this._target)}}`;
    }
}
