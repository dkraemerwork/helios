/**
 * Block B.5a — ClientAddClusterViewListenerCodec
 *
 * Port of {@code com.hazelcast.client.impl.protocol.codec.ClientAddClusterViewListenerCodec}.
 *
 * Message type: 0x000900 (request), 0x000901 (response)
 * Events:
 *   0x000902 — MEMBERS_VIEW event (member list update)
 *   0x000903 — PARTITIONS_VIEW event (partition table update)
 *
 * The server encodes member-view and partition-view events and pushes them
 * to subscribed clients whenever the cluster topology changes.
 *
 * Wire layout follows the Hazelcast 5.x client protocol multi-frame format.
 */

import { ClientMessage, ClientMessageFrame } from '@zenystx/helios-core/client/impl/protocol/ClientMessage.js';
import { FixedSizeTypesCodec, INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES, UUID_SIZE_IN_BYTES, BOOLEAN_SIZE_IN_BYTES } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import { ListMultiFrameCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/ListMultiFrameCodec.js';
import { EntryListIntegerUUIDCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/EntryListIntegerUUIDCodec.js';
import { MemberInfoCodec } from '@zenystx/helios-core/client/impl/protocol/codec/custom/MemberInfoCodec.js';
import type { MemberInfo } from '@zenystx/helios-core/cluster/MemberInfo.js';

// ── Message type constants ────────────────────────────────────────────────────

/** Request: client subscribes to cluster view updates. */
const REQUEST_MESSAGE_TYPE = 0x000900;
/** Response: server acknowledges the subscription. */
const RESPONSE_MESSAGE_TYPE = 0x000901;
/** Event: member list changed. */
const EVENT_MEMBERS_VIEW_MESSAGE_TYPE = 0x000902;
/** Event: partition table changed. */
const EVENT_PARTITIONS_VIEW_MESSAGE_TYPE = 0x000903;

// ── Frame sizes ───────────────────────────────────────────────────────────────

/** Standard initial frame size: type(4) + correlationId(8) + partitionId(4) = 16 bytes */
const STANDARD_INITIAL_FRAME_SIZE = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES;

/**
 * Response frame: just the standard 16-byte header (no payload fields).
 */
const RESPONSE_INITIAL_FRAME_SIZE = STANDARD_INITIAL_FRAME_SIZE;

/**
 * MEMBERS_VIEW event initial frame:
 *   type(4) + version(4) = 8 bytes
 */
const EVENT_MEMBERS_VIEW_INITIAL_FRAME_SIZE = INT_SIZE_IN_BYTES + INT_SIZE_IN_BYTES;

/**
 * PARTITIONS_VIEW event initial frame:
 *   type(4) + version(4) = 8 bytes
 */
const EVENT_PARTITIONS_VIEW_INITIAL_FRAME_SIZE = INT_SIZE_IN_BYTES + INT_SIZE_IN_BYTES;

// ── Codec ─────────────────────────────────────────────────────────────────────

export class ClientAddClusterViewListenerCodec {
    static readonly REQUEST_MESSAGE_TYPE = REQUEST_MESSAGE_TYPE;
    static readonly RESPONSE_MESSAGE_TYPE = RESPONSE_MESSAGE_TYPE;
    static readonly EVENT_MEMBERS_VIEW_MESSAGE_TYPE = EVENT_MEMBERS_VIEW_MESSAGE_TYPE;
    static readonly EVENT_PARTITIONS_VIEW_MESSAGE_TYPE = EVENT_PARTITIONS_VIEW_MESSAGE_TYPE;

    private constructor() {}

    // ── Request (client → server) ─────────────────────────────────────────────

    /**
     * Decode a ClusterViewListener subscription request from the client.
     * The request has no payload beyond the standard header.
     */
    static decodeRequest(_msg: ClientMessage): void {
        // No payload fields in the request — presence of the message type is sufficient.
    }

    // ── Response (server → client) ────────────────────────────────────────────

    /**
     * Encode the subscription acknowledgement response.
     * The response has no payload; the correlation ID is set by the caller.
     */
    static encodeResponse(): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const buf = Buffer.allocUnsafe(RESPONSE_INITIAL_FRAME_SIZE);
        buf.writeUInt32LE(RESPONSE_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        buf.fill(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET);
        msg.add(new ClientMessageFrame(buf, ClientMessage.IS_FINAL_FLAG));
        return msg;
    }

    // ── Events (server → client) ──────────────────────────────────────────────

    /**
     * Encode a MEMBERS_VIEW event.
     *
     * @param memberListVersion  Monotonically increasing version of the member list.
     * @param members            The current member list.
     */
    static encodeMembersViewEvent(
        memberListVersion: number,
        members: MemberInfo[],
    ): ClientMessage {
        const msg = ClientMessage.createForEncode();

        const buf = Buffer.allocUnsafe(EVENT_MEMBERS_VIEW_INITIAL_FRAME_SIZE);
        buf.writeUInt32LE(EVENT_MEMBERS_VIEW_MESSAGE_TYPE >>> 0, 0);
        buf.writeInt32LE(memberListVersion | 0, INT_SIZE_IN_BYTES);
        // Mark as event frame
        const frame = new ClientMessageFrame(buf, ClientMessage.IS_EVENT_FLAG);
        msg.add(frame);

        // Encode the member list
        ListMultiFrameCodec.encode(msg, members, MemberInfoCodec.encode);

        msg.setFinal();
        return msg;
    }

    /**
     * Encode a PARTITIONS_VIEW event.
     *
     * @param version     Monotonically increasing version of the partition table.
     * @param partitions  Map from partition ID to owner member UUID.
     *                    Encoded as a list of (partitionId, memberUuid) pairs.
     */
    static encodePartitionsViewEvent(
        version: number,
        partitions: Array<[number, string | null]>,
    ): ClientMessage {
        const msg = ClientMessage.createForEncode();

        const buf = Buffer.allocUnsafe(EVENT_PARTITIONS_VIEW_INITIAL_FRAME_SIZE);
        buf.writeUInt32LE(EVENT_PARTITIONS_VIEW_MESSAGE_TYPE >>> 0, 0);
        buf.writeInt32LE(version | 0, INT_SIZE_IN_BYTES);
        const frame = new ClientMessageFrame(buf, ClientMessage.IS_EVENT_FLAG);
        msg.add(frame);

        // Encode partitions as list of (int partitionId, UUID ownerUuid)
        EntryListIntegerUUIDCodec.encode(msg, partitions);

        msg.setFinal();
        return msg;
    }

    // ── Decode helpers ────────────────────────────────────────────────────────

    /**
     * Decode a MEMBERS_VIEW event (for testing / client-side use).
     */
    static decodeMembersViewEvent(msg: ClientMessage): {
        memberListVersion: number;
        members: MemberInfo[];
    } {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const memberListVersion = initialFrame.content.readInt32LE(INT_SIZE_IN_BYTES);
        const members = ListMultiFrameCodec.decode(iter, MemberInfoCodec.decode);
        return { memberListVersion, members };
    }

    /**
     * Decode a PARTITIONS_VIEW event (for testing / client-side use).
     */
    static decodePartitionsViewEvent(msg: ClientMessage): {
        version: number;
        partitions: Array<[number, string | null]>;
    } {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const version = initialFrame.content.readInt32LE(INT_SIZE_IN_BYTES);
        const partitions = EntryListIntegerUUIDCodec.decode(iter);
        return { version, partitions };
    }
}
