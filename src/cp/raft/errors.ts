import type { RaftEndpoint } from './types.js';

/**
 * Thrown when a non-leader receives a client request.
 * Contains the leader hint so the client can redirect.
 */
export class NotLeaderException extends Error {
  readonly name = 'NotLeaderException';
  constructor(
    readonly leaderEndpoint: RaftEndpoint | null,
    readonly groupId: string,
  ) {
    super(
      leaderEndpoint
        ? `Not the leader. Leader is ${leaderEndpoint.uuid} at ${leaderEndpoint.address.host}:${leaderEndpoint.address.port}`
        : `Not the leader. Leader is unknown for group '${groupId}'`,
    );
  }
}

/**
 * Thrown when the leader cannot replicate due to back-pressure.
 * The client should retry after a delay.
 */
export class CannotReplicateException extends Error {
  readonly name = 'CannotReplicateException';
  constructor(readonly groupId: string) {
    super(`Cannot replicate: too many uncommitted entries for group '${groupId}'`);
  }
}

/**
 * Thrown when a leader discovers its entry was truncated by a new leader.
 * The outcome of the original operation is indeterminate.
 */
export class LeaderDemotedException extends Error {
  readonly name = 'LeaderDemotedException';
  constructor(readonly groupId: string, readonly term: number) {
    super(`Leader demoted in group '${groupId}' at term ${term}`);
  }
}

/**
 * Thrown by a follower receiving an AppendRequest with a stale term.
 */
export class StaleAppendRequestException extends Error {
  readonly name = 'StaleAppendRequestException';
  constructor(readonly expectedTerm: number, readonly actualTerm: number) {
    super(`Stale append request: expected term ${expectedTerm}, got ${actualTerm}`);
  }
}

/**
 * Thrown when operating on a destroyed CP group.
 */
export class CPGroupDestroyedException extends Error {
  readonly name = 'CPGroupDestroyedException';
  constructor(readonly groupId: string) {
    super(`CP group '${groupId}' has been destroyed`);
  }
}
