import type { ClusterMessage } from '../../cluster/tcp/ClusterMessage.js';
import type { RaftNode, RaftMessageSender } from './RaftNode.js';
import type { RaftEndpoint } from './types.js';

/**
 * Routes incoming Raft-type ClusterMessages to the appropriate RaftNode
 * based on the groupId field.
 */
export class RaftMessageRouter {
  private readonly _nodes = new Map<string, RaftNode>();
  private _sender: RaftMessageSender | null = null;

  setSender(sender: RaftMessageSender): void {
    this._sender = sender;
  }

  registerNode(groupId: string, node: RaftNode): void {
    this._nodes.set(groupId, node);
  }

  unregisterNode(groupId: string): void {
    this._nodes.delete(groupId);
  }

  /**
   * Handle an incoming cluster message. Returns true if the message was
   * a Raft message and was routed, false otherwise.
   */
  async handleMessage(msg: ClusterMessage): Promise<boolean> {
    switch (msg.type) {
      case 'RAFT_PRE_VOTE_REQUEST': {
        const node = this._nodes.get(msg.groupId);
        if (node === undefined) return false;
        const response = node.handlePreVoteRequest(msg);
        const target = this._findEndpoint(node, msg.candidateId);
        if (target !== null) {
          this._sender?.sendRaftMessage(target, response);
        }
        return true;
      }

      case 'RAFT_PRE_VOTE_RESPONSE': {
        const node = this._nodes.get(msg.groupId);
        if (node === undefined) return false;
        node.handlePreVoteResponse(msg);
        return true;
      }

      case 'RAFT_VOTE_REQUEST': {
        const node = this._nodes.get(msg.groupId);
        if (node === undefined) return false;
        const response = node.handleVoteRequest(msg);
        const target = this._findEndpoint(node, msg.candidateId);
        if (target !== null) {
          this._sender?.sendRaftMessage(target, response);
        }
        return true;
      }

      case 'RAFT_VOTE_RESPONSE': {
        const node = this._nodes.get(msg.groupId);
        if (node === undefined) return false;
        node.handleVoteResponse(msg);
        return true;
      }

      case 'RAFT_APPEND_REQUEST': {
        const node = this._nodes.get(msg.groupId);
        if (node === undefined) return false;
        const response = node.handleAppendRequest(msg);
        const target = this._findEndpoint(node, msg.leaderId);
        if (target !== null) {
          this._sender?.sendRaftMessage(target, response);
        }
        return true;
      }

      case 'RAFT_APPEND_SUCCESS':
      case 'RAFT_APPEND_FAILURE': {
        const node = this._nodes.get(msg.groupId);
        if (node === undefined) return false;
        node.handleAppendResponse(msg);
        return true;
      }

      case 'RAFT_INSTALL_SNAPSHOT': {
        const node = this._nodes.get(msg.groupId);
        if (node === undefined) return false;
        const response = node.handleInstallSnapshot(msg);
        const target = this._findEndpoint(node, msg.leaderId);
        if (target !== null) {
          this._sender?.sendRaftMessage(target, response);
        }
        return true;
      }

      case 'RAFT_INSTALL_SNAPSHOT_RESPONSE': {
        const node = this._nodes.get(msg.groupId);
        if (node === undefined) return false;
        node.handleInstallSnapshotResponse(msg);
        return true;
      }

      case 'RAFT_TRIGGER_ELECTION': {
        const node = this._nodes.get(msg.groupId);
        if (node === undefined) return false;
        node.handleTriggerLeaderElection();
        return true;
      }

      default:
        return false;
    }
  }

  /** Finds a member endpoint by UUID from the given node's member list. */
  private _findEndpoint(node: RaftNode, uuid: string): RaftEndpoint | null {
    return node.getMembers().find((m) => m.uuid === uuid) ?? null;
  }
}
