/**
 * Minimal serialization service for unit tests.
 *
 * Uses JSON encoding with a 8-byte HeapData header
 * (type = JAVASCRIPT_JSON_SERIALIZATION_TYPE = -130).
 * Enough for tests that need real round-trip serialization without a full
 * production SerializationServiceImpl.
 */
import type { SerializationService } from '@zenystx/core/internal/serialization/SerializationService';
import type { Data } from '@zenystx/core/internal/serialization/Data';
import { HeapData } from '@zenystx/core/internal/serialization/impl/HeapData';
import { Bits } from '@zenystx/core/internal/nio/Bits';
import { SerializationConstants } from '@zenystx/core/internal/serialization/impl/SerializationConstants';

export class TestSerializationService implements SerializationService {
    toData(obj: unknown): Data | null {
        if (obj == null) return null;
        // If already a Data, return as-is.
        if (obj instanceof HeapData) return obj;

        const json = JSON.stringify(obj);
        const jsonBytes = Buffer.from(json, 'utf8');
        const payload = Buffer.allocUnsafe(HeapData.HEAP_DATA_OVERHEAD + jsonBytes.length);
        // Partition hash (offset 0): leave as 0 (no hash)
        Bits.writeIntB(payload, HeapData.PARTITION_HASH_OFFSET, 0);
        // Type (offset 4)
        Bits.writeIntB(payload, HeapData.TYPE_OFFSET, SerializationConstants.JAVASCRIPT_JSON_SERIALIZATION_TYPE);
        jsonBytes.copy(payload, HeapData.DATA_OFFSET);
        return new HeapData(payload);
    }

    toObject<T>(data: Data | null): T | null {
        if (data == null) return null;
        const bytes = data.toByteArray();
        if (bytes == null || bytes.length === 0) return null;
        const json = bytes.subarray(HeapData.DATA_OFFSET).toString('utf8');
        return JSON.parse(json) as T;
    }

    writeObject(_out: unknown, _obj: unknown): void {
        throw new Error('TestSerializationService.writeObject: not implemented');
    }

    readObject<T>(_inp: unknown): T {
        throw new Error('TestSerializationService.readObject: not implemented');
    }

    getClassLoader(): unknown {
        return null;
    }
}
