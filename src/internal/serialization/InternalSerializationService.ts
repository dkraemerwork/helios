/**
 * Port of {@code com.hazelcast.internal.serialization.InternalSerializationService}.
 */
import type { SerializationService } from '@helios/internal/serialization/SerializationService';
import type { Data } from '@helios/internal/serialization/Data';

export interface InternalSerializationService extends SerializationService {
    readObject<T>(inp: unknown, aClass?: unknown): T;
    toObject<T>(data: Data | null): T | null;
    getClassLoader(): unknown;
}
