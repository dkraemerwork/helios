/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.ClientAuthenticationCodec}.
 */
import { ClientMessage } from '@zenystx/helios-core/client/impl/protocol/ClientMessage';
import { StringCodec } from './builtin/StringCodec';
import { CodecUtil } from './builtin/CodecUtil';
import { ListMultiFrameCodec } from './builtin/ListMultiFrameCodec';
import { ByteArrayCodec } from './builtin/ByteArrayCodec';
import { FixedSizeTypesCodec, INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES, BYTE_SIZE_IN_BYTES, UUID_SIZE_IN_BYTES, BOOLEAN_SIZE_IN_BYTES } from './builtin/FixedSizeTypesCodec';
import { AddressCodec } from './custom/AddressCodec';
import { MemberInfoCodec } from './custom/MemberInfoCodec';
import { EntryListUUIDListIntegerCodec } from './builtin/EntryListUUIDListIntegerCodec';
import type { MemberInfo } from '@zenystx/helios-core/cluster/MemberInfo';
import type { Address } from '@zenystx/helios-core/cluster/Address';

export class ClientAuthenticationCodec {
    static readonly REQUEST_MESSAGE_TYPE: number = 0x000100; // 256
    static readonly RESPONSE_MESSAGE_TYPE: number = 0x000101;

    // Response initial frame layout (standard response header + payload):
    // [0..3]   messageType (4 bytes)
    // [4..11]  correlationId (8 bytes, set by caller via setCorrelationId)
    // [12..12] status (byte)
    // [13..13] serializationVersion (byte)
    // [14..17] partitionCount (int)
    // [18..34] clusterId (uuid, 17 bytes)
    // [35..35] failoverSupported (bool)
    private static readonly RESPONSE_HEADER_SIZE = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES; // 12
    private static readonly RESPONSE_STATUS_OFFSET = ClientAuthenticationCodec.RESPONSE_HEADER_SIZE; // 12
    private static readonly RESPONSE_SERIALIZATION_VERSION_OFFSET =
        ClientAuthenticationCodec.RESPONSE_STATUS_OFFSET + BYTE_SIZE_IN_BYTES; // 13
    private static readonly RESPONSE_PARTITION_COUNT_OFFSET =
        ClientAuthenticationCodec.RESPONSE_SERIALIZATION_VERSION_OFFSET + BYTE_SIZE_IN_BYTES; // 14
    private static readonly RESPONSE_CLUSTER_ID_OFFSET =
        ClientAuthenticationCodec.RESPONSE_PARTITION_COUNT_OFFSET + INT_SIZE_IN_BYTES; // 18
    private static readonly RESPONSE_FAILOVER_SUPPORTED_OFFSET =
        ClientAuthenticationCodec.RESPONSE_CLUSTER_ID_OFFSET + UUID_SIZE_IN_BYTES; // 35
    static readonly RESPONSE_INITIAL_FRAME_SIZE =
        ClientAuthenticationCodec.RESPONSE_FAILOVER_SUPPORTED_OFFSET + BOOLEAN_SIZE_IN_BYTES; // 36

    private constructor() {}

    static encodeRequest(
        clusterName: string,
        username: string | null,
        password: string | null,
        uuid: string | null,
        clientType: string,
        serializationVersion: number,
        clientHazelcastVersion: string,
        clientName: string,
        labels: string[]
    ): ClientMessage {
        const msg = ClientMessage.createForEncode();

        // initial frame: messageType + correlationId + partitionId = 16 bytes
        const initialFrame = Buffer.allocUnsafe(ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES);
        initialFrame.writeUInt32LE(ClientAuthenticationCodec.REQUEST_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        initialFrame.fill(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET, ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES);
        msg.add(new ClientMessage.Frame(initialFrame));

        StringCodec.encode(msg, clusterName);
        CodecUtil.encodeNullable(msg, username, (m, v) => StringCodec.encode(m, v));
        CodecUtil.encodeNullable(msg, password, (m, v) => StringCodec.encode(m, v));
        CodecUtil.encodeNullable(msg, uuid, (m, v) => StringCodec.encode(m, v));
        StringCodec.encode(msg, clientType);
        // serializationVersion as a single-byte frame
        const svBuf = Buffer.allocUnsafe(1);
        svBuf.writeUInt8(serializationVersion & 0xff, 0);
        msg.add(new ClientMessage.Frame(svBuf));
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
        // skip initial frame
        iter.next();
        const clusterName = StringCodec.decode(iter);
        const username = CodecUtil.decodeNullable(iter, i => StringCodec.decode(i));
        const password = CodecUtil.decodeNullable(iter, i => StringCodec.decode(i));
        const uuid = CodecUtil.decodeNullable(iter, i => StringCodec.decode(i));
        const clientType = StringCodec.decode(iter);
        const svFrame = iter.next();
        const serializationVersion = svFrame.content.readUInt8(0);
        const clientHazelcastVersion = StringCodec.decode(iter);
        const clientName = StringCodec.decode(iter);
        const labels = ListMultiFrameCodec.decode(iter, i => StringCodec.decode(i));
        return { clusterName, username, password, uuid, clientType, serializationVersion, clientHazelcastVersion, clientName, labels };
    }

    static encodeResponse(
        status: number,
        address: Address | null,
        memberUuid: string | null,
        serializationVersion: number,
        serverHazelcastVersion: string,
        partitionCount: number,
        clusterId: string | null,
        failoverSupported: boolean,
        tpcPorts: Array<[string | null, number[]]> | null,
        tpcToken: Buffer | null,
        memberInfos: MemberInfo[]
    ): ClientMessage {
        const msg = ClientMessage.createForEncode();

        const buf = Buffer.allocUnsafe(ClientAuthenticationCodec.RESPONSE_INITIAL_FRAME_SIZE);
        buf.fill(0, 0, ClientAuthenticationCodec.RESPONSE_HEADER_SIZE);
        buf.writeUInt32LE(ClientAuthenticationCodec.RESPONSE_MESSAGE_TYPE >>> 0, 0);
        buf.writeUInt8(status & 0xff, ClientAuthenticationCodec.RESPONSE_STATUS_OFFSET);
        buf.writeUInt8(serializationVersion & 0xff, ClientAuthenticationCodec.RESPONSE_SERIALIZATION_VERSION_OFFSET);
        buf.writeInt32LE(partitionCount | 0, ClientAuthenticationCodec.RESPONSE_PARTITION_COUNT_OFFSET);
        FixedSizeTypesCodec.encodeUUID(buf, ClientAuthenticationCodec.RESPONSE_CLUSTER_ID_OFFSET, clusterId);
        FixedSizeTypesCodec.encodeBoolean(buf, ClientAuthenticationCodec.RESPONSE_FAILOVER_SUPPORTED_OFFSET, failoverSupported);
        msg.add(new ClientMessage.Frame(buf));

        CodecUtil.encodeNullable(msg, address, (m, a) => AddressCodec.encode(m, a));
        CodecUtil.encodeNullable(msg, memberUuid, (m, u) => StringCodec.encode(m, u));
        StringCodec.encode(msg, serverHazelcastVersion);
        ListMultiFrameCodec.encode(msg, memberInfos, (m, mi) => MemberInfoCodec.encode(m, mi));
        if (tpcPorts !== null && tpcPorts !== undefined) {
            EntryListUUIDListIntegerCodec.encode(msg, tpcPorts);
        } else {
            msg.add(ClientMessage.Frame.createStaticFrame(ClientMessage.IS_NULL_FLAG));
        }
        if (tpcToken !== null && tpcToken !== undefined) {
            ByteArrayCodec.encode(msg, tpcToken);
        } else {
            msg.add(ClientMessage.Frame.createStaticFrame(ClientMessage.IS_NULL_FLAG));
        }

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
        memberInfos: MemberInfo[];
    } {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const status = initialFrame.content.readUInt8(ClientAuthenticationCodec.RESPONSE_STATUS_OFFSET);
        const serializationVersion = initialFrame.content.readUInt8(ClientAuthenticationCodec.RESPONSE_SERIALIZATION_VERSION_OFFSET);
        const partitionCount = initialFrame.content.readInt32LE(ClientAuthenticationCodec.RESPONSE_PARTITION_COUNT_OFFSET);
        const clusterId = FixedSizeTypesCodec.decodeUUID(initialFrame.content, ClientAuthenticationCodec.RESPONSE_CLUSTER_ID_OFFSET);
        const failoverSupported = FixedSizeTypesCodec.decodeBoolean(initialFrame.content, ClientAuthenticationCodec.RESPONSE_FAILOVER_SUPPORTED_OFFSET);

        const address = CodecUtil.decodeNullable(iter, i => AddressCodec.decode(i));
        const memberUuid = CodecUtil.decodeNullable(iter, i => StringCodec.decode(i));
        const serverHazelcastVersion = StringCodec.decode(iter);
        const memberInfos = ListMultiFrameCodec.decode(iter, i => MemberInfoCodec.decode(i));

        return { status, address, memberUuid, serializationVersion, serverHazelcastVersion, partitionCount, clusterId, failoverSupported, memberInfos };
    }
}
