import type { RaftCommand, RaftEndpoint } from './types.js';

/**
 * The deterministic state machine that Raft log entries are applied to.
 * Each CP group has one state machine instance.
 *
 * CRITICAL: apply() must be deterministic. Given the same sequence of commands,
 * every node must produce the exact same state.
 */
export interface RaftStateMachine {
  /**
   * Apply a committed command to the state machine.
   * Returns the result value that the proposer receives.
   * Must be deterministic — no external I/O, no random numbers, no Date.now().
   */
  apply(command: RaftCommand): unknown;

  /**
   * Take a snapshot of the current state machine state.
   * Returns serialized data that can be used to restore the state machine.
   */
  takeSnapshot(): Uint8Array;

  /**
   * Restore the state machine from a snapshot.
   * After this call, the state machine must be in the exact same state
   * as when the snapshot was taken.
   */
  restoreFromSnapshot(data: Uint8Array): void;

  /**
   * Called when the group membership changes.
   */
  onGroupMembersChanged(members: readonly RaftEndpoint[]): void;
}
