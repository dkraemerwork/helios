/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.MapProjectCodec}.
 *
 * Applies the projection logic on all map entries and returns the result.
 *
 * Request:  name (string), projection (Data)
 * Response: List<nullable Data>
 *
 * Message type: 0x013B00 (request), 0x013B01 (response)
 */
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import type { ClientMessage } from '../ClientMessage';
import { ClientMessage as CM } from '../ClientMessage';
import { DataCodec } from './builtin/DataCodec';
import { StringCodec } from './builtin/StringCodec';

export class MapProjectCodec {
    static readonly REQUEST_MESSAGE_TYPE = 0x013B00;
    static readonly RESPONSE_MESSAGE_TYPE = 0x013B01;

    private constructor() {}

    static decodeRequest(msg: ClientMessage): { name: string; projection: Data } {
        const iter = msg.forwardFrameIterator();
        iter.next(); // initial frame (empty)
        const name = StringCodec.decode(iter);
        const projection = DataCodec.decode(iter);
        return { name, projection };
    }

    static encodeResponse(items: Array<Data | null>): ClientMessage {
        const msg = CM.createForEncode();
        // Response initial frame
        const RESPONSE_HEADER_SIZE = 4 + 8 + 1; // messageType + correlationId + backupAcks = 13
        const buf = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE);
        buf.fill(0);
        buf.writeUInt32LE(MapProjectCodec.RESPONSE_MESSAGE_TYPE >>> 0, 0);
        const UNFRAGMENTED = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
        msg.add(new CM.Frame(buf, UNFRAGMENTED));
        // Encode ListMultiFrame<nullable Data> — encodeContainsNullable pattern
        msg.add(new CM.Frame(Buffer.alloc(0), CM.BEGIN_DATA_STRUCTURE_FLAG));
        for (const item of items) {
            if (item === null) {
                msg.add(CM.NULL_FRAME);
            } else {
                DataCodec.encode(msg, item);
            }
        }
        msg.add(new CM.Frame(Buffer.alloc(0), CM.END_DATA_STRUCTURE_FLAG));
        msg.setFinal();
        return msg;
    }
}
