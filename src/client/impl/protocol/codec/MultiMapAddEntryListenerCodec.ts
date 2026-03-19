import type { Data } from '@zenystx/helios-core/internal/serialization/Data.js';
import { ClientMessage } from '../ClientMessage.js';
import { CodecUtil } from './builtin/CodecUtil.js';
import { DataCodec } from './builtin/DataCodec.js';
import {
    BOOLEAN_SIZE_IN_BYTES,
    FixedSizeTypesCodec,
    INT_SIZE_IN_BYTES,
    UUID_SIZE_IN_BYTES,
} from './builtin/FixedSizeTypesCodec.js';
import { StringCodec } from './builtin/StringCodec.js';

const REQUEST_MESSAGE_TYPE = 0x020e00;
const RESPONSE_MESSAGE_TYPE = 0x020e01;
const EVENT_ENTRY_MESSAGE_TYPE = 0x020e02;
const REQUEST_INCLUDE_VALUE_OFFSET = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES;
const REQUEST_LOCAL_ONLY_OFFSET = REQUEST_INCLUDE_VALUE_OFFSET + BOOLEAN_SIZE_IN_BYTES;
const REQUEST_INITIAL_FRAME_SIZE = REQUEST_LOCAL_ONLY_OFFSET + BOOLEAN_SIZE_IN_BYTES;
const RESPONSE_RESPONSE_FIELD_OFFSET = ClientMessage.RESPONSE_BACKUP_ACKS_FIELD_OFFSET + 1;
const RESPONSE_INITIAL_FRAME_SIZE = RESPONSE_RESPONSE_FIELD_OFFSET + UUID_SIZE_IN_BYTES;
const EVENT_ENTRY_EVENT_TYPE_OFFSET = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES;
const EVENT_ENTRY_UUID_OFFSET = EVENT_ENTRY_EVENT_TYPE_OFFSET + INT_SIZE_IN_BYTES;
const EVENT_ENTRY_NUMBER_OF_AFFECTED_ENTRIES_OFFSET = EVENT_ENTRY_UUID_OFFSET + UUID_SIZE_IN_BYTES;
const EVENT_ENTRY_INITIAL_FRAME_SIZE = EVENT_ENTRY_NUMBER_OF_AFFECTED_ENTRIES_OFFSET + INT_SIZE_IN_BYTES;

export class MultiMapAddEntryListenerCodec {
    static readonly REQUEST_MESSAGE_TYPE = REQUEST_MESSAGE_TYPE;
    static readonly RESPONSE_MESSAGE_TYPE = RESPONSE_MESSAGE_TYPE;
    static readonly EVENT_ENTRY_MESSAGE_TYPE = EVENT_ENTRY_MESSAGE_TYPE;

    static encodeRequest(name: string, includeValue: boolean, localOnly: boolean): ClientMessage {
        const clientMessage = ClientMessage.createForEncode();
        const initialFrame = new ClientMessage.Frame(Buffer.alloc(REQUEST_INITIAL_FRAME_SIZE));
        initialFrame.content.writeUInt32LE(REQUEST_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        initialFrame.content.writeInt32LE(-1, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        initialFrame.content.writeUInt8(includeValue ? 1 : 0, REQUEST_INCLUDE_VALUE_OFFSET);
        initialFrame.content.writeUInt8(localOnly ? 1 : 0, REQUEST_LOCAL_ONLY_OFFSET);
        clientMessage.add(initialFrame);
        StringCodec.encode(clientMessage, name);
        clientMessage.setFinal();
        return clientMessage;
    }

    static encodeResponse(registrationId: string | null): ClientMessage {
        const clientMessage = ClientMessage.createForEncode();
        const initialFrame = new ClientMessage.Frame(Buffer.alloc(RESPONSE_INITIAL_FRAME_SIZE));
        initialFrame.content.writeUInt32LE(RESPONSE_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        initialFrame.content.writeInt32LE(-1, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        FixedSizeTypesCodec.encodeUUID(initialFrame.content, RESPONSE_RESPONSE_FIELD_OFFSET, registrationId);
        clientMessage.add(initialFrame);
        clientMessage.setFinal();
        return clientMessage;
    }

    static encodeEntryEvent(
        key: Data | null,
        value: Data | null,
        oldValue: Data | null,
        mergingValue: Data | null,
        eventType: number,
        uuid: string | null,
        numberOfAffectedEntries: number,
    ): ClientMessage {
        const clientMessage = ClientMessage.createForEncode();
        const initialFrame = new ClientMessage.Frame(Buffer.alloc(EVENT_ENTRY_INITIAL_FRAME_SIZE));
        initialFrame.flags |= ClientMessage.IS_EVENT_FLAG;
        initialFrame.content.writeUInt32LE(EVENT_ENTRY_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        initialFrame.content.writeInt32LE(-1, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        initialFrame.content.writeInt32LE(eventType | 0, EVENT_ENTRY_EVENT_TYPE_OFFSET);
        FixedSizeTypesCodec.encodeUUID(initialFrame.content, EVENT_ENTRY_UUID_OFFSET, uuid);
        initialFrame.content.writeInt32LE(numberOfAffectedEntries | 0, EVENT_ENTRY_NUMBER_OF_AFFECTED_ENTRIES_OFFSET);
        clientMessage.add(initialFrame);

        CodecUtil.encodeNullable(clientMessage, key, (msg, data) => DataCodec.encode(msg, data));
        CodecUtil.encodeNullable(clientMessage, value, (msg, data) => DataCodec.encode(msg, data));
        CodecUtil.encodeNullable(clientMessage, oldValue, (msg, data) => DataCodec.encode(msg, data));
        CodecUtil.encodeNullable(clientMessage, mergingValue, (msg, data) => DataCodec.encode(msg, data));
        clientMessage.setFinal();
        return clientMessage;
    }

    static decodeEntryEvent(clientMessage: ClientMessage): {
        key: Data | null;
        value: Data | null;
        oldValue: Data | null;
        mergingValue: Data | null;
        eventType: number;
        uuid: string | null;
        numberOfAffectedEntries: number;
    } {
        const iterator = clientMessage.forwardFrameIterator();
        const initialFrame = iterator.next();
        return {
            key: CodecUtil.decodeNullable(iterator, (iter) => DataCodec.decode(iter)),
            value: CodecUtil.decodeNullable(iterator, (iter) => DataCodec.decode(iter)),
            oldValue: CodecUtil.decodeNullable(iterator, (iter) => DataCodec.decode(iter)),
            mergingValue: CodecUtil.decodeNullable(iterator, (iter) => DataCodec.decode(iter)),
            eventType: initialFrame.content.readInt32LE(EVENT_ENTRY_EVENT_TYPE_OFFSET),
            uuid: FixedSizeTypesCodec.decodeUUID(initialFrame.content, EVENT_ENTRY_UUID_OFFSET),
            numberOfAffectedEntries: initialFrame.content.readInt32LE(EVENT_ENTRY_NUMBER_OF_AFFECTED_ENTRIES_OFFSET),
        };
    }
}
