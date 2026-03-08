import type { ClusterMessage } from '@zenystx/helios-core/cluster/tcp/ClusterMessage';
import { serializeBinaryClusterMessage as serializeBinaryClusterMessageBase } from '@zenystx/helios-core/cluster/tcp/BinarySerializationStrategy';

export function serializeBinaryClusterMessage(message: ClusterMessage): Uint8Array {
    if (message.type === 'HEARTBEAT' && message.senderUuid === 'fail-on-worker') {
        throw new Error('intentional worker serializer failure');
    }
    return serializeBinaryClusterMessageBase(message);
}
