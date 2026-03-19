import type { Data } from "@zenystx/helios-core/internal/serialization/Data";
import { ClientMessage } from "../ClientMessage";
import { DataCodec } from "./builtin/DataCodec";
import { FixedSizeTypesCodec, LONG_SIZE_IN_BYTES } from "./builtin/FixedSizeTypesCodec";
import { StringCodec } from "./builtin/StringCodec";

export class TopicAddMessageListenerCodec {
    static readonly REQUEST_MESSAGE_TYPE: number = 0x0b0a00;
    static readonly RESPONSE_MESSAGE_TYPE: number = 0x0b0a01;
    static readonly EVENT_MESSAGE_TYPE: number = 0x0b0a02;

    private static readonly RESPONSE_INITIAL_FRAME_SIZE = ClientMessage.PARTITION_ID_FIELD_OFFSET + 4;
    private static readonly EVENT_PUBLISH_TIME_OFFSET = ClientMessage.CORRELATION_ID_FIELD_OFFSET;
    private static readonly EVENT_INITIAL_FRAME_SIZE =
        TopicAddMessageListenerCodec.EVENT_PUBLISH_TIME_OFFSET + LONG_SIZE_IN_BYTES;

    private constructor() {}

    static encodeRequest(name: string): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const buf = Buffer.allocUnsafe(TopicAddMessageListenerCodec.RESPONSE_INITIAL_FRAME_SIZE);
        buf.writeUInt32LE(TopicAddMessageListenerCodec.REQUEST_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        buf.fill(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET, TopicAddMessageListenerCodec.RESPONSE_INITIAL_FRAME_SIZE);
        msg.add(new ClientMessage.Frame(buf));
        StringCodec.encode(msg, name);
        msg.setFinal();
        return msg;
    }

    static decodeRequest(msg: ClientMessage): { name: string } {
        const iterator = msg.forwardFrameIterator();
        iterator.next();
        return { name: StringCodec.decode(iterator) };
    }

    static encodeResponse(registrationId: string): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const buf = Buffer.allocUnsafe(TopicAddMessageListenerCodec.RESPONSE_INITIAL_FRAME_SIZE);
        buf.writeUInt32LE(TopicAddMessageListenerCodec.RESPONSE_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        buf.fill(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET, TopicAddMessageListenerCodec.RESPONSE_INITIAL_FRAME_SIZE);
        msg.add(new ClientMessage.Frame(buf));
        StringCodec.encode(msg, registrationId);
        msg.setFinal();
        return msg;
    }

    static decodeResponse(msg: ClientMessage): string {
        const iterator = msg.forwardFrameIterator();
        iterator.next();
        return StringCodec.decode(iterator);
    }

    static encodeEvent(name: string, message: Data, publishTime: number, publishingMemberId: string | null): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const buf = Buffer.allocUnsafe(TopicAddMessageListenerCodec.EVENT_INITIAL_FRAME_SIZE);
        buf.writeUInt32LE(TopicAddMessageListenerCodec.EVENT_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        FixedSizeTypesCodec.encodeLong(buf, TopicAddMessageListenerCodec.EVENT_PUBLISH_TIME_OFFSET, BigInt(publishTime));
        const frame = new ClientMessage.Frame(buf, ClientMessage.IS_EVENT_FLAG);
        msg.add(frame);
        StringCodec.encode(msg, name);
        DataCodec.encode(msg, message);
        StringCodec.encode(msg, publishingMemberId ?? "");
        msg.setFinal();
        return msg;
    }

    static decodeEvent(msg: ClientMessage): {
        name: string;
        message: Data;
        publishTime: number;
        publishingMemberId: string | null;
    } {
        const iterator = msg.forwardFrameIterator();
        const initialFrame = iterator.next();
        const publishTime = Number(
            FixedSizeTypesCodec.decodeLong(initialFrame.content, TopicAddMessageListenerCodec.EVENT_PUBLISH_TIME_OFFSET),
        );
        const name = StringCodec.decode(iterator);
        const message = DataCodec.decode(iterator);
        const publishingMemberId = StringCodec.decode(iterator);
        return {
            name,
            message,
            publishTime,
            publishingMemberId: publishingMemberId.length > 0 ? publishingMemberId : null,
        };
    }
}
