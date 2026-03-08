/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.custom.MemberInfoCodec}.
 *
 * Wire format:
 *   BEGIN_FRAME
 *   initial frame: uuid(17) + liteMember(1)
 *   AddressCodec
 *   MapCodec (attributes: Map<string,string>)
 *   MemberVersionCodec
 *   BEGIN_FRAME (addressMap list begin)
 *   for each entry: EndpointQualifierCodec + AddressCodec
 *   END_FRAME (addressMap list end)
 *   END_FRAME
 */
import { ClientMessage } from '@zenystx/helios-core/client/impl/protocol/ClientMessage';
import { Address } from '@zenystx/helios-core/cluster/Address';
import { MemberInfo } from '@zenystx/helios-core/cluster/MemberInfo';
import { EndpointQualifier } from '@zenystx/helios-core/instance/EndpointQualifier';
import { CodecUtil } from '../builtin/CodecUtil';
import { BOOLEAN_SIZE_IN_BYTES, FixedSizeTypesCodec, UUID_SIZE_IN_BYTES } from '../builtin/FixedSizeTypesCodec';
import { MapCodec } from '../builtin/MapCodec';
import { AddressCodec } from './AddressCodec';
import { EndpointQualifierCodec } from './EndpointQualifierCodec';
import { MemberVersionCodec } from './MemberVersionCodec';

const UUID_OFFSET = 0;
const LITE_MEMBER_OFFSET = UUID_OFFSET + UUID_SIZE_IN_BYTES; // 17
const INITIAL_FRAME_SIZE = LITE_MEMBER_OFFSET + BOOLEAN_SIZE_IN_BYTES; // 18

export class MemberInfoCodec {
    private constructor() {}

    static encode(clientMessage: ClientMessage, memberInfo: MemberInfo): void {
        clientMessage.add(ClientMessage.Frame.createStaticFrame(ClientMessage.BEGIN_DATA_STRUCTURE_FLAG));

        const buf = Buffer.allocUnsafe(INITIAL_FRAME_SIZE);
        FixedSizeTypesCodec.encodeUUID(buf, UUID_OFFSET, memberInfo.uuid);
        FixedSizeTypesCodec.encodeBoolean(buf, LITE_MEMBER_OFFSET, memberInfo.liteMember);
        clientMessage.add(new ClientMessage.Frame(buf));

        AddressCodec.encode(clientMessage, memberInfo.address);
        MapCodec.encode(clientMessage, memberInfo.attributes);
        MemberVersionCodec.encode(clientMessage, memberInfo.version);

        // addressMap as list of (EndpointQualifier, Address) pairs
        clientMessage.add(ClientMessage.Frame.createStaticFrame(ClientMessage.BEGIN_DATA_STRUCTURE_FLAG));
        for (const [eq, addr] of memberInfo.addressMap) {
            EndpointQualifierCodec.encode(clientMessage, eq);
            AddressCodec.encode(clientMessage, addr);
        }
        clientMessage.add(ClientMessage.Frame.createStaticFrame(ClientMessage.END_DATA_STRUCTURE_FLAG));

        clientMessage.add(ClientMessage.Frame.createStaticFrame(ClientMessage.END_DATA_STRUCTURE_FLAG));
    }

    static decode(iterator: ClientMessage.ForwardFrameIterator): MemberInfo {
        // consume BEGIN
        iterator.next();
        const initialFrame = iterator.next();
        const uuid = FixedSizeTypesCodec.decodeUUID(initialFrame.content, UUID_OFFSET) ?? '';
        const liteMember = FixedSizeTypesCodec.decodeBoolean(initialFrame.content, LITE_MEMBER_OFFSET);

        const address = AddressCodec.decode(iterator);
        const attributes = MapCodec.decode(iterator);
        const version = MemberVersionCodec.decode(iterator);

        // decode addressMap
        const addressMap = new Map<EndpointQualifier, Address>();
        // consume BEGIN of addressMap list
        iterator.next();
        while (iterator.peekNext() !== null && !iterator.peekNext()!.isEndFrame()) {
            const eq = EndpointQualifierCodec.decode(iterator);
            const addr = AddressCodec.decode(iterator);
            addressMap.set(eq, addr);
        }
        // consume END of addressMap list
        iterator.next();

        CodecUtil.fastForwardToEndFrame(iterator);
        return new MemberInfo(address, uuid, attributes, liteMember, version, addressMap);
    }
}
