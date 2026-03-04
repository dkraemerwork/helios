import type { MapStoreWrapper } from '../MapStoreWrapper.js';
import { DelayedEntryType } from './DelayedEntry.js';
import type { DelayedEntry } from './DelayedEntry.js';

export interface WriteBehindProcessResult<K, V> {
  totalEntries: number;
  successfulEntries: number;
  failedEntries: number;
  batchGroups: number;
  batchFailures: number;
  retryCount: number;
  fallbackBatchCount: number;
  /** Entries that could not be stored even after individual retries — caller should re-queue */
  failed: DelayedEntry<K, V>[];
}

type BatchGroup<K, V> =
  | { type: 'ADD'; entries: DelayedEntry<K, V>[] }
  | { type: 'DELETE'; entries: DelayedEntry<K, V>[] };

const RETRY_TIMES_OF_A_FAILED_STORE_OPERATION = 3;
const RETRY_STORE_AFTER_WAIT_SECONDS = 1;
const RETRY_DELAY_MS = RETRY_STORE_AFTER_WAIT_SECONDS * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export class WriteBehindProcessor<K, V> {
  constructor(
    private readonly _wrapper: MapStoreWrapper<K, V>,
    private readonly _writeBatchSize: number,
  ) {}

  async process(entries: DelayedEntry<K, V>[]): Promise<WriteBehindProcessResult<K, V>> {
    const result: WriteBehindProcessResult<K, V> = {
      totalEntries: entries.length,
      successfulEntries: 0,
      failedEntries: 0,
      batchGroups: 0,
      batchFailures: 0,
      retryCount: 0,
      fallbackBatchCount: 0,
      failed: [],
    };

    if (entries.length === 0) return result;

    const batchGroups = this._buildBatchGroups(entries);

    for (const group of batchGroups) {
      result.batchGroups++;

      const batchSuccess = await this._retryBatch(group, result);

      if (batchSuccess) {
        result.successfulEntries += group.entries.length;
        continue;
      }

      // Batch failed all retries — fall back to individual entries
      result.batchFailures++;
      result.fallbackBatchCount++;

      for (const entry of group.entries) {
        const singleSuccess = await this._retrySingle(entry, result);
        if (singleSuccess) {
          result.successfulEntries++;
        } else {
          result.failedEntries++;
          result.failed.push(entry);
        }
      }
    }

    return result;
  }

  /**
   * Retry a batch operation up to RETRY_TIMES_OF_A_FAILED_STORE_OPERATION times.
   * Returns true if succeeded, false if all retries exhausted.
   */
  private async _retryBatch(group: BatchGroup<K, V>, result: WriteBehindProcessResult<K, V>): Promise<boolean> {
    for (let k = 0; k < RETRY_TIMES_OF_A_FAILED_STORE_OPERATION; k++) {
      try {
        if (group.type === 'ADD') {
          const batch = new Map<K, V>();
          for (const e of group.entries) {
            batch.set(e.key, e.value as V);
          }
          await this._wrapper.storeAll(batch);
        } else {
          const keys = group.entries.map(e => e.key);
          await this._wrapper.deleteAll(keys);
        }
        return true;
      } catch {
        if (k < RETRY_TIMES_OF_A_FAILED_STORE_OPERATION - 1) {
          result.retryCount++;
          await sleep(RETRY_DELAY_MS);
        }
      }
    }
    return false;
  }

  /**
   * Retry a single entry operation up to RETRY_TIMES_OF_A_FAILED_STORE_OPERATION times.
   * Returns true if succeeded, false if all retries exhausted.
   */
  private async _retrySingle(entry: DelayedEntry<K, V>, result: WriteBehindProcessResult<K, V>): Promise<boolean> {
    for (let k = 0; k < RETRY_TIMES_OF_A_FAILED_STORE_OPERATION; k++) {
      try {
        if (entry.type === DelayedEntryType.ADD) {
          await this._wrapper.store(entry.key, entry.value as V);
        } else {
          await this._wrapper.delete(entry.key);
        }
        return true;
      } catch {
        if (k < RETRY_TIMES_OF_A_FAILED_STORE_OPERATION - 1) {
          result.retryCount++;
          await sleep(RETRY_DELAY_MS);
        }
      }
    }
    return false;
  }

  private _buildBatchGroups(entries: DelayedEntry<K, V>[]): BatchGroup<K, V>[] {
    const groups: BatchGroup<K, V>[] = [];
    let i = 0;

    while (i < entries.length) {
      const type = entries[i].type;
      let j = i;

      // Collect consecutive entries of same type up to batchSize
      while (j < entries.length && entries[j].type === type && (j - i) < this._writeBatchSize) {
        j++;
      }

      groups.push({ type: type === DelayedEntryType.ADD ? 'ADD' : 'DELETE', entries: entries.slice(i, j) });
      i = j;
    }

    return groups;
  }
}
