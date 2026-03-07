/**
 * Discriminated-union message types for the Helios TCP cluster protocol.
 *
 * Wire format: [4-byte BE uint32: JSON length][JSON payload bytes]
 *
 * All messages carry a `type` discriminant so the receiver can switch on them.
 */

import type { BlitzNodeRegistration } from "@zenystx/helios-core/instance/impl/blitz/BlitzClusterTopology";

// ── Existing message types ────────────────────────────────────────────

export interface HelloMsg {
  readonly type: "HELLO";
  /** Logical node ID of the sender (instance name). */
  readonly nodeId: string;
}

export interface MapPutMsg {
  readonly type: "MAP_PUT";
  readonly mapName: string;
  readonly key: unknown;
  readonly value: unknown;
}

export interface MapRemoveMsg {
  readonly type: "MAP_REMOVE";
  readonly mapName: string;
  readonly key: unknown;
}

export interface MapClearMsg {
  readonly type: "MAP_CLEAR";
  readonly mapName: string;
}

/** Near-cache invalidation: tells the peer to evict the cached entry for `key`. */
export interface InvalidateMsg {
  readonly type: "INVALIDATE";
  readonly mapName: string;
  readonly key: unknown;
}

export interface WirePartitionReplica {
  readonly address: { host: string; port: number };
  readonly uuid: string;
}

// ── Block 16.A5: New message types ────────────────────────────────────

/** Serialized member info for wire transfer. */
export interface WireMemberInfo {
  readonly address: { host: string; port: number };
  readonly uuid: string;
  readonly attributes: Record<string, string>;
  readonly liteMember: boolean;
  readonly version: { major: number; minor: number; patch: number };
  readonly memberListJoinVersion: number;
}

/** Join protocol: joiner announces itself to the master. */
export interface JoinRequestMsg {
  readonly type: "JOIN_REQUEST";
  readonly joinerAddress: { host: string; port: number };
  readonly joinerUuid: string;
  readonly clusterName: string;
  readonly partitionCount: number;
  readonly joinerVersion: { major: number; minor: number; patch: number };
}

/** Join protocol: master finalizes the join with the new member list. */
export interface FinalizeJoinMsg {
  readonly type: "FINALIZE_JOIN";
  readonly memberListVersion: number;
  readonly members: WireMemberInfo[];
  readonly masterAddress: { host: string; port: number };
  readonly clusterId: string;
}

/** Member list publish: broadcast updated member list to all nodes. */
export interface MembersUpdateMsg {
  readonly type: "MEMBERS_UPDATE";
  readonly memberListVersion: number;
  readonly members: WireMemberInfo[];
  readonly masterAddress: { host: string; port: number };
  readonly clusterId: string;
}

export interface PartitionStateMsg {
  readonly type: "PARTITION_STATE";
  readonly versions: number[];
  readonly partitions: (WirePartitionReplica | null)[][];
}

/** Periodic heartbeat. */
export interface HeartbeatMsg {
  readonly type: "HEARTBEAT";
  readonly senderUuid: string;
  readonly timestamp: number;
}

/** Request current members view (mastership claim / Finding 7 recovery). */
export interface FetchMembersViewMsg {
  readonly type: "FETCH_MEMBERS_VIEW";
  readonly requesterId: string;
  readonly requestTimestamp: number;
}

/** Response to FETCH_MEMBERS_VIEW. */
export interface MembersViewResponseMsg {
  readonly type: "MEMBERS_VIEW_RESPONSE";
  readonly memberListVersion: number;
  readonly members: WireMemberInfo[];
}

/** Generic operation routing (Block 21.1). */
export interface OperationMsg {
  readonly type: "OPERATION";
  readonly callId: number;
  readonly partitionId: number;
  readonly operationType: string;
  readonly payload: unknown;
  /** Node ID of the sender for response routing. */
  readonly senderId: string;
}

/** Operation response (Phase C). */
export interface OperationResponseMsg {
  readonly type: "OPERATION_RESPONSE";
  readonly callId: number;
  readonly payload: unknown;
  readonly error: string | null;
}

/** Backup operation (Phase D). */
export interface BackupMsg {
  readonly type: "BACKUP";
  readonly callId: number;
  readonly partitionId: number;
  readonly replicaIndex: number;
  readonly operationType: string;
  readonly payload: unknown;
}

/** Sync backup acknowledgement (Phase D). */
export interface BackupAckMsg {
  readonly type: "BACKUP_ACK";
  readonly callId: number;
}

export interface QueueRequestMsg {
  readonly type: "QUEUE_REQUEST";
  readonly requestId: string;
  readonly sourceNodeId: string;
  readonly queueName: string;
  readonly operation: string;
  readonly timeoutMs?: number;
  readonly data?: EncodedData;
  readonly dataList?: EncodedData[];
  readonly maxElements?: number;
}

export interface QueueResponseMsg {
  readonly type: "QUEUE_RESPONSE";
  readonly requestId: string;
  readonly success: boolean;
  readonly resultType: "none" | "boolean" | "number" | "data" | "data-array";
  readonly booleanResult?: boolean;
  readonly numberResult?: number;
  readonly data?: EncodedData;
  readonly dataList?: EncodedData[];
  readonly error?: string;
}

export interface QueueStateItemMsg {
  readonly itemId: number;
  readonly enqueuedAt: number;
  readonly data: EncodedData;
}

export interface QueueStateSyncMsg {
  readonly type: "QUEUE_STATE_SYNC";
  readonly requestId: string | null;
  readonly sourceNodeId: string;
  readonly queueName: string;
  readonly version: number;
  readonly nextItemId: number;
  readonly items: QueueStateItemMsg[];
  readonly ownerNodeId: string;
  readonly counters: {
    readonly offerOperationCount: number;
    readonly rejectedOfferOperationCount: number;
    readonly pollOperationCount: number;
    readonly emptyPollOperationCount: number;
    readonly otherOperationCount: number;
    readonly eventOperationCount: number;
  };
}

export interface QueueStateAckMsg {
  readonly type: "QUEUE_STATE_ACK";
  readonly requestId: string;
  readonly queueName: string;
  readonly version: number;
}

export interface QueueEventMsg {
  readonly type: "QUEUE_EVENT";
  readonly queueName: string;
  readonly eventType: "ADDED" | "REMOVED";
  readonly sourceNodeId: string;
  readonly data: EncodedData | null;
}

export interface TopicMessageMsg {
  readonly type: "TOPIC_MESSAGE";
  readonly topicName: string;
  readonly data: EncodedData;
  readonly publishTime: number;
  readonly sourceNodeId: string;
  readonly sequence: number | null;
}

export interface TopicPublishRequestMsg {
  readonly type: "TOPIC_PUBLISH_REQUEST";
  readonly requestId: string;
  readonly topicName: string;
  readonly data: EncodedData;
  readonly publishTime: number;
  readonly sourceNodeId: string;
}

export interface TopicAckMsg {
  readonly type: "TOPIC_ACK";
  readonly requestId: string;
  readonly error?: string;
}

// ── Blitz topology protocol messages ─────────────────────────────────

export interface BlitzNodeRegisterMsg {
  readonly type: "BLITZ_NODE_REGISTER";
  readonly registration: BlitzNodeRegistration;
}

export interface BlitzNodeRemoveMsg {
  readonly type: "BLITZ_NODE_REMOVE";
  readonly memberId: string;
}

export interface BlitzTopologyRequestMsg {
  readonly type: "BLITZ_TOPOLOGY_REQUEST";
  readonly requestId: string;
}

export interface BlitzTopologyResponseMsg {
  readonly type: "BLITZ_TOPOLOGY_RESPONSE";
  readonly requestId: string;
  readonly routes: string[];
  readonly masterMemberId: string;
  readonly memberListVersion: number;
  readonly fenceToken: string;
  readonly registrationsComplete: boolean;
  readonly retryAfterMs?: number;
  readonly clientConnectUrl: string;
}

export interface BlitzTopologyAnnounceMsg {
  readonly type: "BLITZ_TOPOLOGY_ANNOUNCE";
  readonly memberListVersion: number;
  readonly routes: string[];
  readonly masterMemberId: string;
  readonly fenceToken: string;
}

export type ClusterMessage =
  | HelloMsg
  | MapPutMsg
  | MapRemoveMsg
  | MapClearMsg
  | InvalidateMsg
  | JoinRequestMsg
  | FinalizeJoinMsg
  | MembersUpdateMsg
  | PartitionStateMsg
  | HeartbeatMsg
  | FetchMembersViewMsg
  | MembersViewResponseMsg
  | OperationMsg
  | OperationResponseMsg
  | BackupMsg
  | BackupAckMsg
  | QueueRequestMsg
  | QueueResponseMsg
  | QueueStateSyncMsg
  | QueueStateAckMsg
  | QueueEventMsg
  | TopicMessageMsg
  | TopicPublishRequestMsg
  | TopicAckMsg
  | BlitzNodeRegisterMsg
  | BlitzNodeRemoveMsg
  | BlitzTopologyRequestMsg
  | BlitzTopologyResponseMsg
  | BlitzTopologyAnnounceMsg;
import type { EncodedData } from "@zenystx/helios-core/cluster/tcp/DataWireCodec";
