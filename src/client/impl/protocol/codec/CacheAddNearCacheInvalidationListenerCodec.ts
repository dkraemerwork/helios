/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.CacheAddNearCacheInvalidationListenerCodec}.
 * Auto-generated codec for near-cache invalidation listener on JCache.
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

// Request frame offsets
const REQUEST_LOCAL_ONLY_FIELD_OFFSET = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES; // 16
const REQUEST_INITIAL_FRAME_SIZE = REQUEST_LOCAL_ONLY_FIELD_OFFSET + BOOLEAN_SIZE_IN_BYTES; // 17

// Response frame
const RESPONSE_RESPONSE_FIELD_OFFSET = ClientMessage.RESPONSE_BACKUP_ACKS_FIELD_OFFSET + BOOLEAN_SIZE_IN_BYTES; // 13
const RESPONSE_INITIAL_FRAME_SIZE = RESPONSE_RESPONSE_FIELD_OFFSET + UUID_SIZE_IN_BYTES; // 30

// Single invalidation event: partitionId(4) + sourceUuid(17) + partitionUuid(17) + sequence(8)
const EVENT_INVALIDATION_SOURCE_UUID_OFFSET = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES; // 16
const EVENT_INVALIDATION_PARTITION_UUID_OFFSET = EVENT_INVALIDATION_SOURCE_UUID_OFFSET + UUID_SIZE_IN_BYTES; // 33
const EVENT_INVALIDATION_SEQUENCE_OFFSET = EVENT_INVALIDATION_PARTITION_UUID_OFFSET + UUID_SIZE_IN_BYTES; // 50
const EVENT_INVALIDATION_INITIAL_FRAME_SIZE = EVENT_INVALIDATION_SEQUENCE_OFFSET + LONG_SIZE_IN_BYTES; // 58

// Batch invalidation event: just partitionId(4)
const EVENT_BATCH_INVALIDATION_INITIAL_FRAME_SIZE = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES; // 16

export class CacheAddNearCacheInvalidationListenerCodec {
    static readonly REQUEST_MESSAGE_TYPE: number = 0x131D00;   // 1252608
    static readonly RESPONSE_MESSAGE_TYPE: number = 0x131D01;  // 1252609
    static readonly EVENT_CACHE_INVALIDATION_MESSAGE_TYPE: number = 0x131D02;       // 1252610
    static readonly EVENT_CACHE_BATCH_INVALIDATION_MESSAGE_TYPE: number = 0x131D03; // 1252611

    private constructor() {}

    static encodeRequest(name: string, localOnly: boolean): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const buf = Buffer.allocUnsafe(REQUEST_INITIAL_FRAME_SIZE);
        buf.writeUInt32LE(CacheAddNearCacheInvalidationListenerCodec.REQUEST_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        buf.fill(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        buf.writeInt32LE(-1, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        buf.writeUInt8(localOnly ? 1 : 0, REQUEST_LOCAL_ONLY_FIELD_OFFSET);
        msg.add(new ClientMessage.Frame(buf));
        StringCodec.encode(msg, name);
        return msg;
    }

    static decodeRequest(msg: ClientMessage): { name: string; localOnly: boolean } {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const localOnly = initialFrame.content.readUInt8(REQUEST_LOCAL_ONLY_FIELD_OFFSET) !== 0;
        const name = StringCodec.decode(iter);
        return { name, localOnly };
    }

    static encodeResponse(registrationId: string | null): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const buf = Buffer.allocUnsafe(RESPONSE_INITIAL_FRAME_SIZE);
        buf.writeUInt32LE(CacheAddNearCacheInvalidationListenerCodec.RESPONSE_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
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

    static encodeCacheInvalidationEvent(
        name: string,
        key: Data | null,
        sourceUuid: string | null,
        partitionUuid: string | null,
        sequence: bigint
    ): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const buf = Buffer.allocUnsafe(EVENT_INVALIDATION_INITIAL_FRAME_SIZE);
        buf.writeUInt32LE(CacheAddNearCacheInvalidationListenerCodec.EVENT_CACHE_INVALIDATION_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        buf.writeInt32LE(-1, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        FixedSizeTypesCodec.encodeUUID(buf, EVENT_INVALIDATION_SOURCE_UUID_OFFSET, sourceUuid);
        FixedSizeTypesCodec.encodeUUID(buf, EVENT_INVALIDATION_PARTITION_UUID_OFFSET, partitionUuid);
        FixedSizeTypesCodec.encodeLong(buf, EVENT_INVALIDATION_SEQUENCE_OFFSET, sequence);
        msg.add(new ClientMessage.Frame(buf, ClientMessage.IS_EVENT_FLAG));
        StringCodec.encode(msg, name);
        CodecUtil.encodeNullable(msg, key, (m, d) => DataCodec.encode(m, d));
        return msg;
    }

    static encodeCacheBatchInvalidationEvent(
        name: string,
        keys: Data[],
        sourceUuids: (string | null)[],
        partitionUuids: (string | null)[],
        sequences: bigint[]
    ): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const buf = Buffer.allocUnsafe(EVENT_BATCH_INVALIDATION_INITIAL_FRAME_SIZE);
        buf.writeUInt32LE(CacheAddNearCacheInvalidationListenerCodec.EVENT_CACHE_BATCH_INVALIDATION_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        buf.writeInt32LE(-1, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        msg.add(new ClientMessage.Frame(buf, ClientMessage.IS_EVENT_FLAG));
        StringCodec.encode(msg, name);
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
            if (msgType === CacheAddNearCacheInvalidationListenerCodec.EVENT_CACHE_INVALIDATION_MESSAGE_TYPE) {
                const initialFrame = iter.next();
                const sourceUuid = FixedSizeTypesCodec.decodeUUID(initialFrame.content, EVENT_INVALIDATION_SOURCE_UUID_OFFSET);
                const partitionUuid = FixedSizeTypesCodec.decodeUUID(initialFrame.content, EVENT_INVALIDATION_PARTITION_UUID_OFFSET);
                const sequence = FixedSizeTypesCodec.decodeLong(initialFrame.content, EVENT_INVALIDATION_SEQUENCE_OFFSET);
                const name = StringCodec.decode(iter);
                const key = CodecUtil.decodeNullable(iter, i => DataCodec.decode(i));
                this.handleCacheInvalidationEvent(name, key, sourceUuid, partitionUuid, sequence);
                return;
            }
            if (msgType === CacheAddNearCacheInvalidationListenerCodec.EVENT_CACHE_BATCH_INVALIDATION_MESSAGE_TYPE) {
                // consume empty initial frame
                iter.next();
                const name = StringCodec.decode(iter);
                const keys = ListMultiFrameCodec.decode(iter, i => DataCodec.decode(i));
                const sourceUuids = ListUUIDCodec.decode(iter);
                const partitionUuids = ListUUIDCodec.decode(iter);
                const sequences = ListLongCodec.decode(iter);
                this.handleCacheBatchInvalidationEvent(name, keys, sourceUuids, partitionUuids, sequences);
                return;
            }
        }

        handleCacheInvalidationEvent(
            _name: string,
            _key: Data | null,
            _sourceUuid: string | null,
            _partitionUuid: string | null,
            _sequence: bigint
        ): void {
            throw new Error('handleCacheInvalidationEvent must be implemented');
        }

        handleCacheBatchInvalidationEvent(
            _name: string,
            _keys: Data[],
            _sourceUuids: (string | null)[],
            _partitionUuids: (string | null)[],
            _sequences: bigint[]
        ): void {
            throw new Error('handleCacheBatchInvalidationEvent must be implemented');
        }
    };
}
