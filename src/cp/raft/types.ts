/** Unique identifier for a CP group. */
export interface RaftGroupId {
  readonly name: string;
  /** Random seed for hash distribution. */
  readonly seed: bigint;
  /** Monotonic group instance ID (incremented on re-creation). */
  readonly id: bigint;
}

/** Identity of a CP member within a Raft group. */
export interface RaftEndpoint {
  /** UUID of the cluster member. */
  readonly uuid: string;
  readonly address: { readonly host: string; readonly port: number };
}

/** A single entry in the Raft log. */
export interface RaftLogEntry {
  readonly term: number;
  readonly index: number;
  readonly command: RaftCommand;
}

/**
 * Typed command that the state machine interprets.
 * The `type` field is a discriminant used by RaftStateMachine.apply().
 */
export interface RaftCommand {
  /** Discriminant: e.g. 'ATOMIC_LONG_ADD', 'SEM_ACQUIRE', 'SESSION_CREATE', 'MEMBERSHIP_CHANGE', 'NOP' */
  readonly type: string;
  /** Which CP group this command targets. */
  readonly groupId: string;
  /** State machine key (service-specific). */
  readonly key: string;
  /** Serialized payload (service-specific). */
  readonly payload: unknown;
  /** Optional session ID for session-aware commands. */
  readonly sessionId?: string;
  /** Invocation UUID for idempotency. */
  readonly invocationUid?: string;
}

/** Snapshot of a Raft group's state machine at a given log index. */
export interface SnapshotEntry {
  readonly term: number;
  readonly index: number;
  /** Serialized state machine snapshot. */
  readonly data: Uint8Array;
  /** Group members at the time of the snapshot. */
  readonly groupMembers: RaftEndpoint[];
  /** Log index of the last membership change included in this snapshot. */
  readonly groupMembersLogIndex: number;
}

/** Raft node role in the consensus protocol. */
export type RaftRole = 'FOLLOWER' | 'CANDIDATE' | 'LEADER';

/** Result of a Raft proposal. */
export interface RaftProposalResult<T = unknown> {
  readonly commitIndex: number;
  readonly result: T;
}

/**
 * Pending proposal: a command awaiting majority commit.
 * The leader creates these; they resolve/reject when committed or the leader steps down.
 */
export interface PendingProposal {
  readonly entry: RaftLogEntry;
  readonly resolve: (result: RaftProposalResult) => void;
  readonly reject: (error: Error) => void;
}
