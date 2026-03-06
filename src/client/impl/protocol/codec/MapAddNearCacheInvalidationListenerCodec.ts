/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.MapAddNearCacheInvalidationListenerCodec}.
 * Auto-generated codec for near-cache invalidation listener on IMap.
 */
import { ClientMessage } from '@zenystx/core/client/impl/protocol/ClientMessage';
import { StringCodec } from './builtin/StringCodec';
import { DataCodec } from './builtin/DataCodec';
import { ListUUIDCodec } from './builtin/ListUUIDCodec';
import { ListLongCodec } from './builtin/ListLongCodec';
import { ListMultiFrameCodec } from './builtin/ListMultiFrameCodec';
import { CodecUtil } from './builtin/CodecUtil';
import {
    FixedSizeTypesCodec,
    INT_SIZE_IN_BYTES,
    BOOLEAN_SIZE_IN_BYTES,
    UUID_SIZE_IN_BYTES,
    LONG_SIZE_IN_BYTES,
} from './builtin/FixedSizeTypesCodec';
import type { Data } from '@zenystx/core/internal/serialization/Data';

// Field offsets relative to frame content start
// Initial request frame: type(4) + correlationId(8) + partitionId(4) + listenerFlags(4) + localOnly(1)
const REQUEST_LISTENER_FLAGS_FIELD_OFFSET = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES; // 16
const REQUEST_LOCAL_ONLY_FIELD_OFFSET = REQUEST_LISTENER_FLAGS_FIELD_OFFSET + INT_SIZE_IN_BYTES; // 20
const REQUEST_INITIAL_FRAME_SIZE = REQUEST_LOCAL_ONLY_FIELD_OFFSET + BOOLEAN_SIZE_IN_BYTES; // 21

// Response frame: backupAcks(1) + uuid(17)
const RESPONSE_RESPONSE_FIELD_OFFSET = ClientMessage.RESPONSE_BACKUP_ACKS_FIELD_OFFSET + BOOLEAN_SIZE_IN_BYTES; // 13
const RESPONSE_INITIAL_FRAME_SIZE = RESPONSE_RESPONSE_FIELD_OFFSET + UUID_SIZE_IN_BYTES; // 30

// Single invalidation event frame: partitionId(4) + sourceUuid(17) + partitionUuid(17) + sequence(8)
const EVENT_INVALIDATION_SOURCE_UUID_OFFSET = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES; // 16
const EVENT_INVALIDATION_PARTITION_UUID_OFFSET = EVENT_INVALIDATION_SOURCE_UUID_OFFSET + UUID_SIZE_IN_BYTES; // 33
const EVENT_INVALIDATION_SEQUENCE_OFFSET = EVENT_INVALIDATION_PARTITION_UUID_OFFSET + UUID_SIZE_IN_BYTES; // 50
const EVENT_INVALIDATION_INITIAL_FRAME_SIZE = EVENT_INVALIDATION_SEQUENCE_OFFSET + LONG_SIZE_IN_BYTES; // 58

// Batch invalidation event frame: just partitionId(4)
const EVENT_BATCH_INVALIDATION_INITIAL_FRAME_SIZE = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES; // 16

export class MapAddNearCacheInvalidationListenerCodec {
    static readonly REQUEST_MESSAGE_TYPE: number = 0x013F00;   // 81664
    static readonly RESPONSE_MESSAGE_TYPE: number = 0x013F01;  // 81665
    static readonly EVENT_I_MAP_INVALIDATION_MESSAGE_TYPE: number = 0x013F02;       // 81666
    static readonly EVENT_I_MAP_BATCH_INVALIDATION_MESSAGE_TYPE: number = 0x013F03; // 81667

    private constructor() {}

    static encodeRequest(name: string, listenerFlags: number, localOnly: boolean): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const buf = Buffer.allocUnsafe(REQUEST_INITIAL_FRAME_SIZE);
        buf.writeUInt32LE(MapAddNearCacheInvalidationListenerCodec.REQUEST_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        buf.fill(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        buf.writeInt32LE(-1, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        buf.writeInt32LE(listenerFlags | 0, REQUEST_LISTENER_FLAGS_FIELD_OFFSET);
        buf.writeUInt8(localOnly ? 1 : 0, REQUEST_LOCAL_ONLY_FIELD_OFFSET);
        msg.add(new ClientMessage.Frame(buf));
        StringCodec.encode(msg, name);
        return msg;
    }

    static decodeRequest(msg: ClientMessage): { name: string; listenerFlags: number; localOnly: boolean } {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const listenerFlags = initialFrame.content.readInt32LE(REQUEST_LISTENER_FLAGS_FIELD_OFFSET);
        const localOnly = initialFrame.content.readUInt8(REQUEST_LOCAL_ONLY_FIELD_OFFSET) !== 0;
        const name = StringCodec.decode(iter);
        return { name, listenerFlags, localOnly };
    }

    static encodeResponse(registrationId: string | null): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const buf = Buffer.allocUnsafe(RESPONSE_INITIAL_FRAME_SIZE);
        buf.writeUInt32LE(MapAddNearCacheInvalidationListenerCodec.RESPONSE_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        buf.fill(0, ClientMessage.RESPONSE_BACKUP_ACKS_FIELD_OFFSET, RESPONSE_RESPONSE_FIELD_OFFSET);
        FixedSizeTypesCodec.encodeUUID(buf, RESPONSE_RESPONSE_FIELD_OFFSET, registrationId);
        msg.add(new ClientMessage.Frame(buf));
        return msg;
    }

    static decodeResponse(msg: ClientMessage): string | null {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        return FixedSizeTypesCodec.decodeUUID(initialFrame.content, RESPONSE_RESPONSE_FIELD_OFFSET);
    }

    static encodeIMapInvalidationEvent(
        key: Data | null,
        sourceUuid: string | null,
        partitionUuid: string | null,
        sequence: bigint
    ): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const buf = Buffer.allocUnsafe(EVENT_INVALIDATION_INITIAL_FRAME_SIZE);
        buf.writeUInt32LE(MapAddNearCacheInvalidationListenerCodec.EVENT_I_MAP_INVALIDATION_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        buf.writeInt32LE(-1, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        FixedSizeTypesCodec.encodeUUID(buf, EVENT_INVALIDATION_SOURCE_UUID_OFFSET, sourceUuid);
        FixedSizeTypesCodec.encodeUUID(buf, EVENT_INVALIDATION_PARTITION_UUID_OFFSET, partitionUuid);
        FixedSizeTypesCodec.encodeLong(buf, EVENT_INVALIDATION_SEQUENCE_OFFSET, sequence);
        const frame = new ClientMessage.Frame(buf, ClientMessage.IS_EVENT_FLAG);
        msg.add(frame);
        CodecUtil.encodeNullable(msg, key, (m, d) => DataCodec.encode(m, d));
        return msg;
    }

    static encodeIMapBatchInvalidationEvent(
        keys: Data[],
        sourceUuids: (string | null)[],
        partitionUuids: (string | null)[],
        sequences: bigint[]
    ): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const buf = Buffer.allocUnsafe(EVENT_BATCH_INVALIDATION_INITIAL_FRAME_SIZE);
        buf.writeUInt32LE(MapAddNearCacheInvalidationListenerCodec.EVENT_I_MAP_BATCH_INVALIDATION_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        buf.writeInt32LE(-1, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        const frame = new ClientMessage.Frame(buf, ClientMessage.IS_EVENT_FLAG);
        msg.add(frame);
        ListMultiFrameCodec.encode(msg, keys, (m, d) => DataCodec.encode(m, d));
        ListUUIDCodec.encode(msg, sourceUuids);
        ListUUIDCodec.encode(msg, partitionUuids);
        ListLongCodec.encode(msg, sequences);
        return msg;
    }

    static AbstractEventHandler = class {
        handle(msg: ClientMessage): void {
            const msgType = msg.getMessageType();
            const iter = msg.forwardFrameIterator();
            if (msgType === MapAddNearCacheInvalidationListenerCodec.EVENT_I_MAP_INVALIDATION_MESSAGE_TYPE) {
                const initialFrame = iter.next();
                const sourceUuid = FixedSizeTypesCodec.decodeUUID(initialFrame.content, EVENT_INVALIDATION_SOURCE_UUID_OFFSET);
                const partitionUuid = FixedSizeTypesCodec.decodeUUID(initialFrame.content, EVENT_INVALIDATION_PARTITION_UUID_OFFSET);
                const sequence = FixedSizeTypesCodec.decodeLong(initialFrame.content, EVENT_INVALIDATION_SEQUENCE_OFFSET);
                const key = CodecUtil.decodeNullable(iter, i => DataCodec.decode(i));
                this.handleIMapInvalidationEvent(key, sourceUuid, partitionUuid, sequence);
                return;
            }
            if (msgType === MapAddNearCacheInvalidationListenerCodec.EVENT_I_MAP_BATCH_INVALIDATION_MESSAGE_TYPE) {
                // consume empty initial frame
                iter.next();
                const keys = ListMultiFrameCodec.decode(iter, i => DataCodec.decode(i));
                const sourceUuids = ListUUIDCodec.decode(iter);
                const partitionUuids = ListUUIDCodec.decode(iter);
                const sequences = ListLongCodec.decode(iter);
                this.handleIMapBatchInvalidationEvent(keys, sourceUuids, partitionUuids, sequences);
                return;
            }
        }

        handleIMapInvalidationEvent(
            _key: Data | null,
            _sourceUuid: string | null,
            _partitionUuid: string | null,
            _sequence: bigint
        ): void {
            throw new Error('handleIMapInvalidationEvent must be implemented');
        }

        handleIMapBatchInvalidationEvent(
            _keys: Data[],
            _sourceUuids: (string | null)[],
            _partitionUuids: (string | null)[],
            _sequences: bigint[]
        ): void {
            throw new Error('handleIMapBatchInvalidationEvent must be implemented');
        }
    };
}
