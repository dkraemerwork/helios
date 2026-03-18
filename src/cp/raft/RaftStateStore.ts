import type { RaftLogEntry, SnapshotEntry } from './types.js';

/**
 * Durable state store for a single Raft group.
 * Implementations must guarantee that writes are durable (fsync) before returning.
 */
export interface RaftStateStore {
  /** Persist the current term and the candidate voted for (or null). */
  persistTermAndVote(term: number, votedFor: string | null): Promise<void>;

  /** Read persisted term and vote. Returns {term: 0, votedFor: null} if none. */
  readTermAndVote(): Promise<{ term: number; votedFor: string | null }>;

  /** Append entries to the durable log. Entries must have sequential indices. */
  appendEntries(entries: readonly RaftLogEntry[]): Promise<void>;

  /**
   * Read log entries in range [fromIndex, toIndex] inclusive.
   * Returns empty array if range is out of bounds.
   */
  readEntries(fromIndex: number, toIndex: number): Promise<RaftLogEntry[]>;

  /** Read a single entry by index. Returns null if not found. */
  readEntry(index: number): Promise<RaftLogEntry | null>;

  /**
   * Truncate the log: remove all entries with index > afterIndex.
   * Used when a new leader overwrites conflicting entries.
   */
  truncateAfter(afterIndex: number): Promise<void>;

  /** The index of the last entry in the log, or -1 if empty. */
  lastLogIndex(): number;

  /** The term of the last entry in the log, or 0 if empty. */
  lastLogTerm(): number;

  /** The term of the entry at the given index, or 0 if not found. */
  termAt(index: number): number;

  /** Persist a snapshot. This truncates the log up to snapshot.index. */
  persistSnapshot(snapshot: SnapshotEntry): Promise<void>;

  /** Read the latest snapshot, or null if none. */
  readSnapshot(): Promise<SnapshotEntry | null>;

  /** Flush all pending writes. */
  flush(): Promise<void>;

  /** Close resources. */
  close(): Promise<void>;
}
