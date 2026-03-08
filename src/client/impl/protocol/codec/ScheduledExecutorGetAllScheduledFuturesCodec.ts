/**
 * Client protocol codec for getting all scheduled futures.
 *
 * Hazelcast parity: ScheduledExecutorGetAllScheduledFuturesCodec (0x1A0400)
 */
import { ClientMessage } from '@zenystx/helios-core/client/impl/protocol/ClientMessage';
import { INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES } from './builtin/FixedSizeTypesCodec';
import { StringCodec } from './builtin/StringCodec';

export class ScheduledExecutorGetAllScheduledFuturesCodec {
    static readonly REQUEST_MESSAGE_TYPE: number = 0x1A0400;
    static readonly RESPONSE_MESSAGE_TYPE: number = 0x1A0401;

    static readonly REQUEST_INITIAL_FRAME_SIZE = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES;

    private constructor() {}

    static encodeRequest(schedulerName: string): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(ScheduledExecutorGetAllScheduledFuturesCodec.REQUEST_INITIAL_FRAME_SIZE);
        initialFrame.writeUInt32LE(ScheduledExecutorGetAllScheduledFuturesCodec.REQUEST_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET + 4);
        initialFrame.writeInt32LE(0, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        msg.add(new ClientMessage.Frame(initialFrame));

        StringCodec.encode(msg, schedulerName);

        msg.setFinal();
        return msg;
    }

    static decodeRequest(msg: ClientMessage): { schedulerName: string } {
        const iter = msg.forwardFrameIterator();
        iter.next(); // skip initial frame
        const schedulerName = StringCodec.decode(iter);
        return { schedulerName };
    }

    static encodeResponse(handlerUrns: string[]): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        initialFrame.fill(0);
        initialFrame.writeUInt32LE(ScheduledExecutorGetAllScheduledFuturesCodec.RESPONSE_MESSAGE_TYPE >>> 0, 0);
        // Write count at offset after header
        initialFrame.writeInt32LE(handlerUrns.length, INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        msg.add(new ClientMessage.Frame(initialFrame));

        for (const urn of handlerUrns) {
            StringCodec.encode(msg, urn);
        }

        msg.setFinal();
        return msg;
    }

    static decodeResponse(msg: ClientMessage): string[] {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const count = initialFrame.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);

        const urns: string[] = [];
        for (let i = 0; i < count; i++) {
            urns.push(StringCodec.decode(iter));
        }
        return urns;
    }
}
