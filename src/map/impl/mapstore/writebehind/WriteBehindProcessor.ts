import type { MapStoreWrapper } from '../MapStoreWrapper.js';
import { DelayedEntryType } from './DelayedEntry.js';
import type { DelayedEntry } from './DelayedEntry.js';

export interface WriteBehindProcessResult {
  totalEntries: number;
  successfulEntries: number;
  failedEntries: number;
  batchGroups: number;
  batchFailures: number;
  retryCount: number;
  fallbackBatchCount: number;
}

type BatchGroup<K, V> =
  | { type: 'ADD'; entries: DelayedEntry<K, V>[] }
  | { type: 'DELETE'; entries: DelayedEntry<K, V>[] };

const RETRY_COUNT = 3;
const RETRY_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export class WriteBehindProcessor<K, V> {
  constructor(
    private readonly _wrapper: MapStoreWrapper<K, V>,
    private readonly _writeBatchSize: number,
  ) {}

  async process(entries: DelayedEntry<K, V>[]): Promise<WriteBehindProcessResult> {
    const result: WriteBehindProcessResult = {
      totalEntries: entries.length,
      successfulEntries: 0,
      failedEntries: 0,
      batchGroups: 0,
      batchFailures: 0,
      retryCount: 0,
      fallbackBatchCount: 0,
    };

    if (entries.length === 0) return result;

    // Group into consecutive batch groups by type, then split by batchSize
    const batchGroups = this._buildBatchGroups(entries);

    for (const group of batchGroups) {
      result.batchGroups++;
      let batchSuccess = false;
      let attempts = 0;

      // 1 initial + up to 3 retries
      while (attempts <= RETRY_COUNT) {
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
          result.successfulEntries += group.entries.length;
          batchSuccess = true;
          break;
        } catch (_err) {
          attempts++;
          if (attempts <= RETRY_COUNT) {
            result.retryCount++;
            await sleep(RETRY_DELAY_MS);
          }
        }
      }

      if (!batchSuccess) {
        result.batchFailures++;
        result.fallbackBatchCount++;
        // Per-entry fallback: continue-on-error
        for (const entry of group.entries) {
          try {
            if (entry.type === DelayedEntryType.ADD) {
              await this._wrapper.store(entry.key, entry.value as V);
            } else {
              await this._wrapper.delete(entry.key);
            }
            result.successfulEntries++;
          } catch (_err) {
            result.failedEntries++;
            // log in production — continue processing remaining entries
          }
        }
      }
    }

    return result;
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
