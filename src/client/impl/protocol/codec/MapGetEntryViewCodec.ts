import { ClientMessage } from '@zenystx/helios-core/client/impl/protocol/ClientMessage.js';
import { CodecUtil } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/CodecUtil.js';
import { DataCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/DataCodec.js';
import {
    FixedSizeTypesCodec,
    INT_SIZE_IN_BYTES,
    LONG_SIZE_IN_BYTES,
} from '@zenystx/helios-core/client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import { StringCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/StringCodec.js';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data.js';
import { SimpleEntryView } from '@zenystx/helios-core/map/impl/SimpleEntryView.js';
import { SimpleEntryViewCodec } from './custom/SimpleEntryViewCodec.js';

export class MapGetEntryViewCodec {
    static readonly REQUEST_MESSAGE_TYPE = 0x011d00;
    static readonly RESPONSE_MESSAGE_TYPE = 0x011d01;
    private static readonly REQUEST_THREAD_ID_FIELD_OFFSET = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES;
    private static readonly REQUEST_INITIAL_FRAME_SIZE = MapGetEntryViewCodec.REQUEST_THREAD_ID_FIELD_OFFSET + LONG_SIZE_IN_BYTES;
    private static readonly RESPONSE_MAX_IDLE_FIELD_OFFSET = ClientMessage.RESPONSE_BACKUP_ACKS_FIELD_OFFSET + 1;
    private static readonly RESPONSE_INITIAL_FRAME_SIZE = MapGetEntryViewCodec.RESPONSE_MAX_IDLE_FIELD_OFFSET + LONG_SIZE_IN_BYTES;

    static encodeRequest(name: string, key: Data, threadId: bigint): ClientMessage {
        const clientMessage = ClientMessage.createForEncode();
        const initialFrame = new ClientMessage.Frame(Buffer.alloc(MapGetEntryViewCodec.REQUEST_INITIAL_FRAME_SIZE));
        initialFrame.content.writeUInt32LE(MapGetEntryViewCodec.REQUEST_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        initialFrame.content.writeInt32LE(-1, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        FixedSizeTypesCodec.encodeLong(initialFrame.content, MapGetEntryViewCodec.REQUEST_THREAD_ID_FIELD_OFFSET, threadId);
        clientMessage.add(initialFrame);

        StringCodec.encode(clientMessage, name);
        DataCodec.encode(clientMessage, key);
        clientMessage.setFinal();
        return clientMessage;
    }

    static encodeResponse(response: SimpleEntryView<Data, Data> | null, maxIdle: bigint): ClientMessage {
        const clientMessage = ClientMessage.createForEncode();
        const initialFrame = new ClientMessage.Frame(Buffer.alloc(MapGetEntryViewCodec.RESPONSE_INITIAL_FRAME_SIZE));
        initialFrame.content.writeUInt32LE(MapGetEntryViewCodec.RESPONSE_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        FixedSizeTypesCodec.encodeLong(initialFrame.content, MapGetEntryViewCodec.RESPONSE_MAX_IDLE_FIELD_OFFSET, maxIdle);
        clientMessage.add(initialFrame);

        CodecUtil.encodeNullable(clientMessage, response, (message, value) => {
            SimpleEntryViewCodec.encode(message, value);
        });
        clientMessage.setFinal();
        return clientMessage;
    }

    static decodeResponse(clientMessage: ClientMessage): { response: SimpleEntryView<Data, Data> | null; maxIdle: bigint } {
        const iterator = clientMessage.forwardFrameIterator();
        const initialFrame = iterator.next();
        const maxIdle = FixedSizeTypesCodec.decodeLong(initialFrame.content, MapGetEntryViewCodec.RESPONSE_MAX_IDLE_FIELD_OFFSET);
        const response = CodecUtil.decodeNullable(iterator, (frameIterator) => SimpleEntryViewCodec.decode(frameIterator));
        return { response, maxIdle };
    }
}
