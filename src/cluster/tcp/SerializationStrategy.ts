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
    serialize(message: ClusterMessage): Buffer;
    deserialize(buffer: Buffer): ClusterMessage;
}

/**
 * Default JSON-based serialization strategy.
 * Human-readable, suitable for development and testing.
 */
export class JsonSerializationStrategy implements SerializationStrategy {
    serialize(message: ClusterMessage): Buffer {
        return Buffer.from(JSON.stringify(message), 'utf8');
    }

    deserialize(buffer: Buffer): ClusterMessage {
        return JSON.parse(buffer.toString('utf8')) as ClusterMessage;
    }
}
