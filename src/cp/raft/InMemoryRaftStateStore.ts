import type { RaftStateStore } from './RaftStateStore.js';
import type { RaftLogEntry, SnapshotEntry } from './types.js';

/**
 * Non-durable in-memory implementation of RaftStateStore.
 * Used for single-node mode and testing.
 */
export class InMemoryRaftStateStore implements RaftStateStore {
  private _term = 0;
  private _votedFor: string | null = null;
  private _log: RaftLogEntry[] = [];
  private _snapshot: SnapshotEntry | null = null;
  /**
   * The lowest valid log index. After a snapshot at index N,
   * _logBaseIndex = N + 1 and entries before that are discarded.
   */
  private _logBaseIndex = 0;

  async persistTermAndVote(term: number, votedFor: string | null): Promise<void> {
    this._term = term;
    this._votedFor = votedFor;
  }

  async readTermAndVote(): Promise<{ term: number; votedFor: string | null }> {
    return { term: this._term, votedFor: this._votedFor };
  }

  async appendEntries(entries: readonly RaftLogEntry[]): Promise<void> {
    for (const entry of entries) {
      const offset = entry.index - this._logBaseIndex;
      if (offset < 0) continue; // already compacted
      if (offset < this._log.length) {
        this._log[offset] = entry; // overwrite conflicting
      } else {
        this._log.push(entry);
      }
    }
  }

  async readEntries(fromIndex: number, toIndex: number): Promise<RaftLogEntry[]> {
    const result: RaftLogEntry[] = [];
    for (let i = fromIndex; i <= toIndex; i++) {
      const offset = i - this._logBaseIndex;
      if (offset >= 0 && offset < this._log.length) {
        result.push(this._log[offset]!);
      }
    }
    return result;
  }

  async readEntry(index: number): Promise<RaftLogEntry | null> {
    const offset = index - this._logBaseIndex;
    if (offset < 0 || offset >= this._log.length) return null;
    return this._log[offset] ?? null;
  }

  async truncateAfter(afterIndex: number): Promise<void> {
    const offset = afterIndex - this._logBaseIndex + 1;
    if (offset >= 0 && offset < this._log.length) {
      this._log.length = offset;
    }
  }

  lastLogIndex(): number {
    if (this._log.length === 0) {
      return this._snapshot ? this._snapshot.index : -1;
    }
    return this._logBaseIndex + this._log.length - 1;
  }

  lastLogTerm(): number {
    if (this._log.length === 0) {
      return this._snapshot ? this._snapshot.term : 0;
    }
    return this._log[this._log.length - 1]!.term;
  }

  termAt(index: number): number {
    if (this._snapshot && index === this._snapshot.index) return this._snapshot.term;
    const offset = index - this._logBaseIndex;
    if (offset < 0 || offset >= this._log.length) return 0;
    return this._log[offset]!.term;
  }

  async persistSnapshot(snapshot: SnapshotEntry): Promise<void> {
    this._snapshot = snapshot;
    // Discard log entries up to and including snapshot.index
    const discardCount = snapshot.index - this._logBaseIndex + 1;
    if (discardCount > 0) {
      this._log.splice(0, discardCount);
      this._logBaseIndex = snapshot.index + 1;
    }
  }

  async readSnapshot(): Promise<SnapshotEntry | null> {
    return this._snapshot;
  }

  async flush(): Promise<void> { /* no-op for in-memory */ }
  async close(): Promise<void> { /* no-op */ }
}
