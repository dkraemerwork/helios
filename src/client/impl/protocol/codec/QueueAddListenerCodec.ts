import { ClientMessage } from '@zenystx/helios-core/client/impl/protocol/ClientMessage.js';
import { DataCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/DataCodec.js';
import {
    FixedSizeTypesCodec,
    INT_SIZE_IN_BYTES,
    UUID_SIZE_IN_BYTES,
} from '@zenystx/helios-core/client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data.js';
import { StringCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/StringCodec.js';

const REQUEST_INCLUDE_VALUE_FIELD_OFFSET = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES;
const REQUEST_LOCAL_ONLY_FIELD_OFFSET = REQUEST_INCLUDE_VALUE_FIELD_OFFSET + 1;
const REQUEST_INITIAL_FRAME_SIZE = REQUEST_LOCAL_ONLY_FIELD_OFFSET + 1;
const REQUEST_MESSAGE_TYPE = 0x031100;
const RESPONSE_MESSAGE_TYPE = 0x031101;
const EVENT_ITEM_UUID_FIELD_OFFSET = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES;
const EVENT_ITEM_EVENT_TYPE_FIELD_OFFSET = EVENT_ITEM_UUID_FIELD_OFFSET + UUID_SIZE_IN_BYTES;
const EVENT_ITEM_INITIAL_FRAME_SIZE = EVENT_ITEM_EVENT_TYPE_FIELD_OFFSET + INT_SIZE_IN_BYTES;
const EVENT_ITEM_MESSAGE_TYPE = 0x031102;

export class QueueAddListenerCodec {
    static readonly REQUEST_MESSAGE_TYPE = REQUEST_MESSAGE_TYPE;
    static readonly RESPONSE_MESSAGE_TYPE = RESPONSE_MESSAGE_TYPE;
    static readonly EVENT_ITEM_MESSAGE_TYPE = EVENT_ITEM_MESSAGE_TYPE;

    static encodeRequest(name: string, includeValue: boolean, localOnly: boolean): ClientMessage {
        const clientMessage = ClientMessage.createForEncode();
        const initialFrame = new ClientMessage.Frame(Buffer.alloc(REQUEST_INITIAL_FRAME_SIZE));
        initialFrame.content.writeUInt32LE(REQUEST_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        initialFrame.content.writeInt32LE(-1, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        initialFrame.content.writeUInt8(includeValue ? 1 : 0, REQUEST_INCLUDE_VALUE_FIELD_OFFSET);
        initialFrame.content.writeUInt8(localOnly ? 1 : 0, REQUEST_LOCAL_ONLY_FIELD_OFFSET);
        clientMessage.add(initialFrame);
        StringCodec.encode(clientMessage, name);
        clientMessage.setFinal();
        return clientMessage;
    }

    static encodeItemEvent(item: Data | null, uuid: string | null, eventType: number): ClientMessage {
        const clientMessage = ClientMessage.createForEncode();
        const initialFrame = new ClientMessage.Frame(Buffer.alloc(EVENT_ITEM_INITIAL_FRAME_SIZE));
        initialFrame.flags |= ClientMessage.IS_EVENT_FLAG;
        initialFrame.content.writeUInt32LE(EVENT_ITEM_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        initialFrame.content.writeInt32LE(-1, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        FixedSizeTypesCodec.encodeUUID(initialFrame.content, EVENT_ITEM_UUID_FIELD_OFFSET, uuid);
        initialFrame.content.writeInt32LE(eventType | 0, EVENT_ITEM_EVENT_TYPE_FIELD_OFFSET);
        clientMessage.add(initialFrame);

        if (item === null) {
            clientMessage.add(ClientMessage.NULL_FRAME);
        } else {
            DataCodec.encode(clientMessage, item);
        }
        clientMessage.setFinal();
        return clientMessage;
    }

    static decodeItemEvent(clientMessage: ClientMessage): { item: Data | null; uuid: string | null; eventType: number } {
        const iterator = clientMessage.forwardFrameIterator();
        const initialFrame = iterator.next();
        const item = iterator.peekNext()?.isNullFrame() ? (iterator.next(), null) : DataCodec.decode(iterator);
        return {
            item,
            uuid: FixedSizeTypesCodec.decodeUUID(initialFrame.content, EVENT_ITEM_UUID_FIELD_OFFSET),
            eventType: initialFrame.content.readInt32LE(EVENT_ITEM_EVENT_TYPE_FIELD_OFFSET),
        };
    }
}
