import type { RaftEndpoint, RaftLogEntry, SnapshotEntry } from './types.js';

export interface PreVoteRequest {
  readonly type: 'RAFT_PRE_VOTE_REQUEST';
  readonly groupId: string;
  readonly candidateId: string;
  readonly nextTerm: number;
  readonly lastLogTerm: number;
  readonly lastLogIndex: number;
}

export interface PreVoteResponse {
  readonly type: 'RAFT_PRE_VOTE_RESPONSE';
  readonly groupId: string;
  readonly term: number;
  readonly granted: boolean;
  readonly voterId: string;
}

export interface VoteRequest {
  readonly type: 'RAFT_VOTE_REQUEST';
  readonly groupId: string;
  readonly term: number;
  readonly candidateId: string;
  readonly lastLogTerm: number;
  readonly lastLogIndex: number;
}

export interface VoteResponse {
  readonly type: 'RAFT_VOTE_RESPONSE';
  readonly groupId: string;
  readonly term: number;
  readonly voteGranted: boolean;
  readonly voterId: string;
}

export interface AppendRequest {
  readonly type: 'RAFT_APPEND_REQUEST';
  readonly groupId: string;
  readonly term: number;
  readonly leaderId: string;
  readonly prevLogIndex: number;
  readonly prevLogTerm: number;
  readonly entries: readonly RaftLogEntry[];
  readonly leaderCommit: number;
}

export interface AppendSuccessResponse {
  readonly type: 'RAFT_APPEND_SUCCESS';
  readonly groupId: string;
  readonly term: number;
  readonly followerId: string;
  readonly lastLogIndex: number;
}

export interface AppendFailureResponse {
  readonly type: 'RAFT_APPEND_FAILURE';
  readonly groupId: string;
  readonly term: number;
  readonly followerId: string;
  readonly lastLogIndex: number;
}

export interface InstallSnapshotRequest {
  readonly type: 'RAFT_INSTALL_SNAPSHOT';
  readonly groupId: string;
  readonly term: number;
  readonly leaderId: string;
  readonly snapshot: SnapshotEntry;
}

export interface InstallSnapshotResponse {
  readonly type: 'RAFT_INSTALL_SNAPSHOT_RESPONSE';
  readonly groupId: string;
  readonly term: number;
  readonly followerId: string;
  readonly success: boolean;
  readonly lastLogIndex: number;
}

export interface TriggerLeaderElection {
  readonly type: 'RAFT_TRIGGER_ELECTION';
  readonly groupId: string;
}

export interface UpdateRaftGroupMembersCommand {
  readonly type: 'RAFT_UPDATE_MEMBERS';
  readonly groupId: string;
  readonly members: readonly RaftEndpoint[];
  readonly addedMember: RaftEndpoint | null;
  readonly removedMember: RaftEndpoint | null;
}

export type RaftMessage =
  | PreVoteRequest
  | PreVoteResponse
  | VoteRequest
  | VoteResponse
  | AppendRequest
  | AppendSuccessResponse
  | AppendFailureResponse
  | InstallSnapshotRequest
  | InstallSnapshotResponse
  | TriggerLeaderElection;
