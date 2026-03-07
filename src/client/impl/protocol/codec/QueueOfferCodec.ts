/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.QueueOfferCodec}.
 */
import { ClientMessage } from '@zenystx/helios-core/client/impl/protocol/ClientMessage';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import { DataCodec } from './builtin/DataCodec';
import { BOOLEAN_SIZE_IN_BYTES, INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES } from './builtin/FixedSizeTypesCodec';
import { StringCodec } from './builtin/StringCodec';

export class QueueOfferCodec {
    static readonly REQUEST_MESSAGE_TYPE: number = 0x030100;
    static readonly RESPONSE_MESSAGE_TYPE: number = 0x030101;

    private static readonly REQUEST_TIMEOUT_OFFSET = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES;
    static readonly REQUEST_INITIAL_FRAME_SIZE = QueueOfferCodec.REQUEST_TIMEOUT_OFFSET + LONG_SIZE_IN_BYTES;
    private static readonly RESPONSE_HEADER_SIZE = ClientMessage.PARTITION_ID_FIELD_OFFSET + BOOLEAN_SIZE_IN_BYTES;
    private static readonly RESPONSE_RESULT_OFFSET = ClientMessage.PARTITION_ID_FIELD_OFFSET;

    private constructor() {}

    static encodeRequest(name: string, value: Data, timeoutMs: bigint): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(QueueOfferCodec.REQUEST_INITIAL_FRAME_SIZE);
        initialFrame.writeUInt32LE(QueueOfferCodec.REQUEST_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET + 4);
        initialFrame.writeInt32LE(0, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        initialFrame.writeBigInt64LE(timeoutMs, QueueOfferCodec.REQUEST_TIMEOUT_OFFSET);
        msg.add(new ClientMessage.Frame(initialFrame));
        StringCodec.encode(msg, name);
        DataCodec.encode(msg, value);
        msg.setFinal();
        return msg;
    }

    static decodeRequest(msg: ClientMessage): { name: string; value: Data; timeoutMs: bigint } {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const timeoutMs = initialFrame.content.readBigInt64LE(QueueOfferCodec.REQUEST_TIMEOUT_OFFSET);
        const name = StringCodec.decode(iter);
        const value = DataCodec.decode(iter);
        return { name, value, timeoutMs };
    }

    static encodeResponse(result: boolean): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(QueueOfferCodec.RESPONSE_HEADER_SIZE);
        initialFrame.fill(0);
        initialFrame.writeUInt32LE(QueueOfferCodec.RESPONSE_MESSAGE_TYPE >>> 0, 0);
        initialFrame.writeUInt8(result ? 1 : 0, QueueOfferCodec.RESPONSE_RESULT_OFFSET);
        msg.add(new ClientMessage.Frame(initialFrame));
        msg.setFinal();
        return msg;
    }

    static decodeResponse(msg: ClientMessage): boolean {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        return initialFrame.content.readUInt8(QueueOfferCodec.RESPONSE_RESULT_OFFSET) !== 0;
    }
}
