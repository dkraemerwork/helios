/**
 * Block B.5a — ClientAddClusterViewListenerCodec
 *
 * Port of {@code com.hazelcast.client.impl.protocol.codec.ClientAddClusterViewListenerCodec}.
 *
 * Wire-compatible with the official hazelcast-client 5.6.x Node.js SDK.
 *
 * Message type: 0x000300 (request), 0x000301 (response)
 * Events:
 *   0x000302 — MEMBERS_VIEW event (member list update)
 *   0x000303 — PARTITIONS_VIEW event (partition table update)
 */

import { ClientMessage, ClientMessageFrame } from '../../../client/impl/protocol/ClientMessage.js';
import { FixedSizeTypesCodec, INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES } from '../../../client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import { ListMultiFrameCodec } from '../../../client/impl/protocol/codec/builtin/ListMultiFrameCodec.js';
import { MemberInfoCodec } from '../../../client/impl/protocol/codec/custom/MemberInfoCodec.js';
import type { MemberInfo } from '@zenystx/helios-core/cluster/MemberInfo.js';

// ── Message type constants ────────────────────────────────────────────────────
// These MUST match the official hazelcast-client-protocol definitions.

/** Request: client subscribes to cluster view updates. */
const REQUEST_MESSAGE_TYPE = 0x000300;    // 768
/** Response: server acknowledges the subscription. */
const RESPONSE_MESSAGE_TYPE = 0x000301;   // 769
/** Event: member list changed. */
const EVENT_MEMBERS_VIEW_MESSAGE_TYPE = 0x000302;   // 770
/** Event: partition table changed. */
const EVENT_PARTITIONS_VIEW_MESSAGE_TYPE = 0x000303; // 771

// ── Frame layout constants ────────────────────────────────────────────────────

/** Standard header: type(4) + correlationId(8) + partitionId(4) = 16 bytes */
const STANDARD_HEADER_SIZE = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES;

/** Response initial frame: just the standard header. */
const RESPONSE_INITIAL_FRAME_SIZE = STANDARD_HEADER_SIZE;

/**
 * Event initial frame: standard header + version(4) = 20 bytes.
 * The official client reads version at PARTITION_ID_OFFSET + INT_SIZE_IN_BYTES = 16.
 */
const EVENT_VERSION_OFFSET = STANDARD_HEADER_SIZE;  // 16
const EVENT_INITIAL_FRAME_SIZE = EVENT_VERSION_OFFSET + INT_SIZE_IN_BYTES;  // 20

/** Unfragmented message flags. */
const UNFRAGMENTED_MESSAGE = ClientMessage.BEGIN_FRAGMENT_FLAG | ClientMessage.END_FRAGMENT_FLAG;

/** Event flags: unfragmented + event marker. */
const EVENT_FLAGS = UNFRAGMENTED_MESSAGE | ClientMessage.IS_EVENT_FLAG;

// ── Codec ─────────────────────────────────────────────────────────────────────

/**
 * Partition view: list of (memberUUID, partitionIdList) entries.
 * This matches the official `EntryListUUIDListIntegerCodec` format.
 */
export type PartitionViewEntry = [string, number[]];

export class ClientAddClusterViewListenerCodec {
    static readonly REQUEST_MESSAGE_TYPE = REQUEST_MESSAGE_TYPE;
    static readonly RESPONSE_MESSAGE_TYPE = RESPONSE_MESSAGE_TYPE;
    static readonly EVENT_MEMBERS_VIEW_MESSAGE_TYPE = EVENT_MEMBERS_VIEW_MESSAGE_TYPE;
    static readonly EVENT_PARTITIONS_VIEW_MESSAGE_TYPE = EVENT_PARTITIONS_VIEW_MESSAGE_TYPE;

    private constructor() {}

    // ── Request (client → server) ─────────────────────────────────────────────

    static decodeRequest(_msg: ClientMessage): void {
        // No payload fields beyond standard header.
    }

    // ── Response (server → client) ────────────────────────────────────────────

    static encodeResponse(): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const buf = Buffer.allocUnsafe(RESPONSE_INITIAL_FRAME_SIZE);
        buf.fill(0);
        buf.writeUInt32LE(RESPONSE_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        msg.add(new ClientMessageFrame(buf, UNFRAGMENTED_MESSAGE | ClientMessage.IS_FINAL_FLAG));
        return msg;
    }

    // ── Events (server → client) ──────────────────────────────────────────────

    /**
     * Encode a MEMBERS_VIEW event.
     *
     * Wire format (official):
     *   Initial frame: type(4) + corrId(8) + partitionId(4) + version(4)
     *   Then: ListMultiFrame of MemberInfo
     */
    static encodeMembersViewEvent(
        memberListVersion: number,
        members: MemberInfo[],
    ): ClientMessage {
        const msg = ClientMessage.createForEncode();

        const buf = Buffer.allocUnsafe(EVENT_INITIAL_FRAME_SIZE);
        buf.fill(0);
        buf.writeUInt32LE(EVENT_MEMBERS_VIEW_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        // correlationId and partitionId filled by caller or left as 0
        FixedSizeTypesCodec.encodeInt(buf, EVENT_VERSION_OFFSET, memberListVersion);
        msg.add(new ClientMessageFrame(buf, EVENT_FLAGS));

        // Encode the member list
        ListMultiFrameCodec.encode(msg, members, MemberInfoCodec.encode);

        msg.setFinal();
        return msg;
    }

    /**
     * Encode a PARTITIONS_VIEW event.
     *
     * Wire format (official): uses EntryListUUIDListIntegerCodec.
     * Each entry is: [memberUUID, partitionIdList].
     *
     *   Initial frame: type(4) + corrId(8) + partitionId(4) + version(4)
     *   Then: BEGIN_FRAME
     *         for each entry: ListIntegerCodec.encode(partitionIds)
     *         END_FRAME
     *         ListUUIDCodec.encode(memberUuids)
     */
    static encodePartitionsViewEvent(
        version: number,
        partitions: PartitionViewEntry[],
    ): ClientMessage {
        const msg = ClientMessage.createForEncode();

        const buf = Buffer.allocUnsafe(EVENT_INITIAL_FRAME_SIZE);
        buf.fill(0);
        buf.writeUInt32LE(EVENT_PARTITIONS_VIEW_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        FixedSizeTypesCodec.encodeInt(buf, EVENT_VERSION_OFFSET, version);
        msg.add(new ClientMessageFrame(buf, EVENT_FLAGS));

        // Encode as EntryListUUIDListIntegerCodec format:
        // BEGIN_FRAME, then ListInteger for each entry's partition list, END_FRAME, then ListUUID of keys
        _encodeEntryListUUIDListInteger(msg, partitions);

        msg.setFinal();
        return msg;
    }

    // ── Decode helpers (for testing / client-side use) ─────────────────────────

    static decodeMembersViewEvent(msg: ClientMessage): {
        memberListVersion: number;
        members: MemberInfo[];
    } {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const memberListVersion = initialFrame.content.readInt32LE(EVENT_VERSION_OFFSET);
        const members = ListMultiFrameCodec.decode(iter, MemberInfoCodec.decode);
        return { memberListVersion, members };
    }

    static decodePartitionsViewEvent(msg: ClientMessage): {
        version: number;
        partitions: PartitionViewEntry[];
    } {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const version = initialFrame.content.readInt32LE(EVENT_VERSION_OFFSET);
        // Decode EntryListUUIDListInteger
        const partitions = _decodeEntryListUUIDListInteger(iter);
        return { version, partitions };
    }
}

// ── EntryListUUIDListInteger encoding ─────────────────────────────────────────
// Matches the official hazelcast-client's EntryListUUIDListIntegerCodec format:
//   BEGIN_FRAME
//   for each entry: ListIntegerCodec.encode(partitionIds)
//   END_FRAME
//   ListUUIDCodec.encode(memberUuids)

function _encodeEntryListUUIDListInteger(
    msg: ClientMessage,
    entries: PartitionViewEntry[],
): void {
    const keys: string[] = [];

    // BEGIN data structure
    msg.add(ClientMessageFrame.createStaticFrame(ClientMessage.BEGIN_DATA_STRUCTURE_FLAG));

    for (const [uuid, partitionIds] of entries) {
        keys.push(uuid);
        _encodeListInteger(msg, partitionIds);
    }

    // END data structure
    msg.add(ClientMessageFrame.createStaticFrame(ClientMessage.END_DATA_STRUCTURE_FLAG));

    // Encode UUID keys
    _encodeListUUID(msg, keys);
}

function _decodeEntryListUUIDListInteger(
    iter: ClientMessage.ForwardFrameIterator,
): PartitionViewEntry[] {
    // Decode list of integer lists
    const values: number[][] = [];
    iter.next(); // consume BEGIN frame
    while (iter.hasNext()) {
        const next = iter.peekNext();
        if (next !== null && ClientMessage.isFlagSet(next.flags, ClientMessage.END_DATA_STRUCTURE_FLAG)) {
            iter.next(); // consume END frame
            break;
        }
        values.push(_decodeListInteger(iter));
    }

    // Decode UUID list
    const keys = _decodeListUUID(iter);

    const result: PartitionViewEntry[] = [];
    for (let i = 0; i < keys.length; i++) {
        result.push([keys[i]!, values[i]!]);
    }
    return result;
}

// ── ListInteger codec ─────────────────────────────────────────────────────────
// Encodes a list of int32 as a single frame with 4 bytes per element.

function _encodeListInteger(msg: ClientMessage, values: number[]): void {
    const buf = Buffer.allocUnsafe(values.length * INT_SIZE_IN_BYTES);
    for (let i = 0; i < values.length; i++) {
        buf.writeInt32LE(values[i]! | 0, i * INT_SIZE_IN_BYTES);
    }
    msg.add(new ClientMessageFrame(buf));
}

function _decodeListInteger(iter: ClientMessage.ForwardFrameIterator): number[] {
    const frame = iter.next();
    const count = frame.content.length / INT_SIZE_IN_BYTES;
    const result: number[] = [];
    for (let i = 0; i < count; i++) {
        result.push(frame.content.readInt32LE(i * INT_SIZE_IN_BYTES));
    }
    return result;
}

// ── ListUUID codec ────────────────────────────────────────────────────────────
// Encodes a list of UUIDs as a single frame with 17 bytes per UUID (1 bool + 2×long).

import { UUID_SIZE_IN_BYTES } from '../../../client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';

function _encodeListUUID(msg: ClientMessage, uuids: string[]): void {
    const buf = Buffer.allocUnsafe(uuids.length * UUID_SIZE_IN_BYTES);
    for (let i = 0; i < uuids.length; i++) {
        FixedSizeTypesCodec.encodeUUID(buf, i * UUID_SIZE_IN_BYTES, uuids[i]!);
    }
    msg.add(new ClientMessageFrame(buf));
}

function _decodeListUUID(iter: ClientMessage.ForwardFrameIterator): string[] {
    const frame = iter.next();
    const count = frame.content.length / UUID_SIZE_IN_BYTES;
    const result: string[] = [];
    for (let i = 0; i < count; i++) {
        const uuid = FixedSizeTypesCodec.decodeUUID(frame.content, i * UUID_SIZE_IN_BYTES);
        if (uuid !== null) result.push(uuid);
    }
    return result;
}
