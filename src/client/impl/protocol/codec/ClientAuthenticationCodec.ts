/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.ClientAuthenticationCodec}.
 *
 * Wire-compatible with the official hazelcast-client 5.6.x Node.js SDK.
 * The request/response frame layouts match the auto-generated codecs from
 * https://github.com/hazelcast/hazelcast-client-protocol.
 */
import { ClientMessage, ClientMessageFrame } from '@zenystx/helios-core/client/impl/protocol/ClientMessage';
import type { Address } from '@zenystx/helios-core/cluster/Address';
import type { MemberInfo } from '@zenystx/helios-core/cluster/MemberInfo';
import { CodecUtil } from './builtin/CodecUtil';
import { BOOLEAN_SIZE_IN_BYTES, BYTE_SIZE_IN_BYTES, FixedSizeTypesCodec, INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES, UUID_SIZE_IN_BYTES } from './builtin/FixedSizeTypesCodec';
import { ListMultiFrameCodec } from './builtin/ListMultiFrameCodec';
import { StringCodec } from './builtin/StringCodec';
import { AddressCodec } from './custom/AddressCodec';

// ── Request layout ─────────────────────────────────────────────────────────────
//
// Initial frame (34 bytes):
//   [0..3]     messageType           (int32, set via setMessageType)
//   [4..11]    correlationId         (int64, set via setCorrelationId)
//   [12..15]   partitionId           (int32, always -1 for auth)
//   [16..32]   uuid                  (UUID = 1 bool + 2×int64 = 17 bytes)
//   [33]       serializationVersion  (byte)
//
// Subsequent frames (var-length strings + list):
//   clusterName           (StringCodec)
//   username              (nullable StringCodec)
//   password              (nullable StringCodec)
//   clientType            (StringCodec)
//   clientHazelcastVersion(StringCodec)
//   clientName            (StringCodec)
//   labels                (ListMultiFrame<String>)

const REQUEST_UUID_OFFSET = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES;      // 16
const REQUEST_SERIALIZATION_VERSION_OFFSET = REQUEST_UUID_OFFSET + UUID_SIZE_IN_BYTES;         // 33
const REQUEST_INITIAL_FRAME_SIZE = REQUEST_SERIALIZATION_VERSION_OFFSET + BYTE_SIZE_IN_BYTES;  // 34

// ── Response layout ────────────────────────────────────────────────────────────
//
// Initial frame (54 bytes):
//   [0..3]     messageType           (int32)
//   [4..11]    correlationId         (int64)
//   [12]       backupAcks            (byte, = RESPONSE_BACKUP_ACKS offset)
//   [13]       status                (byte)
//   [14..30]   memberUuid            (UUID, 17 bytes)
//   [31]       serializationVersion  (byte)
//   [32..35]   partitionCount        (int32)
//   [36..52]   clusterId             (UUID, 17 bytes)
//   [53]       failoverSupported     (boolean)
//
// Subsequent frames:
//   address                (nullable AddressCodec)
//   serverHazelcastVersion (StringCodec)

const RESPONSE_STATUS_OFFSET = ClientMessage.RESPONSE_BACKUP_ACKS_FIELD_OFFSET + BYTE_SIZE_IN_BYTES;   // 13
const RESPONSE_MEMBER_UUID_OFFSET = RESPONSE_STATUS_OFFSET + BYTE_SIZE_IN_BYTES;                        // 14
const RESPONSE_SERIALIZATION_VERSION_OFFSET = RESPONSE_MEMBER_UUID_OFFSET + UUID_SIZE_IN_BYTES;         // 31
const RESPONSE_PARTITION_COUNT_OFFSET = RESPONSE_SERIALIZATION_VERSION_OFFSET + BYTE_SIZE_IN_BYTES;     // 32
const RESPONSE_CLUSTER_ID_OFFSET = RESPONSE_PARTITION_COUNT_OFFSET + INT_SIZE_IN_BYTES;                 // 36
const RESPONSE_FAILOVER_SUPPORTED_OFFSET = RESPONSE_CLUSTER_ID_OFFSET + UUID_SIZE_IN_BYTES;            // 53
const RESPONSE_INITIAL_FRAME_SIZE = RESPONSE_FAILOVER_SUPPORTED_OFFSET + BOOLEAN_SIZE_IN_BYTES;        // 54

/** Unfragmented-message flag = BEGIN_FRAGMENT | END_FRAGMENT. */
const UNFRAGMENTED_MESSAGE = ClientMessage.BEGIN_FRAGMENT_FLAG | ClientMessage.END_FRAGMENT_FLAG;

export class ClientAuthenticationCodec {
    static readonly REQUEST_MESSAGE_TYPE: number = 0x000100; // 256
    static readonly RESPONSE_MESSAGE_TYPE: number = 0x000101;
    static readonly RESPONSE_INITIAL_FRAME_SIZE: number = RESPONSE_INITIAL_FRAME_SIZE;

    private constructor() {}

    // ── Request encode/decode ──────────────────────────────────────────────

    static encodeRequest(
        clusterName: string,
        username: string | null,
        password: string | null,
        uuid: string | null,
        clientType: string,
        serializationVersion: number,
        clientHazelcastVersion: string,
        clientName: string,
        labels: string[],
    ): ClientMessage {
        const msg = ClientMessage.createForEncode();

        const initialFrame = Buffer.allocUnsafe(REQUEST_INITIAL_FRAME_SIZE);
        initialFrame.fill(0);
        FixedSizeTypesCodec.encodeUUID(initialFrame, REQUEST_UUID_OFFSET, uuid);
        FixedSizeTypesCodec.encodeByte(initialFrame, REQUEST_SERIALIZATION_VERSION_OFFSET, serializationVersion);
        msg.add(new ClientMessageFrame(initialFrame, UNFRAGMENTED_MESSAGE));
        msg.setMessageType(ClientAuthenticationCodec.REQUEST_MESSAGE_TYPE);
        msg.setPartitionId(-1);

        StringCodec.encode(msg, clusterName);
        CodecUtil.encodeNullable(msg, username, (m, v) => StringCodec.encode(m, v));
        CodecUtil.encodeNullable(msg, password, (m, v) => StringCodec.encode(m, v));
        StringCodec.encode(msg, clientType);
        StringCodec.encode(msg, clientHazelcastVersion);
        StringCodec.encode(msg, clientName);
        ListMultiFrameCodec.encode(msg, labels, (m, v) => StringCodec.encode(m, v));

        msg.setFinal();
        return msg;
    }

    static decodeRequest(msg: ClientMessage): {
        clusterName: string;
        username: string | null;
        password: string | null;
        uuid: string | null;
        clientType: string;
        serializationVersion: number;
        clientHazelcastVersion: string;
        clientName: string;
        labels: string[];
    } {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();

        // Read fixed-size fields from the initial frame
        const uuid = FixedSizeTypesCodec.decodeUUID(initialFrame.content, REQUEST_UUID_OFFSET);
        const serializationVersion = initialFrame.content.readUInt8(REQUEST_SERIALIZATION_VERSION_OFFSET);

        // Read variable-length fields from subsequent frames
        const clusterName = StringCodec.decode(iter);
        const username = CodecUtil.decodeNullable(iter, (i) => StringCodec.decode(i));
        const password = CodecUtil.decodeNullable(iter, (i) => StringCodec.decode(i));
        const clientType = StringCodec.decode(iter);
        const clientHazelcastVersion = StringCodec.decode(iter);
        const clientName = StringCodec.decode(iter);
        const labels = ListMultiFrameCodec.decode(iter, (i) => StringCodec.decode(i));

        return { clusterName, username, password, uuid, clientType, serializationVersion, clientHazelcastVersion, clientName, labels };
    }

    // ── Response encode/decode ─────────────────────────────────────────────

    static encodeResponse(
        status: number,
        address: Address | null,
        memberUuid: string | null,
        serializationVersion: number,
        serverHazelcastVersion: string,
        partitionCount: number,
        clusterId: string | null,
        failoverSupported: boolean,
    ): ClientMessage {
        const msg = ClientMessage.createForEncode();

        const buf = Buffer.allocUnsafe(RESPONSE_INITIAL_FRAME_SIZE);
        buf.fill(0);
        FixedSizeTypesCodec.encodeByte(buf, RESPONSE_STATUS_OFFSET, status);
        FixedSizeTypesCodec.encodeUUID(buf, RESPONSE_MEMBER_UUID_OFFSET, memberUuid);
        FixedSizeTypesCodec.encodeByte(buf, RESPONSE_SERIALIZATION_VERSION_OFFSET, serializationVersion);
        FixedSizeTypesCodec.encodeInt(buf, RESPONSE_PARTITION_COUNT_OFFSET, partitionCount);
        FixedSizeTypesCodec.encodeUUID(buf, RESPONSE_CLUSTER_ID_OFFSET, clusterId);
        FixedSizeTypesCodec.encodeBoolean(buf, RESPONSE_FAILOVER_SUPPORTED_OFFSET, failoverSupported);
        msg.add(new ClientMessageFrame(buf, UNFRAGMENTED_MESSAGE));
        msg.setMessageType(ClientAuthenticationCodec.RESPONSE_MESSAGE_TYPE);

        CodecUtil.encodeNullable(msg, address, (m, a) => AddressCodec.encode(m, a));
        StringCodec.encode(msg, serverHazelcastVersion);

        msg.setFinal();
        return msg;
    }

    static decodeResponse(msg: ClientMessage): {
        status: number;
        address: Address | null;
        memberUuid: string | null;
        serializationVersion: number;
        serverHazelcastVersion: string;
        partitionCount: number;
        clusterId: string | null;
        failoverSupported: boolean;
    } {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const status = initialFrame.content.readUInt8(RESPONSE_STATUS_OFFSET);
        const memberUuid = FixedSizeTypesCodec.decodeUUID(initialFrame.content, RESPONSE_MEMBER_UUID_OFFSET);
        const serializationVersion = initialFrame.content.readUInt8(RESPONSE_SERIALIZATION_VERSION_OFFSET);
        const partitionCount = initialFrame.content.readInt32LE(RESPONSE_PARTITION_COUNT_OFFSET);
        const clusterId = FixedSizeTypesCodec.decodeUUID(initialFrame.content, RESPONSE_CLUSTER_ID_OFFSET);
        const failoverSupported = FixedSizeTypesCodec.decodeBoolean(initialFrame.content, RESPONSE_FAILOVER_SUPPORTED_OFFSET);

        const address = CodecUtil.decodeNullable(iter, (i) => AddressCodec.decode(i));
        const serverHazelcastVersion = StringCodec.decode(iter);

        return { status, address, memberUuid, serializationVersion, serverHazelcastVersion, partitionCount, clusterId, failoverSupported };
    }
}
