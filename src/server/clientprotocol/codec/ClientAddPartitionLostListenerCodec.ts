/**
 * Block B.5b — ClientAddPartitionLostListenerCodec
 *
 * Port of {@code com.hazelcast.client.impl.protocol.codec.ClientAddPartitionLostListenerCodec}.
 *
 * Message type: 0x001600 (request), 0x001601 (response)
 * Events:
 *   0x001602 — PARTITION_LOST event
 *
 * Clients subscribe to partition-lost notifications so they can take
 * corrective action (e.g. evict near-cache, reconnect, alert operators).
 *
 * A partition is "lost" when all replicas for that partition are gone and
 * there is no surviving backup to promote.
 */

import { ClientMessage, ClientMessageFrame } from '../../../client/impl/protocol/ClientMessage.js';
import {
    BOOLEAN_SIZE_IN_BYTES,
    FixedSizeTypesCodec,
    INT_SIZE_IN_BYTES,
    LONG_SIZE_IN_BYTES,
    UUID_SIZE_IN_BYTES,
} from '../../../client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';

// ── Message type constants ────────────────────────────────────────────────────

const REQUEST_MESSAGE_TYPE = 0x001600;
const RESPONSE_MESSAGE_TYPE = 0x001601;
const EVENT_PARTITION_LOST_MESSAGE_TYPE = 0x001602;

// ── Frame sizes ───────────────────────────────────────────────────────────────

/** Request initial frame: type(4) + correlationId(8) + partitionId(4) + localOnly(1) = 17 bytes */
const REQUEST_LOCAL_ONLY_OFFSET = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES; // 16
const REQUEST_INITIAL_FRAME_SIZE = REQUEST_LOCAL_ONLY_OFFSET + BOOLEAN_SIZE_IN_BYTES; // 17

/** Response initial frame: type(4) + correlationId(8) + partitionId(4) + registrationId UUID(17) = 33 bytes */
const RESPONSE_REGISTRATION_ID_OFFSET = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES; // 16
const RESPONSE_INITIAL_FRAME_SIZE = RESPONSE_REGISTRATION_ID_OFFSET + UUID_SIZE_IN_BYTES; // 33

/**
 * PARTITION_LOST event initial frame:
 *   type(4) + partitionId(4) + lostBackupCount(4) + source(UUID, 17) = 29 bytes
 */
const EVENT_PARTITION_ID_OFFSET = INT_SIZE_IN_BYTES; // 4
const EVENT_LOST_BACKUP_COUNT_OFFSET = EVENT_PARTITION_ID_OFFSET + INT_SIZE_IN_BYTES; // 8
const EVENT_SOURCE_UUID_OFFSET = EVENT_LOST_BACKUP_COUNT_OFFSET + INT_SIZE_IN_BYTES; // 12
const EVENT_INITIAL_FRAME_SIZE = EVENT_SOURCE_UUID_OFFSET + UUID_SIZE_IN_BYTES; // 29

// ── Codec ─────────────────────────────────────────────────────────────────────

export class ClientAddPartitionLostListenerCodec {
    static readonly REQUEST_MESSAGE_TYPE = REQUEST_MESSAGE_TYPE;
    static readonly RESPONSE_MESSAGE_TYPE = RESPONSE_MESSAGE_TYPE;
    static readonly EVENT_PARTITION_LOST_MESSAGE_TYPE = EVENT_PARTITION_LOST_MESSAGE_TYPE;

    private constructor() {}

    // ── Request (client → server) ─────────────────────────────────────────────

    /**
     * Decode a partition-lost listener subscription request.
     *
     * @returns The localOnly flag — if true, only notify for partitions
     *          owned by the local member.
     */
    static decodeRequest(msg: ClientMessage): { localOnly: boolean } {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const localOnly = FixedSizeTypesCodec.decodeBoolean(
            initialFrame.content,
            REQUEST_LOCAL_ONLY_OFFSET,
        );
        return { localOnly };
    }

    static encodeRequest(localOnly: boolean): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const buf = Buffer.allocUnsafe(REQUEST_INITIAL_FRAME_SIZE);
        buf.writeUInt32LE(REQUEST_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        buf.fill(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET, REQUEST_LOCAL_ONLY_OFFSET);
        FixedSizeTypesCodec.encodeBoolean(buf, REQUEST_LOCAL_ONLY_OFFSET, localOnly);
        msg.add(new ClientMessageFrame(buf, ClientMessage.IS_FINAL_FLAG));
        return msg;
    }

    // ── Response (server → client) ────────────────────────────────────────────

    /**
     * Encode the subscription acknowledgement response.
     *
     * @param registrationId  Server-assigned registration ID (UUID string).
     *                        The client uses this ID to later remove the listener.
     */
    static encodeResponse(registrationId: string): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const buf = Buffer.allocUnsafe(RESPONSE_INITIAL_FRAME_SIZE);
        buf.writeUInt32LE(RESPONSE_MESSAGE_TYPE >>> 0, 0);
        buf.fill(0, INT_SIZE_IN_BYTES, RESPONSE_REGISTRATION_ID_OFFSET);
        FixedSizeTypesCodec.encodeUUID(buf, RESPONSE_REGISTRATION_ID_OFFSET, registrationId);
        const UNFRAGMENTED_MESSAGE = ClientMessage.BEGIN_FRAGMENT_FLAG | ClientMessage.END_FRAGMENT_FLAG;
        msg.add(new ClientMessageFrame(buf, UNFRAGMENTED_MESSAGE | ClientMessage.IS_FINAL_FLAG));
        return msg;
    }

    static decodeResponse(msg: ClientMessage): { registrationId: string | null } {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const registrationId = FixedSizeTypesCodec.decodeUUID(
            initialFrame.content,
            RESPONSE_REGISTRATION_ID_OFFSET,
        );
        return { registrationId };
    }

    // ── Events (server → client) ──────────────────────────────────────────────

    /**
     * Encode a PARTITION_LOST event.
     *
     * @param partitionId       The partition that was lost.
     * @param lostBackupCount   Number of backups that were lost (including primary).
     * @param sourceUuid        UUID of the member that detected the loss (or null).
     */
    static encodePartitionLostEvent(
        partitionId: number,
        lostBackupCount: number,
        sourceUuid: string | null,
    ): ClientMessage {
        const msg = ClientMessage.createForEncode();

        const buf = Buffer.allocUnsafe(EVENT_INITIAL_FRAME_SIZE);
        buf.writeUInt32LE(EVENT_PARTITION_LOST_MESSAGE_TYPE >>> 0, 0);
        buf.writeInt32LE(partitionId | 0, EVENT_PARTITION_ID_OFFSET);
        buf.writeInt32LE(lostBackupCount | 0, EVENT_LOST_BACKUP_COUNT_OFFSET);
        FixedSizeTypesCodec.encodeUUID(buf, EVENT_SOURCE_UUID_OFFSET, sourceUuid);

        const EVENT_FLAGS = ClientMessage.BEGIN_FRAGMENT_FLAG | ClientMessage.END_FRAGMENT_FLAG | ClientMessage.IS_EVENT_FLAG | ClientMessage.IS_FINAL_FLAG;
        const frame = new ClientMessageFrame(buf, EVENT_FLAGS);
        msg.add(frame);

        return msg;
    }

    /**
     * Decode a PARTITION_LOST event (for testing / client-side use).
     */
    static decodePartitionLostEvent(msg: ClientMessage): {
        partitionId: number;
        lostBackupCount: number;
        sourceUuid: string | null;
    } {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        return {
            partitionId: initialFrame.content.readInt32LE(EVENT_PARTITION_ID_OFFSET),
            lostBackupCount: initialFrame.content.readInt32LE(EVENT_LOST_BACKUP_COUNT_OFFSET),
            sourceUuid: FixedSizeTypesCodec.decodeUUID(initialFrame.content, EVENT_SOURCE_UUID_OFFSET),
        };
    }
}
