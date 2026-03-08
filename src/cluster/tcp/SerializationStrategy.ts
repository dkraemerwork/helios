/**
 * Block 16.A5 — SerializationStrategy interface for TCP cluster protocol.
 *
 * Allows swapping the wire encoding (JSON, MessagePack, CBOR) without
 * touching transport logic.
 *
 * v1 (default): JsonSerializationStrategy — human-readable, wire-compatible.
 * v2 (future):  MessagePack/CBOR — compact binary, production-grade throughput.
 */
import type { ClusterMessage } from '@zenystx/helios-core/cluster/tcp/ClusterMessage';

export interface SerializationStrategy {
    serialize(message: ClusterMessage): Uint8Array;
    deserialize(buffer: Uint8Array): ClusterMessage;
}

const JSON_TEXT_ENCODER = new TextEncoder();
const JSON_TEXT_DECODER = new TextDecoder();

/**
 * Default JSON-based serialization strategy.
 * Human-readable, suitable for development and testing.
 */
export class JsonSerializationStrategy implements SerializationStrategy {
    serialize(message: ClusterMessage): Uint8Array {
        return JSON_TEXT_ENCODER.encode(JSON.stringify(message));
    }

    deserialize(buffer: Uint8Array): ClusterMessage {
        return JSON.parse(JSON_TEXT_DECODER.decode(buffer)) as ClusterMessage;
    }
}
