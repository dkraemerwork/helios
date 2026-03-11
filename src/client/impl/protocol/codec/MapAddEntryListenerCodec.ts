/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.MapAddEntryListenerCodec}.
 */
import { ClientMessage } from '../ClientMessage';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import { CodecUtil } from './builtin/CodecUtil';
import { DataCodec } from './builtin/DataCodec';
import { BOOLEAN_SIZE_IN_BYTES, FixedSizeTypesCodec, INT_SIZE_IN_BYTES, UUID_SIZE_IN_BYTES } from './builtin/FixedSizeTypesCodec';
import { StringCodec } from './builtin/StringCodec';

export class MapAddEntryListenerCodec {
    static readonly REQUEST_MESSAGE_TYPE: number = 0x011900; // 71936
    static readonly RESPONSE_MESSAGE_TYPE: number = 0x011901;
    static readonly EVENT_ENTRY_MESSAGE_TYPE: number = 0x011902;

    // Request initial frame: type(4)+correlationId(8)+partitionId(4)+listenerFlags(4)+localOnly(1) = 21
    private static readonly REQUEST_LISTENER_FLAGS_OFFSET = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES; // 16
    private static readonly REQUEST_LOCAL_ONLY_OFFSET =
        MapAddEntryListenerCodec.REQUEST_LISTENER_FLAGS_OFFSET + INT_SIZE_IN_BYTES; // 20
    static readonly REQUEST_INITIAL_FRAME_SIZE =
        MapAddEntryListenerCodec.REQUEST_LOCAL_ONLY_OFFSET + BOOLEAN_SIZE_IN_BYTES; // 21

    private static readonly RESPONSE_RESPONSE_FIELD_OFFSET = ClientMessage.RESPONSE_BACKUP_ACKS_FIELD_OFFSET + 1;
    private static readonly RESPONSE_INITIAL_FRAME_SIZE =
        MapAddEntryListenerCodec.RESPONSE_RESPONSE_FIELD_OFFSET + UUID_SIZE_IN_BYTES;

    // Event initial frame: type(4) + correlationId(8) + partitionId(4) + eventType(4) + uuid(17) + numberOfAffectedEntries(4) = 41
    private static readonly EVENT_EVENT_TYPE_OFFSET = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES; // 16
    private static readonly EVENT_UUID_OFFSET =
        MapAddEntryListenerCodec.EVENT_EVENT_TYPE_OFFSET + INT_SIZE_IN_BYTES; // 20
    private static readonly EVENT_NUMBER_OF_AFFECTED_ENTRIES_OFFSET =
        MapAddEntryListenerCodec.EVENT_UUID_OFFSET + UUID_SIZE_IN_BYTES; // 37
    static readonly EVENT_INITIAL_FRAME_SIZE =
        MapAddEntryListenerCodec.EVENT_NUMBER_OF_AFFECTED_ENTRIES_OFFSET + INT_SIZE_IN_BYTES; // 41

    private constructor() {}

    static encodeRequest(
        name: string,
        listenerFlags: number,
        localOnly: boolean
    ): ClientMessage {
        const msg = ClientMessage.createForEncode();

        const buf = Buffer.allocUnsafe(MapAddEntryListenerCodec.REQUEST_INITIAL_FRAME_SIZE);
        buf.writeUInt32LE(MapAddEntryListenerCodec.REQUEST_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        buf.fill(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET, ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES);
        buf.writeInt32LE(listenerFlags | 0, MapAddEntryListenerCodec.REQUEST_LISTENER_FLAGS_OFFSET);
        buf.writeUInt8(localOnly ? 1 : 0, MapAddEntryListenerCodec.REQUEST_LOCAL_ONLY_OFFSET);
        msg.add(new ClientMessage.Frame(buf));

        StringCodec.encode(msg, name);
        msg.setFinal();
        return msg;
    }

    static encodeEntryEvent(
        key: Data | null,
        value: Data | null,
        oldValue: Data | null,
        mergingValue: Data | null,
        eventType: number,
        uuid: string | null,
        numberOfAffectedEntries: number
    ): ClientMessage {
        const msg = ClientMessage.createForEncode();

        const buf = Buffer.alloc(MapAddEntryListenerCodec.EVENT_INITIAL_FRAME_SIZE);
        buf.writeUInt32LE(MapAddEntryListenerCodec.EVENT_ENTRY_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        buf.writeInt32LE(-1, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        buf.writeInt32LE(eventType | 0, MapAddEntryListenerCodec.EVENT_EVENT_TYPE_OFFSET);
        FixedSizeTypesCodec.encodeUUID(buf, MapAddEntryListenerCodec.EVENT_UUID_OFFSET, uuid);
        buf.writeInt32LE(numberOfAffectedEntries | 0, MapAddEntryListenerCodec.EVENT_NUMBER_OF_AFFECTED_ENTRIES_OFFSET);
        msg.add(new ClientMessage.Frame(buf, ClientMessage.IS_EVENT_FLAG));

        CodecUtil.encodeNullable(msg, key, (m, d) => DataCodec.encode(m, d));
        CodecUtil.encodeNullable(msg, value, (m, d) => DataCodec.encode(m, d));
        CodecUtil.encodeNullable(msg, oldValue, (m, d) => DataCodec.encode(m, d));
        CodecUtil.encodeNullable(msg, mergingValue, (m, d) => DataCodec.encode(m, d));

        msg.setFinal();
        return msg;
    }

    static encodeResponse(registrationId: string | null): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const buf = Buffer.alloc(MapAddEntryListenerCodec.RESPONSE_INITIAL_FRAME_SIZE);
        buf.writeUInt32LE(MapAddEntryListenerCodec.RESPONSE_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        FixedSizeTypesCodec.encodeUUID(buf, MapAddEntryListenerCodec.RESPONSE_RESPONSE_FIELD_OFFSET, registrationId);
        msg.add(new ClientMessage.Frame(buf));
        msg.setFinal();
        return msg;
    }

    static decodeResponse(msg: ClientMessage): string | null {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        return FixedSizeTypesCodec.decodeUUID(initialFrame.content, MapAddEntryListenerCodec.RESPONSE_RESPONSE_FIELD_OFFSET);
    }

    static decodeEntryEvent(msg: ClientMessage): {
        key: Data | null;
        value: Data | null;
        oldValue: Data | null;
        mergingValue: Data | null;
        eventType: number;
        uuid: string | null;
        numberOfAffectedEntries: number;
    } {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const eventType = initialFrame.content.readInt32LE(MapAddEntryListenerCodec.EVENT_EVENT_TYPE_OFFSET);
        const uuid = FixedSizeTypesCodec.decodeUUID(initialFrame.content, MapAddEntryListenerCodec.EVENT_UUID_OFFSET);
        const numberOfAffectedEntries = initialFrame.content.readInt32LE(MapAddEntryListenerCodec.EVENT_NUMBER_OF_AFFECTED_ENTRIES_OFFSET);

        const key = CodecUtil.decodeNullable(iter, i => DataCodec.decode(i));
        const value = CodecUtil.decodeNullable(iter, i => DataCodec.decode(i));
        const oldValue = CodecUtil.decodeNullable(iter, i => DataCodec.decode(i));
        const mergingValue = CodecUtil.decodeNullable(iter, i => DataCodec.decode(i));

        return { key, value, oldValue, mergingValue, eventType, uuid, numberOfAffectedEntries };
    }

    static handleEvent(
        msg: ClientMessage,
        handler: (
            key: Data | null,
            value: Data | null,
            oldValue: Data | null,
            mergingValue: Data | null,
            eventType: number,
            uuid: string | null,
            numberOfAffectedEntries: number
        ) => void
    ): void {
        if (msg.getMessageType() !== MapAddEntryListenerCodec.EVENT_ENTRY_MESSAGE_TYPE) {
            return;
        }

        const decoded = MapAddEntryListenerCodec.decodeEntryEvent(msg);
        handler(
            decoded.key,
            decoded.value,
            decoded.oldValue,
            decoded.mergingValue,
            decoded.eventType,
            decoded.uuid,
            decoded.numberOfAffectedEntries
        );
    }
}
