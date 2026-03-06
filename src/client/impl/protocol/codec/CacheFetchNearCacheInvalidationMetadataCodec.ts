/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.CacheFetchNearCacheInvalidationMetadataCodec}.
 * Fetches invalidation metadata from partitions of JCache.
 */
import { ClientMessage } from '@zenystx/helios-core/client/impl/protocol/ClientMessage';
import { StringCodec } from './builtin/StringCodec';
import { ListMultiFrameCodec } from './builtin/ListMultiFrameCodec';
import { EntryListCodec } from './builtin/EntryListCodec';
import { EntryListIntegerLongCodec } from './builtin/EntryListIntegerLongCodec';
import { EntryListIntegerUUIDCodec } from './builtin/EntryListIntegerUUIDCodec';
import {
    FixedSizeTypesCodec,
    INT_SIZE_IN_BYTES,
    UUID_SIZE_IN_BYTES,
    BOOLEAN_SIZE_IN_BYTES,
} from './builtin/FixedSizeTypesCodec';

// Request: type(4) + correlationId(8) + partitionId(4) + uuid(17) = 33 bytes
const REQUEST_UUID_FIELD_OFFSET = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES; // 16
const REQUEST_INITIAL_FRAME_SIZE = REQUEST_UUID_FIELD_OFFSET + UUID_SIZE_IN_BYTES; // 33

// Response: just backupAcks(1) at offset 12
const RESPONSE_INITIAL_FRAME_SIZE = ClientMessage.RESPONSE_BACKUP_ACKS_FIELD_OFFSET + BOOLEAN_SIZE_IN_BYTES; // 13

export class CacheFetchNearCacheInvalidationMetadataCodec {
    static readonly REQUEST_MESSAGE_TYPE: number = 0x131E00;  // 1252864
    static readonly RESPONSE_MESSAGE_TYPE: number = 0x131E01; // 1252865

    private constructor() {}

    static encodeRequest(names: string[], uuid: string | null): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const buf = Buffer.allocUnsafe(REQUEST_INITIAL_FRAME_SIZE);
        buf.writeUInt32LE(CacheFetchNearCacheInvalidationMetadataCodec.REQUEST_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        buf.fill(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        buf.writeInt32LE(-1, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        FixedSizeTypesCodec.encodeUUID(buf, REQUEST_UUID_FIELD_OFFSET, uuid);
        msg.add(new ClientMessage.Frame(buf));
        ListMultiFrameCodec.encode(msg, names, (m, s) => StringCodec.encode(m, s));
        return msg;
    }

    static decodeRequest(msg: ClientMessage): { names: string[]; uuid: string | null } {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const uuid = FixedSizeTypesCodec.decodeUUID(initialFrame.content, REQUEST_UUID_FIELD_OFFSET);
        const names = ListMultiFrameCodec.decode(iter, i => StringCodec.decode(i));
        return { names, uuid };
    }

    static encodeResponse(
        namePartitionSequenceList: Array<[string, Array<[number, bigint]>]>,
        partitionUuidList: Array<[number, string | null]>
    ): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const buf = Buffer.allocUnsafe(RESPONSE_INITIAL_FRAME_SIZE);
        buf.writeUInt32LE(CacheFetchNearCacheInvalidationMetadataCodec.RESPONSE_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        buf.fill(0, ClientMessage.RESPONSE_BACKUP_ACKS_FIELD_OFFSET, RESPONSE_INITIAL_FRAME_SIZE);
        msg.add(new ClientMessage.Frame(buf));
        EntryListCodec.encode(
            msg,
            namePartitionSequenceList,
            (m, k) => StringCodec.encode(m, k),
            (m, v) => EntryListIntegerLongCodec.encode(m, v)
        );
        EntryListIntegerUUIDCodec.encode(msg, partitionUuidList);
        return msg;
    }

    static decodeResponse(msg: ClientMessage): {
        namePartitionSequenceList: Array<[string, Array<[number, bigint]>]>;
        partitionUuidList: Array<[number, string | null]>;
    } {
        const iter = msg.forwardFrameIterator();
        // consume empty initial frame
        iter.next();
        const namePartitionSequenceList = EntryListCodec.decode(
            iter,
            i => StringCodec.decode(i),
            i => EntryListIntegerLongCodec.decode(i)
        );
        const partitionUuidList = EntryListIntegerUUIDCodec.decode(iter);
        return { namePartitionSequenceList, partitionUuidList };
    }
}
