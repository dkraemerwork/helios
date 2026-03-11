/**
 * Discriminated-union message types for the Helios TCP cluster protocol.
 *
 * Wire format: [4-byte BE uint32: payload length][binary payload bytes]
 *
 * All messages carry a `type` discriminant so the receiver can switch on them.
 */

import type { EncodedData } from "@zenystx/helios-core/cluster/tcp/DataWireCodec";
import type { BlitzNodeRegistration } from "@zenystx/helios-core/instance/impl/blitz/BlitzClusterTopology";
import type { TransactionBackupMessage } from "@zenystx/helios-core/transaction/impl/TransactionManagerServiceImpl";

// ── Existing message types ────────────────────────────────────────────

export interface HelloMsg {
  readonly type: "HELLO";
  /** Logical node ID of the sender (instance name). */
  readonly nodeId: string;
  /** Stable cluster transport protocol identity. */
  readonly protocol: string;
  /** Highest protocol version supported by the sender. */
  readonly protocolVersion: number;
  /** Lowest protocol version still accepted by the sender. */
  readonly minSupportedProtocolVersion: number;
  /** Optional sender capabilities understood by this peer. */
  readonly capabilities: string[];
  /** Capabilities the remote peer must advertise or the handshake fails closed. */
  readonly requiredCapabilities: string[];
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

export interface WireRestEndpointInfo {
  readonly host: string;
  readonly port: number;
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
  readonly clientEndpoint: WireRestEndpointInfo | null;
  readonly restEndpoint: WireRestEndpointInfo | null;
}

/** Join protocol: joiner announces itself to the master. */
export interface JoinRequestMsg {
  readonly type: "JOIN_REQUEST";
  readonly joinerAddress: { host: string; port: number };
  readonly joinerUuid: string;
  readonly clusterName: string;
  readonly partitionCount: number;
  readonly joinerVersion: { major: number; minor: number; patch: number };
  readonly joinerClientEndpoint: WireRestEndpointInfo | null;
  readonly joinerRestEndpoint: WireRestEndpointInfo | null;
}

/** Join protocol: master finalizes the join with the new member list. */
export interface FinalizeJoinMsg {
  readonly type: "FINALIZE_JOIN";
  readonly memberListVersion: number;
  readonly members: WireMemberInfo[];
  readonly masterAddress: { host: string; port: number };
  readonly clusterId: string;
  readonly clusterState?: string;
}

/** Member list publish: broadcast updated member list to all nodes. */
export interface MembersUpdateMsg {
  readonly type: "MEMBERS_UPDATE";
  readonly memberListVersion: number;
  readonly members: WireMemberInfo[];
  readonly masterAddress: { host: string; port: number };
  readonly clusterId: string;
  readonly clusterState?: string;
}

export interface PartitionStateMsg {
  readonly type: "PARTITION_STATE";
  readonly versions: number[];
  readonly partitions: (WirePartitionReplica | null)[][];
  readonly clusterState?: string;
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
  readonly factoryId: number;
  readonly classId: number;
  readonly payload: Buffer;
  /** Node ID of the sender for response routing. */
  readonly senderId: string;
}

/** Operation response (Phase C). */
export interface OperationResponseMsg {
  readonly type: "OPERATION_RESPONSE";
  readonly callId: number;
  readonly backupAcks: number;
  readonly backupMemberIds: string[];
  readonly payload: unknown;
  readonly error: string | null;
}

/** Backup operation (Phase D). */
export interface BackupMsg {
  readonly type: "BACKUP";
  readonly callId: number;
  readonly partitionId: number;
  readonly replicaIndex: number;
  readonly senderId: string;
  readonly callerId: string;
  readonly sync: boolean;
  readonly replicaVersions: string[];
  readonly factoryId: number;
  readonly classId: number;
  readonly payload: Buffer;
}

/** Sync backup acknowledgement (Phase D). */
export interface BackupAckMsg {
  readonly type: "BACKUP_ACK";
  readonly callId: number;
  readonly senderId: string;
}

export interface RecoveryAntiEntropyMsg {
  readonly type: "RECOVERY_ANTI_ENTROPY";
  readonly senderId: string;
  readonly partitionId: number;
  readonly replicaIndex: number;
  readonly primaryVersions: string[];
  readonly namespaceVersions: Record<string, string[]>;
}

export interface RecoverySyncRequestMsg {
  readonly type: "RECOVERY_SYNC_REQUEST";
  readonly requestId: string;
  readonly requesterId: string;
  readonly partitionId: number;
  readonly replicaIndex: number;
  readonly dirtyNamespaces: string[];
}

export interface RecoverySyncNamespaceStateMsg {
  readonly namespace: string;
  readonly entries: readonly [EncodedData, EncodedData][];
  readonly estimatedSizeBytes: number;
}

export interface RecoverySyncResponseMsg {
  readonly type: "RECOVERY_SYNC_RESPONSE";
  readonly requestId: string;
  readonly partitionId: number;
  readonly replicaIndex: number;
  readonly chunkIndex: number;
  readonly chunkCount: number;
  readonly versions: string[];
  readonly namespaceVersions: Record<string, string[]>;
  readonly namespaceStates: readonly RecoverySyncNamespaceStateMsg[];
}

export interface QueueRequestMsg {
  readonly type: "QUEUE_REQUEST";
  readonly requestId: string;
  readonly sourceNodeId: string;
  readonly queueName: string;
  readonly operation: string;
  readonly txnDedupeId?: string;
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
  readonly appliedTxnOpIds: string[];
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

export interface ReliableTopicPublishRequestMsg {
  readonly type: "RELIABLE_TOPIC_PUBLISH_REQUEST";
  readonly requestId: string;
  readonly topicName: string;
  readonly data: EncodedData;
  readonly sourceNodeId: string;
}

export interface ReliableTopicPublishAckMsg {
  readonly type: "RELIABLE_TOPIC_PUBLISH_ACK";
  readonly requestId: string;
  readonly error?: string;
}

export interface ReliableTopicMessageMsg {
  readonly type: "RELIABLE_TOPIC_MESSAGE";
  readonly topicName: string;
  readonly sequence: number;
  readonly publishTime: number;
  readonly publisherAddress: string | null;
  readonly data: EncodedData;
}

export interface ReliableTopicBackupMsg {
  readonly type: "RELIABLE_TOPIC_BACKUP";
  readonly requestId: string | null;
  readonly topicName: string;
  readonly sequence: number;
  readonly publishTime: number;
  readonly publisherAddress: string | null;
  readonly data: EncodedData;
  readonly sourceNodeId: string;
}

export interface ReliableTopicBackupAckMsg {
  readonly type: "RELIABLE_TOPIC_BACKUP_ACK";
  readonly requestId: string;
}

export interface ReliableTopicDestroyMsg {
  readonly type: "RELIABLE_TOPIC_DESTROY";
  readonly topicName: string;
}

// ── Distributed List messages ─────────────────────────────────────────

export interface ListRequestMsg {
  readonly type: "LIST_REQUEST";
  readonly requestId: string;
  readonly sourceNodeId: string;
  readonly listName: string;
  readonly operation: string;
  readonly txnDedupeId?: string;
  readonly index?: number;
  readonly fromIndex?: number;
  readonly toIndex?: number;
  readonly data?: EncodedData;
  readonly dataList?: EncodedData[];
}

export interface ListResponseMsg {
  readonly type: "LIST_RESPONSE";
  readonly requestId: string;
  readonly success: boolean;
  readonly resultType: "none" | "boolean" | "number" | "data" | "data-array";
  readonly booleanResult?: boolean;
  readonly numberResult?: number;
  readonly data?: EncodedData;
  readonly dataList?: EncodedData[];
  readonly error?: string;
}

export interface ListStateSyncMsg {
  readonly type: "LIST_STATE_SYNC";
  readonly requestId: string | null;
  readonly sourceNodeId: string;
  readonly listName: string;
  readonly version: number;
  readonly items: EncodedData[];
  readonly appliedTxnOpIds: string[];
}

export interface ListStateAckMsg {
  readonly type: "LIST_STATE_ACK";
  readonly requestId: string;
  readonly listName: string;
  readonly version: number;
}

export interface ListEventMsg {
  readonly type: "LIST_EVENT";
  readonly listName: string;
  readonly eventType: "ADDED" | "REMOVED";
  readonly sourceNodeId: string;
  readonly data: EncodedData | null;
}

// ── Distributed Set messages ──────────────────────────────────────────

export interface SetRequestMsg {
  readonly type: "SET_REQUEST";
  readonly requestId: string;
  readonly sourceNodeId: string;
  readonly setName: string;
  readonly operation: string;
  readonly txnDedupeId?: string;
  readonly data?: EncodedData;
  readonly dataList?: EncodedData[];
}

export interface SetResponseMsg {
  readonly type: "SET_RESPONSE";
  readonly requestId: string;
  readonly success: boolean;
  readonly resultType: "none" | "boolean" | "number" | "data-array";
  readonly booleanResult?: boolean;
  readonly numberResult?: number;
  readonly dataList?: EncodedData[];
  readonly error?: string;
}

export interface SetStateSyncMsg {
  readonly type: "SET_STATE_SYNC";
  readonly requestId: string | null;
  readonly sourceNodeId: string;
  readonly setName: string;
  readonly version: number;
  readonly items: EncodedData[];
  readonly appliedTxnOpIds: string[];
}

export interface SetStateAckMsg {
  readonly type: "SET_STATE_ACK";
  readonly requestId: string;
  readonly setName: string;
  readonly version: number;
}

export interface SetEventMsg {
  readonly type: "SET_EVENT";
  readonly setName: string;
  readonly eventType: "ADDED" | "REMOVED";
  readonly sourceNodeId: string;
  readonly data: EncodedData | null;
}

// ── Distributed MultiMap messages ─────────────────────────────────────

export interface MultiMapRequestMsg {
  readonly type: "MULTIMAP_REQUEST";
  readonly requestId: string;
  readonly sourceNodeId: string;
  readonly mapName: string;
  readonly operation: string;
  readonly txnDedupeId?: string;
  readonly keyData?: EncodedData;
  readonly valueData?: EncodedData;
  readonly dataList?: EncodedData[];
}

export interface MultiMapResponseMsg {
  readonly type: "MULTIMAP_RESPONSE";
  readonly requestId: string;
  readonly success: boolean;
  readonly resultType: "none" | "boolean" | "number" | "data-array" | "entry-set";
  readonly booleanResult?: boolean;
  readonly numberResult?: number;
  readonly dataList?: EncodedData[];
  readonly entrySet?: Array<[EncodedData, EncodedData]>;
  readonly error?: string;
}

export interface MultiMapStateSyncMsg {
  readonly type: "MULTIMAP_STATE_SYNC";
  readonly requestId: string | null;
  readonly sourceNodeId: string;
  readonly mapName: string;
  readonly version: number;
  readonly entries: Array<[EncodedData, EncodedData[]]>;
  readonly valueCollectionType: "SET" | "LIST";
  readonly appliedTxnOpIds: string[];
}

export interface MultiMapStateAckMsg {
  readonly type: "MULTIMAP_STATE_ACK";
  readonly requestId: string;
  readonly mapName: string;
  readonly version: number;
}

export interface MultiMapEventMsg {
  readonly type: "MULTIMAP_EVENT";
  readonly mapName: string;
  readonly eventType: "ADDED" | "REMOVED" | "CLEARED";
  readonly sourceNodeId: string;
  readonly keyData: EncodedData | null;
  readonly valueData: EncodedData | null;
  readonly oldValueData: EncodedData | null;
  readonly numberOfAffectedEntries: number;
}

// ── Distributed ReplicatedMap messages ───────────────────────────────

export interface ReplicatedMapPutMsg {
  readonly type: "REPLICATED_MAP_PUT";
  readonly mapName: string;
  readonly version: number;
  readonly sourceNodeId: string;
  readonly keyData: EncodedData;
  readonly valueData: EncodedData;
}

export interface ReplicatedMapRemoveMsg {
  readonly type: "REPLICATED_MAP_REMOVE";
  readonly mapName: string;
  readonly version: number;
  readonly sourceNodeId: string;
  readonly keyData: EncodedData;
}

export interface ReplicatedMapClearMsg {
  readonly type: "REPLICATED_MAP_CLEAR";
  readonly mapName: string;
  readonly version: number;
  readonly sourceNodeId: string;
}

export interface ReplicatedMapStateSyncMsg {
  readonly type: "REPLICATED_MAP_STATE_SYNC";
  readonly requestId: string | null;
  readonly sourceNodeId: string;
  readonly mapName: string;
  readonly version: number;
  readonly entries: Array<[EncodedData, EncodedData]>;
}

export interface ReplicatedMapStateAckMsg {
  readonly type: "REPLICATED_MAP_STATE_ACK";
  readonly requestId: string;
  readonly mapName: string;
  readonly version: number;
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

export interface TransactionBackupReplicationMsg {
  readonly type: "TXN_BACKUP_REPLICATION";
  readonly requestId: string | null;
  readonly sourceNodeId: string;
  readonly payload: TransactionBackupMessage;
}

export interface TransactionBackupReplicationAckMsg {
  readonly type: "TXN_BACKUP_REPLICATION_ACK";
  readonly requestId: string;
  readonly txnId: string;
  readonly applied: boolean;
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
  | RecoveryAntiEntropyMsg
  | RecoverySyncRequestMsg
  | RecoverySyncResponseMsg
  | QueueRequestMsg
  | QueueResponseMsg
  | QueueStateSyncMsg
  | QueueStateAckMsg
  | QueueEventMsg
  | TopicMessageMsg
  | TopicPublishRequestMsg
  | TopicAckMsg
  | ReliableTopicPublishRequestMsg
  | ReliableTopicPublishAckMsg
  | ReliableTopicMessageMsg
  | ReliableTopicBackupMsg
  | ReliableTopicBackupAckMsg
  | ReliableTopicDestroyMsg
  | ListRequestMsg
  | ListResponseMsg
  | ListStateSyncMsg
  | ListStateAckMsg
  | ListEventMsg
  | SetRequestMsg
  | SetResponseMsg
  | SetStateSyncMsg
  | SetStateAckMsg
  | SetEventMsg
  | MultiMapRequestMsg
  | MultiMapResponseMsg
  | MultiMapStateSyncMsg
  | MultiMapStateAckMsg
  | MultiMapEventMsg
  | ReplicatedMapPutMsg
  | ReplicatedMapRemoveMsg
  | ReplicatedMapClearMsg
  | ReplicatedMapStateSyncMsg
  | ReplicatedMapStateAckMsg
  | BlitzNodeRegisterMsg
  | BlitzNodeRemoveMsg
  | BlitzTopologyRequestMsg
  | BlitzTopologyResponseMsg
  | BlitzTopologyAnnounceMsg
  | TransactionBackupReplicationMsg
  | TransactionBackupReplicationAckMsg;
