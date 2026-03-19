/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.custom.AddressCodec}.
 *
 * Wire format: BEGIN_FRAME + initial frame (4-byte LE port) + string frame (host) + END_FRAME
 */
import { Address } from '@zenystx/helios-core/cluster/Address';
import { ClientMessage } from '../../ClientMessage';
import { CodecUtil } from '../builtin/CodecUtil';
import { INT_SIZE_IN_BYTES } from '../builtin/FixedSizeTypesCodec';
import { StringCodec } from '../builtin/StringCodec';

const INITIAL_FRAME_SIZE = INT_SIZE_IN_BYTES; // port (4 bytes)
const PORT_OFFSET = 0;

export class AddressCodec {
    private constructor() {}

    static encode(clientMessage: ClientMessage, address: Address): void {
        clientMessage.add(ClientMessage.Frame.createStaticFrame(ClientMessage.BEGIN_DATA_STRUCTURE_FLAG));
        const initialFrame = Buffer.allocUnsafe(INITIAL_FRAME_SIZE);
        initialFrame.writeInt32LE(address.port | 0, PORT_OFFSET);
        clientMessage.add(new ClientMessage.Frame(initialFrame));
        StringCodec.encode(clientMessage, address.host);
        clientMessage.add(ClientMessage.Frame.createStaticFrame(ClientMessage.END_DATA_STRUCTURE_FLAG));
    }

    static decode(iterator: ClientMessage.ForwardFrameIterator): Address {
        // consume BEGIN frame
        iterator.next();
        // read initial frame
        const initialFrame = iterator.next();
        const port = initialFrame.content.readInt32LE(PORT_OFFSET);
        const host = StringCodec.decode(iterator);
        CodecUtil.fastForwardToEndFrame(iterator);
        return new Address(host, port);
    }
}
