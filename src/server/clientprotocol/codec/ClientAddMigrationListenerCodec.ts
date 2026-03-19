/**
 * ClientAddMigrationListenerCodec
 *
 * Helios-internal codec for migration listener registration over the
 * client protocol.  Not present in the upstream Hazelcast OSS codec set;
 * assigned opcode 0x001700 / 0x001701 to avoid conflicts with upstream
 * reserved ranges (Client.* opcodes end at 0x001600).
 *
 * Message types:
 *   0x001700 — AddMigrationListener request
 *   0x001701 — AddMigrationListener response  (registration UUID)
 *   0x001702 — MigrationStarted event
 *   0x001703 — MigrationCompleted event
 *   0x001704 — MigrationFailed event
 *   0x001705 — RemoveMigrationListener request
 *   0x001706 — RemoveMigrationListener response (boolean removed)
 *
 * Event frame layout (common to all three event types):
 *   [0..3]   type
 *   [4..7]   partitionId   (int32)
 *   [8..11]  migrationIndex (int32)
 *   [12..28] oldOwnerUuid  (UUID, 17 bytes)
 *   [29..45] newOwnerUuid  (UUID, 17 bytes)
 *   Total initial frame: 46 bytes
 */

import { ClientMessage, ClientMessageFrame } from '../../../client/impl/protocol/ClientMessage.js';
import {
    FixedSizeTypesCodec,
    INT_SIZE_IN_BYTES,
    LONG_SIZE_IN_BYTES,
    UUID_SIZE_IN_BYTES,
    BOOLEAN_SIZE_IN_BYTES,
    BYTE_SIZE_IN_BYTES,
} from '../../../client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';

// ── Message type constants ────────────────────────────────────────────────────

const ADD_REQUEST_MESSAGE_TYPE      = 0x001700;
const ADD_RESPONSE_MESSAGE_TYPE     = 0x001701;
const EVENT_MIGRATION_STARTED_TYPE  = 0x001702;
const EVENT_MIGRATION_COMPLETED_TYPE = 0x001703;
const EVENT_MIGRATION_FAILED_TYPE   = 0x001704;
const REMOVE_REQUEST_MESSAGE_TYPE   = 0x001705;
const REMOVE_RESPONSE_MESSAGE_TYPE  = 0x001706;

// ── Frame size constants ──────────────────────────────────────────────────────

/** Response initial frame: type(4) + correlationId(8) + backupAcks(1) + registrationId UUID(17) = 30 bytes */
const RESP_H = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + BYTE_SIZE_IN_BYTES; // 13
const ADD_RESPONSE_REGISTRATION_UUID_OFFSET = RESP_H; // 13
const ADD_RESPONSE_INITIAL_FRAME_SIZE = ADD_RESPONSE_REGISTRATION_UUID_OFFSET + UUID_SIZE_IN_BYTES; // 30

/** Remove request: type(4) + correlationId(8) + partitionId(4) + registrationId UUID(17) = 33 bytes */
const REQUEST_H = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES; // 16
const REMOVE_REQUEST_UUID_OFFSET = REQUEST_H; // 16
const REMOVE_REQUEST_INITIAL_FRAME_SIZE = REMOVE_REQUEST_UUID_OFFSET + UUID_SIZE_IN_BYTES; // 33

/** Remove response: type(4) + correlationId(8) + backupAcks(1) + removed bool(1) = 14 bytes */
const REMOVE_RESPONSE_BOOL_OFFSET = RESP_H; // 13
const REMOVE_RESPONSE_INITIAL_FRAME_SIZE = REMOVE_RESPONSE_BOOL_OFFSET + BOOLEAN_SIZE_IN_BYTES; // 14

/**
 * Event initial frame layout (common to started/completed/failed):
 *   [0..3]   type (4)
 *   [4..7]   partitionId (int32, 4)
 *   [8..11]  migrationIndex (int32, 4)
 *   [12..28] oldOwnerUuid (UUID, 17)
 *   [29..45] newOwnerUuid (UUID, 17)
 *   Total: 46 bytes
 */
const EVENT_PARTITION_ID_OFFSET    = INT_SIZE_IN_BYTES;                            // 4
const EVENT_MIGRATION_INDEX_OFFSET = EVENT_PARTITION_ID_OFFSET + INT_SIZE_IN_BYTES; // 8
const EVENT_OLD_OWNER_UUID_OFFSET  = EVENT_MIGRATION_INDEX_OFFSET + INT_SIZE_IN_BYTES; // 12
const EVENT_NEW_OWNER_UUID_OFFSET  = EVENT_OLD_OWNER_UUID_OFFSET + UUID_SIZE_IN_BYTES; // 29
const EVENT_INITIAL_FRAME_SIZE     = EVENT_NEW_OWNER_UUID_OFFSET + UUID_SIZE_IN_BYTES; // 46

// ── Codec ─────────────────────────────────────────────────────────────────────

export class ClientAddMigrationListenerCodec {
    static readonly ADD_REQUEST_MESSAGE_TYPE       = ADD_REQUEST_MESSAGE_TYPE;
    static readonly ADD_RESPONSE_MESSAGE_TYPE      = ADD_RESPONSE_MESSAGE_TYPE;
    static readonly EVENT_MIGRATION_STARTED_TYPE   = EVENT_MIGRATION_STARTED_TYPE;
    static readonly EVENT_MIGRATION_COMPLETED_TYPE = EVENT_MIGRATION_COMPLETED_TYPE;
    static readonly EVENT_MIGRATION_FAILED_TYPE    = EVENT_MIGRATION_FAILED_TYPE;
    static readonly REMOVE_REQUEST_MESSAGE_TYPE    = REMOVE_REQUEST_MESSAGE_TYPE;
    static readonly REMOVE_RESPONSE_MESSAGE_TYPE   = REMOVE_RESPONSE_MESSAGE_TYPE;

    private constructor() {}

    // ── Add request (client → server) ────────────────────────────────────────

    /** Encode an AddMigrationListener request (no payload beyond the header). */
    static encodeAddRequest(): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const buf = Buffer.allocUnsafe(REQUEST_H);
        buf.fill(0);
        buf.writeUInt32LE(ADD_REQUEST_MESSAGE_TYPE >>> 0, 0);
        const UNFRAGMENTED = ClientMessage.BEGIN_FRAGMENT_FLAG | ClientMessage.END_FRAGMENT_FLAG;
        msg.add(new ClientMessageFrame(buf, UNFRAGMENTED | ClientMessage.IS_FINAL_FLAG));
        return msg;
    }

    // ── Add response (server → client) ───────────────────────────────────────

    /**
     * Encode the subscription acknowledgement response with the registration UUID.
     */
    static encodeAddResponse(registrationId: string): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const buf = Buffer.allocUnsafe(ADD_RESPONSE_INITIAL_FRAME_SIZE);
        buf.fill(0);
        buf.writeUInt32LE(ADD_RESPONSE_MESSAGE_TYPE >>> 0, 0);
        FixedSizeTypesCodec.encodeUUID(buf, ADD_RESPONSE_REGISTRATION_UUID_OFFSET, registrationId);
        const UNFRAGMENTED = ClientMessage.BEGIN_FRAGMENT_FLAG | ClientMessage.END_FRAGMENT_FLAG;
        msg.add(new ClientMessageFrame(buf, UNFRAGMENTED));
        msg.setFinal();
        return msg;
    }

    static decodeAddResponse(msg: ClientMessage): { registrationId: string | null } {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const registrationId = FixedSizeTypesCodec.decodeUUID(
            initialFrame.content,
            ADD_RESPONSE_REGISTRATION_UUID_OFFSET,
        );
        return { registrationId };
    }

    // ── Remove request (client → server) ────────────────────────────────────

    /** Encode a RemoveMigrationListener request. */
    static encodeRemoveRequest(registrationId: string): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const buf = Buffer.allocUnsafe(REMOVE_REQUEST_INITIAL_FRAME_SIZE);
        buf.fill(0);
        buf.writeUInt32LE(REMOVE_REQUEST_MESSAGE_TYPE >>> 0, 0);
        FixedSizeTypesCodec.encodeUUID(buf, REMOVE_REQUEST_UUID_OFFSET, registrationId);
        const UNFRAGMENTED = ClientMessage.BEGIN_FRAGMENT_FLAG | ClientMessage.END_FRAGMENT_FLAG;
        msg.add(new ClientMessageFrame(buf, UNFRAGMENTED | ClientMessage.IS_FINAL_FLAG));
        return msg;
    }

    /** Decode a RemoveMigrationListener request. */
    static decodeRemoveRequest(msg: ClientMessage): { registrationId: string | null } {
        const frame = msg.getStartFrame();
        const registrationId = FixedSizeTypesCodec.decodeUUID(frame.content, REMOVE_REQUEST_UUID_OFFSET);
        return { registrationId };
    }

    // ── Remove response (server → client) ───────────────────────────────────

    /** Encode the remove acknowledgement response (boolean removed). */
    static encodeRemoveResponse(removed: boolean): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const buf = Buffer.allocUnsafe(REMOVE_RESPONSE_INITIAL_FRAME_SIZE);
        buf.fill(0);
        buf.writeUInt32LE(REMOVE_RESPONSE_MESSAGE_TYPE >>> 0, 0);
        FixedSizeTypesCodec.encodeBoolean(buf, REMOVE_RESPONSE_BOOL_OFFSET, removed);
        const UNFRAGMENTED = ClientMessage.BEGIN_FRAGMENT_FLAG | ClientMessage.END_FRAGMENT_FLAG;
        msg.add(new ClientMessageFrame(buf, UNFRAGMENTED));
        msg.setFinal();
        return msg;
    }

    static decodeRemoveResponse(msg: ClientMessage): { removed: boolean } {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const removed = FixedSizeTypesCodec.decodeBoolean(
            initialFrame.content,
            REMOVE_RESPONSE_BOOL_OFFSET,
        );
        return { removed };
    }

    // ── Events (server → client) ──────────────────────────────────────────────

    /**
     * Encode a migration-started event.
     *
     * @param partitionId     The partition being migrated.
     * @param migrationIndex  Sequential index within the current migration round.
     * @param oldOwnerUuid    UUID of the current owner (source), or null.
     * @param newOwnerUuid    UUID of the destination member, or null.
     * @param correlationId   Correlation ID from the original subscription request.
     */
    static encodeMigrationStartedEvent(
        partitionId: number,
        migrationIndex: number,
        oldOwnerUuid: string | null,
        newOwnerUuid: string | null,
        correlationId: number,
    ): ClientMessage {
        return _encodeMigrationEvent(
            EVENT_MIGRATION_STARTED_TYPE,
            partitionId,
            migrationIndex,
            oldOwnerUuid,
            newOwnerUuid,
            correlationId,
        );
    }

    /**
     * Encode a migration-completed event.
     */
    static encodeMigrationCompletedEvent(
        partitionId: number,
        migrationIndex: number,
        oldOwnerUuid: string | null,
        newOwnerUuid: string | null,
        correlationId: number,
    ): ClientMessage {
        return _encodeMigrationEvent(
            EVENT_MIGRATION_COMPLETED_TYPE,
            partitionId,
            migrationIndex,
            oldOwnerUuid,
            newOwnerUuid,
            correlationId,
        );
    }

    /**
     * Encode a migration-failed event.
     */
    static encodeMigrationFailedEvent(
        partitionId: number,
        migrationIndex: number,
        oldOwnerUuid: string | null,
        newOwnerUuid: string | null,
        correlationId: number,
    ): ClientMessage {
        return _encodeMigrationEvent(
            EVENT_MIGRATION_FAILED_TYPE,
            partitionId,
            migrationIndex,
            oldOwnerUuid,
            newOwnerUuid,
            correlationId,
        );
    }

    /**
     * Decode a migration event (all three types share the same frame layout).
     */
    static decodeMigrationEvent(msg: ClientMessage): {
        partitionId: number;
        migrationIndex: number;
        oldOwnerUuid: string | null;
        newOwnerUuid: string | null;
    } {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        return {
            partitionId: initialFrame.content.readInt32LE(EVENT_PARTITION_ID_OFFSET),
            migrationIndex: initialFrame.content.readInt32LE(EVENT_MIGRATION_INDEX_OFFSET),
            oldOwnerUuid: FixedSizeTypesCodec.decodeUUID(initialFrame.content, EVENT_OLD_OWNER_UUID_OFFSET),
            newOwnerUuid: FixedSizeTypesCodec.decodeUUID(initialFrame.content, EVENT_NEW_OWNER_UUID_OFFSET),
        };
    }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function _encodeMigrationEvent(
    messageType: number,
    partitionId: number,
    migrationIndex: number,
    oldOwnerUuid: string | null,
    newOwnerUuid: string | null,
    correlationId: number,
): ClientMessage {
    const msg = ClientMessage.createForEncode();
    const buf = Buffer.allocUnsafe(EVENT_INITIAL_FRAME_SIZE);
    buf.fill(0);
    buf.writeUInt32LE(messageType >>> 0, 0);
    buf.writeInt32LE(partitionId | 0, EVENT_PARTITION_ID_OFFSET);
    buf.writeInt32LE(migrationIndex | 0, EVENT_MIGRATION_INDEX_OFFSET);
    FixedSizeTypesCodec.encodeUUID(buf, EVENT_OLD_OWNER_UUID_OFFSET, oldOwnerUuid);
    FixedSizeTypesCodec.encodeUUID(buf, EVENT_NEW_OWNER_UUID_OFFSET, newOwnerUuid);
    const EVENT_FLAGS = ClientMessage.BEGIN_FRAGMENT_FLAG | ClientMessage.END_FRAGMENT_FLAG | ClientMessage.IS_EVENT_FLAG;
    msg.add(new ClientMessageFrame(buf, EVENT_FLAGS));
    msg.setCorrelationId(correlationId);
    msg.setFinal();
    return msg;
}
