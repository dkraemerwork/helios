import type { RaftEndpoint } from './types.js';
import type { RaftMessage } from './messages.js';
import type { RaftMessageSender } from './RaftNode.js';
import type { TcpClusterTransport } from '../../cluster/tcp/TcpClusterTransport.js';
import type { ClusterMessage } from '../../cluster/tcp/ClusterMessage.js';

/**
 * Adapts RaftNode's message-sending interface to TcpClusterTransport.
 * Converts RaftMessage objects to ClusterMessage objects and sends via transport.
 */
export class RaftTransportAdapter implements RaftMessageSender {
  constructor(private readonly _transport: TcpClusterTransport) {}

  sendRaftMessage(target: RaftEndpoint, message: RaftMessage): void {
    // RaftMessage types directly match ClusterMessage types (same shape)
    // so we can cast directly — the type discriminant is identical.
    this._transport.send(target.uuid, message as unknown as ClusterMessage);
  }
}
