/**
 * Port of {@code com.hazelcast.client.impl.protocol.util.ClientMessageSplitter}.
 */
import { ClientMessage, ClientMessageFrame } from '@helios/client/impl/protocol/ClientMessage';

let fragmentationIdSequence = 0n;

function nextFragmentationId(): bigint {
    return ++fragmentationIdSequence;
}

const SIZE = 6; // SIZE_OF_FRAME_LENGTH_AND_FLAGS

export class ClientMessageSplitter {
    private constructor() {}

    static getFragments(maxFrameSize: number, clientMessage: ClientMessage): ClientMessage[] {
        if (clientMessage.getFrameLength() <= maxFrameSize) {
            return [clientMessage];
        }

        const fragmentationId = nextFragmentationId();
        const fragments: ClientMessage[] = [];

        let fragment: ClientMessage | null = null;
        let fragmentSize = 0;
        let isFirst = true;

        let f: ClientMessageFrame | null = clientMessage.getStartFrame();
        while (f !== null) {
            const frameSize = SIZE + f.content.length;

            if (fragment === null) {
                fragment = ClientMessage.createForEncode();
                fragmentSize = 0;

                // Fragmentation header frame: 8-byte fragmentation ID (LE bigint)
                const headerContent = Buffer.allocUnsafe(8);
                headerContent.writeBigInt64LE(fragmentationId, 0);
                const headerFlags = isFirst ? ClientMessage.BEGIN_FRAGMENT_FLAG : 0;
                fragment.add(new ClientMessageFrame(headerContent, headerFlags));
                fragmentSize += SIZE + 8;
                isFirst = false;
            }

            if (fragmentSize + frameSize <= maxFrameSize || fragment.getStartFrame().next === null) {
                const contentCopy = Buffer.from(f.content);
                fragment.add(new ClientMessageFrame(contentCopy, f.flags & ~ClientMessage.IS_FINAL_FLAG));
                fragmentSize += frameSize;
                f = f.next;
            } else {
                ClientMessageSplitter._finalizeFragment(fragment, false);
                fragments.push(fragment);
                fragment = null;
                fragmentSize = 0;
            }
        }

        if (fragment !== null) {
            ClientMessageSplitter._finalizeFragment(fragment, true);
            fragments.push(fragment);
        }

        return fragments;
    }

    private static _finalizeFragment(fragment: ClientMessage, isLast: boolean): void {
        let lastFrame = fragment.getStartFrame();
        while (lastFrame.next !== null) {
            lastFrame = lastFrame.next;
        }
        if (isLast) {
            lastFrame.flags |= ClientMessage.END_FRAGMENT_FLAG | ClientMessage.IS_FINAL_FLAG;
        } else {
            lastFrame.flags |= ClientMessage.END_FRAGMENT_FLAG;
        }
    }
}
