/**
 * Discriminated-union message types for the Helios TCP cluster protocol.
 *
 * Wire format: [4-byte BE uint32: JSON length][JSON payload bytes]
 *
 * All messages carry a `type` discriminant so the receiver can switch on them.
 */

// ── Existing message types ────────────────────────────────────────────

export interface HelloMsg {
    readonly type: 'HELLO';
    /** Logical node ID of the sender (instance name). */
    readonly nodeId: string;
}

export interface MapPutMsg {
    readonly type: 'MAP_PUT';
    readonly mapName: string;
    readonly key: unknown;
    readonly value: unknown;
}

export interface MapRemoveMsg {
    readonly type: 'MAP_REMOVE';
    readonly mapName: string;
    readonly key: unknown;
}

export interface MapClearMsg {
    readonly type: 'MAP_CLEAR';
    readonly mapName: string;
}

/** Near-cache invalidation: tells the peer to evict the cached entry for `key`. */
export interface InvalidateMsg {
    readonly type: 'INVALIDATE';
    readonly mapName: string;
    readonly key: unknown;
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
    readonly type: 'JOIN_REQUEST';
    readonly joinerAddress: { host: string; port: number };
    readonly joinerUuid: string;
    readonly clusterName: string;
    readonly partitionCount: number;
    readonly joinerVersion: { major: number; minor: number; patch: number };
}

/** Join protocol: master finalizes the join with the new member list. */
export interface FinalizeJoinMsg {
    readonly type: 'FINALIZE_JOIN';
    readonly memberListVersion: number;
    readonly members: WireMemberInfo[];
    readonly masterAddress: { host: string; port: number };
    readonly clusterId: string;
}

/** Member list publish: broadcast updated member list to all nodes. */
export interface MembersUpdateMsg {
    readonly type: 'MEMBERS_UPDATE';
    readonly memberListVersion: number;
    readonly members: WireMemberInfo[];
}

/** Periodic heartbeat. */
export interface HeartbeatMsg {
    readonly type: 'HEARTBEAT';
    readonly senderUuid: string;
    readonly timestamp: number;
}

/** Request current members view (mastership claim / Finding 7 recovery). */
export interface FetchMembersViewMsg {
    readonly type: 'FETCH_MEMBERS_VIEW';
    readonly requesterId: string;
    readonly requestTimestamp: number;
}

/** Response to FETCH_MEMBERS_VIEW. */
export interface MembersViewResponseMsg {
    readonly type: 'MEMBERS_VIEW_RESPONSE';
    readonly memberListVersion: number;
    readonly members: WireMemberInfo[];
}

/** Generic operation routing (Phase C). */
export interface OperationMsg {
    readonly type: 'OPERATION';
    readonly callId: number;
    readonly partitionId: number;
    readonly operationType: string;
    readonly payload: unknown;
}

/** Operation response (Phase C). */
export interface OperationResponseMsg {
    readonly type: 'OPERATION_RESPONSE';
    readonly callId: number;
    readonly payload: unknown;
    readonly error: string | null;
}

/** Backup operation (Phase D). */
export interface BackupMsg {
    readonly type: 'BACKUP';
    readonly callId: number;
    readonly partitionId: number;
    readonly replicaIndex: number;
    readonly operationType: string;
    readonly payload: unknown;
}

/** Sync backup acknowledgement (Phase D). */
export interface BackupAckMsg {
    readonly type: 'BACKUP_ACK';
    readonly callId: number;
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
    | HeartbeatMsg
    | FetchMembersViewMsg
    | MembersViewResponseMsg
    | OperationMsg
    | OperationResponseMsg
    | BackupMsg
    | BackupAckMsg;
