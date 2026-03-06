/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.custom.EndpointQualifierCodec}.
 *
 * Wire format: BEGIN_FRAME + initial frame (4-byte LE type) + optional string (identifier) + END_FRAME
 */
import { ClientMessage } from '@zenystx/core/client/impl/protocol/ClientMessage';
import { EndpointQualifier } from '@zenystx/core/instance/EndpointQualifier';
import { StringCodec } from '../builtin/StringCodec';
import { CodecUtil } from '../builtin/CodecUtil';
import { INT_SIZE_IN_BYTES } from '../builtin/FixedSizeTypesCodec';

const INITIAL_FRAME_SIZE = INT_SIZE_IN_BYTES; // type (4 bytes)
const TYPE_OFFSET = 0;

export class EndpointQualifierCodec {
    private constructor() {}

    static encode(clientMessage: ClientMessage, eq: EndpointQualifier): void {
        clientMessage.add(ClientMessage.Frame.createStaticFrame(ClientMessage.BEGIN_DATA_STRUCTURE_FLAG));
        const buf = Buffer.allocUnsafe(INITIAL_FRAME_SIZE);
        buf.writeInt32LE(eq.type | 0, TYPE_OFFSET);
        clientMessage.add(new ClientMessage.Frame(buf));
        CodecUtil.encodeNullable(clientMessage, eq.identifier, (msg, s) => StringCodec.encode(msg, s));
        clientMessage.add(ClientMessage.Frame.createStaticFrame(ClientMessage.END_DATA_STRUCTURE_FLAG));
    }

    static decode(iterator: ClientMessage.ForwardFrameIterator): EndpointQualifier {
        // consume BEGIN
        iterator.next();
        const frame = iterator.next();
        const type = frame.content.readInt32LE(TYPE_OFFSET);
        const identifier = CodecUtil.decodeNullable(iterator, iter => StringCodec.decode(iter));
        CodecUtil.fastForwardToEndFrame(iterator);
        return new EndpointQualifier(type, identifier);
    }
}
