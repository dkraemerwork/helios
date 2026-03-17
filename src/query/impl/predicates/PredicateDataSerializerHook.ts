/**
 * Port of {@code com.hazelcast.query.impl.predicates.PredicateDataSerializerHook}.
 * Registers predicate IdentifiedDataSerializable factories.
 */
import type { DataSerializerHook } from '@zenystx/helios-core/internal/serialization/impl/DataSerializerHook';
import type { DataSerializableFactory } from '@zenystx/helios-core/internal/serialization/impl/SerializationConfig';
import { MultiPartitionPredicateImpl } from './MultiPartitionPredicateImpl';
import { PartitionPredicateImpl } from './PartitionPredicateImpl';
import { TruePredicate } from './TruePredicate';

export const PREDICATE_DS_FACTORY_ID = -20;
export const PARTITION_PREDICATE = 16;
export const MULTI_PARTITION_PREDICATE = 21;

export class PredicateDataSerializerHook implements DataSerializerHook {
    getFactoryId(): number {
        return PREDICATE_DS_FACTORY_ID;
    }

    createFactory(): DataSerializableFactory {
        return {
            create(classId: number) {
                switch (classId) {
                    case PARTITION_PREDICATE:
                        // Placeholder target — will be filled by deserialization
                        return new PartitionPredicateImpl(null, TruePredicate.INSTANCE);
                    case MULTI_PARTITION_PREDICATE:
                        return new MultiPartitionPredicateImpl([], TruePredicate.INSTANCE);
                    default:
                        throw new Error(`Unknown classId ${classId} for PredicateDataSerializerHook`);
                }
            },
        };
    }
}
