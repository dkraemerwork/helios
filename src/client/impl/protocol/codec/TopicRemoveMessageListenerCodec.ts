import { ClientMessage } from "@zenystx/helios-core/client/impl/protocol/ClientMessage";
import { StringCodec } from "@zenystx/helios-core/client/impl/protocol/codec/builtin/StringCodec";
import { FixedSizeTypesCodec, BOOLEAN_SIZE_IN_BYTES } from "@zenystx/helios-core/client/impl/protocol/codec/builtin/FixedSizeTypesCodec";

export class TopicRemoveMessageListenerCodec {
    static readonly REQUEST_MESSAGE_TYPE: number = 0x0b0a10;
    static readonly RESPONSE_MESSAGE_TYPE: number = 0x0b0a11;

    private static readonly INITIAL_FRAME_SIZE = ClientMessage.PARTITION_ID_FIELD_OFFSET + 4;
    private static readonly RESPONSE_BOOLEAN_OFFSET = ClientMessage.CORRELATION_ID_FIELD_OFFSET;
    private static readonly RESPONSE_INITIAL_FRAME_SIZE =
        TopicRemoveMessageListenerCodec.RESPONSE_BOOLEAN_OFFSET + BOOLEAN_SIZE_IN_BYTES;

    private constructor() {}

    static encodeRequest(name: string, registrationId: string): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const buf = Buffer.allocUnsafe(TopicRemoveMessageListenerCodec.INITIAL_FRAME_SIZE);
        buf.writeUInt32LE(TopicRemoveMessageListenerCodec.REQUEST_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        buf.fill(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET, TopicRemoveMessageListenerCodec.INITIAL_FRAME_SIZE);
        msg.add(new ClientMessage.Frame(buf));
        StringCodec.encode(msg, name);
        StringCodec.encode(msg, registrationId);
        msg.setFinal();
        return msg;
    }

    static decodeRequest(msg: ClientMessage): { name: string; registrationId: string } {
        const iterator = msg.forwardFrameIterator();
        iterator.next();
        return {
            name: StringCodec.decode(iterator),
            registrationId: StringCodec.decode(iterator),
        };
    }

    static encodeResponse(removed: boolean): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const buf = Buffer.allocUnsafe(TopicRemoveMessageListenerCodec.RESPONSE_INITIAL_FRAME_SIZE);
        buf.writeUInt32LE(TopicRemoveMessageListenerCodec.RESPONSE_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        buf.fill(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET, TopicRemoveMessageListenerCodec.RESPONSE_INITIAL_FRAME_SIZE);
        FixedSizeTypesCodec.encodeBoolean(buf, TopicRemoveMessageListenerCodec.RESPONSE_BOOLEAN_OFFSET, removed);
        msg.add(new ClientMessage.Frame(buf));
        msg.setFinal();
        return msg;
    }

    static decodeResponse(msg: ClientMessage): boolean {
        return FixedSizeTypesCodec.decodeBoolean(
            msg.getStartFrame().content,
            TopicRemoveMessageListenerCodec.RESPONSE_BOOLEAN_OFFSET,
        );
    }
}
