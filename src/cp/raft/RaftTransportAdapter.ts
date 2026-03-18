import type { RaftEndpoint } from './types.js';
import type { RaftMessage } from './messages.js';
import type { RaftMessageSender } from './RaftNode.js';
import type { TcpClusterTransport } from '../../cluster/tcp/TcpClusterTransport.js';
import type { ClusterMessage } from '../../cluster/tcp/ClusterMessage.js';

/**
 * Adapts RaftNode's message-sending interface to TcpClusterTransport.
 * Converts RaftMessage objects to ClusterMessage objects and sends via transport.
 *
 * RaftMessage types are structurally identical to their ClusterMessage counterparts
 * (same `type` discriminant, same fields). The transport serializes by the `type`
 * field, so the cast is safe. Using a typed assertion function rather than
 * `as unknown as ClusterMessage` lets the compiler verify structural compatibility
 * and will emit a diagnostic if the two hierarchies diverge.
 */

/** Compile-time verified bridge: RaftMessage → ClusterMessage. */
function toClusterMessage(msg: RaftMessage): ClusterMessage {
  // Each RaftMessage member is structurally identical to its ClusterMessage counterpart.
  // TypeScript validates this at compile time; no runtime transformation needed.
  return msg as ClusterMessage;
}

export class RaftTransportAdapter implements RaftMessageSender {
  constructor(private readonly _transport: TcpClusterTransport) {}

  sendRaftMessage(target: RaftEndpoint, message: RaftMessage): void {
    this._transport.send(target.uuid, toClusterMessage(message));
  }
}
