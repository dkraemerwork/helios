import type { ClusterMessage } from '@zenystx/helios-core/cluster/tcp/ClusterMessage';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import type { ByteArrayObjectDataOutput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataOutput';
import { HeapData } from '@zenystx/helios-core/internal/serialization/impl/HeapData';

export interface SerializationStrategy {
    serialize(message: ClusterMessage): Uint8Array;
    deserialize(buffer: Uint8Array): ClusterMessage;
    serializeInto?(out: ByteArrayObjectDataOutput, message: ClusterMessage): void;
}

const JSON_TEXT_ENCODER = new TextEncoder();
const JSON_TEXT_DECODER = new TextDecoder();
const BUFFER_MARKER = '__heliosBuffer';
const DATA_MARKER = '__heliosData';

export class JsonSerializationStrategy implements SerializationStrategy {
    serialize(message: ClusterMessage): Uint8Array {
        return JSON_TEXT_ENCODER.encode(JSON.stringify(message, jsonReplacer));
    }

    deserialize(buffer: Uint8Array): ClusterMessage {
        return JSON.parse(JSON_TEXT_DECODER.decode(buffer), jsonReviver) as ClusterMessage;
    }
}

function jsonReplacer(_key: string, value: unknown): unknown {
    if (Buffer.isBuffer(value)) {
        return { [BUFFER_MARKER]: value.toString('base64') };
    }
    if (isData(value)) {
        const bytes = value.toByteArray();
        return { [DATA_MARKER]: bytes === null ? null : bytes.toString('base64') };
    }
    return value;
}

function jsonReviver(_key: string, value: unknown): unknown {
    if (value !== null && typeof value === 'object') {
        if ((value as { type?: string }).type === 'Buffer' && Array.isArray((value as { data?: unknown[] }).data)) {
            return Buffer.from((value as { data: number[] }).data);
        }
        if (BUFFER_MARKER in value) {
            const encoded = (value as Record<string, string>)[BUFFER_MARKER];
            return Buffer.from(encoded, 'base64');
        }
        if (DATA_MARKER in value) {
            const encoded = (value as Record<string, string | null>)[DATA_MARKER];
            return encoded === null ? null : new HeapData(Buffer.from(encoded, 'base64'));
        }
    }
    return value;
}

function isData(value: unknown): value is Data {
    return value !== null && typeof value === 'object' && typeof (value as Data).toByteArray === 'function';
}
