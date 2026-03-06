/**
 * Port of {@code com.hazelcast.internal.serialization.SerializationService}.
 */
import type { Data } from '@zenystx/core/internal/serialization/Data';

export interface SerializationService {
    toData(obj: unknown): Data | null;
    toObject<T>(data: Data | null): T | null;
    writeObject(out: unknown, obj: unknown): void;
    readObject<T>(inp: unknown): T;
    getClassLoader(): unknown;
}
