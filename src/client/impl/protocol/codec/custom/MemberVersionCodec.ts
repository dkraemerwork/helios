/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.custom.MemberVersionCodec}.
 *
 * Wire format: BEGIN_FRAME + initial frame (3 bytes: major, minor, patch) + END_FRAME
 */
import { ClientMessage } from '@helios/client/impl/protocol/ClientMessage';
import { MemberVersion } from '@helios/version/MemberVersion';
import { CodecUtil } from '../builtin/CodecUtil';

const INITIAL_FRAME_SIZE = 3; // major(1) + minor(1) + patch(1)
const MAJOR_OFFSET = 0;
const MINOR_OFFSET = 1;
const PATCH_OFFSET = 2;

export class MemberVersionCodec {
    private constructor() {}

    static encode(clientMessage: ClientMessage, version: MemberVersion): void {
        clientMessage.add(ClientMessage.Frame.createStaticFrame(ClientMessage.BEGIN_DATA_STRUCTURE_FLAG));
        const buf = Buffer.allocUnsafe(INITIAL_FRAME_SIZE);
        buf.writeUInt8(version.getMajor() & 0xff, MAJOR_OFFSET);
        buf.writeUInt8(version.getMinor() & 0xff, MINOR_OFFSET);
        buf.writeUInt8(version.getPatch() & 0xff, PATCH_OFFSET);
        clientMessage.add(new ClientMessage.Frame(buf));
        clientMessage.add(ClientMessage.Frame.createStaticFrame(ClientMessage.END_DATA_STRUCTURE_FLAG));
    }

    static decode(iterator: ClientMessage.ForwardFrameIterator): MemberVersion {
        // consume BEGIN
        iterator.next();
        const frame = iterator.next();
        const major = frame.content.readUInt8(MAJOR_OFFSET);
        const minor = frame.content.readUInt8(MINOR_OFFSET);
        const patch = frame.content.readUInt8(PATCH_OFFSET);
        CodecUtil.fastForwardToEndFrame(iterator);
        return MemberVersion.of(major, minor, patch);
    }
}
