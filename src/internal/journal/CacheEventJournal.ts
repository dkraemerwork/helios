/**
 * Port of {@code com.hazelcast.cache.impl.journal.CacheEventJournal} /
 * {@code RingbufferCacheEventJournalImpl}.
 *
 * Manages per-partition EventJournal instances for ICache.
 * Journal instances are keyed by `cacheName:partitionId` to mirror
 * MapEventJournal's per-partition pattern.
 */
import type { EventJournalConfig } from '@zenystx/helios-core/config/EventJournalConfig';
import { EventJournal } from '@zenystx/helios-core/internal/journal/EventJournal';
import type { EventJournalEvent } from '@zenystx/helios-core/internal/journal/EventJournalEvent';
import { EventJournalEventType } from '@zenystx/helios-core/internal/journal/EventJournalEvent';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';

export class CacheEventJournal {
    /** Per (cacheName:partitionId) journal instances. */
    private readonly _journals = new Map<string, EventJournal>();
    /** Per-cache config. */
    private readonly _configs = new Map<string, EventJournalConfig>();

    registerConfig(cacheName: string, config: EventJournalConfig): void {
        this._configs.set(cacheName, config);
    }

    isEnabled(cacheName: string): boolean {
        const config = this._configs.get(cacheName);
        return config !== undefined && config.isEnabled();
    }

    private _key(cacheName: string, partitionId: number): string {
        return `${cacheName}:${partitionId}`;
    }

    private _getOrCreate(cacheName: string, partitionId: number): EventJournal | null {
        const config = this._configs.get(cacheName);
        if (!config || !config.isEnabled()) return null;

        const key = this._key(cacheName, partitionId);
        let journal = this._journals.get(key);
        if (!journal) {
            journal = new EventJournal(config.getCapacity(), config.getTimeToLiveSeconds());
            this._journals.set(key, journal);
        }
        return journal;
    }

    /** Record a CREATE/UPDATE event (put or replace). */
    writeAddEvent(
        cacheName: string,
        partitionId: number,
        key: Data,
        oldValue: Data | null,
        newValue: Data,
    ): bigint | null {
        const journal = this._getOrCreate(cacheName, partitionId);
        if (!journal) return null;
        const eventType = oldValue !== null ? EventJournalEventType.UPDATED : EventJournalEventType.ADDED;
        return journal.add(key, oldValue, newValue, eventType);
    }

    /** Record a REMOVE event. */
    writeRemoveEvent(
        cacheName: string,
        partitionId: number,
        key: Data,
        oldValue: Data | null,
    ): bigint | null {
        const journal = this._getOrCreate(cacheName, partitionId);
        if (!journal) return null;
        return journal.add(key, oldValue, null, EventJournalEventType.REMOVED);
    }

    /** Record an EVICTION event. */
    writeEvictEvent(
        cacheName: string,
        partitionId: number,
        key: Data,
        oldValue: Data | null,
    ): bigint | null {
        const journal = this._getOrCreate(cacheName, partitionId);
        if (!journal) return null;
        return journal.add(key, oldValue, null, EventJournalEventType.EVICTED);
    }

    readMany(
        cacheName: string,
        partitionId: number,
        startSequence: bigint,
        minCount: number,
        maxCount: number,
        predicate?: (event: EventJournalEvent) => boolean,
    ): EventJournalEvent[] {
        const journal = this._getOrCreate(cacheName, partitionId);
        if (!journal) return [];
        return journal.readMany(startSequence, minCount, maxCount, predicate);
    }

    getHeadSequence(cacheName: string, partitionId: number): bigint {
        const journal = this._getOrCreate(cacheName, partitionId);
        return journal ? journal.getHeadSequence() : 0n;
    }

    getTailSequence(cacheName: string, partitionId: number): bigint {
        const journal = this._getOrCreate(cacheName, partitionId);
        return journal ? journal.getTailSequence() : -1n;
    }

    size(cacheName: string, partitionId: number): number {
        const journal = this._getOrCreate(cacheName, partitionId);
        return journal ? journal.size() : 0;
    }

    destroyCache(cacheName: string): void {
        const prefix = `${cacheName}:`;
        for (const key of [...this._journals.keys()]) {
            if (key.startsWith(prefix)) {
                this._journals.get(key)?.clear();
                this._journals.delete(key);
            }
        }
        this._configs.delete(cacheName);
    }

    destroyPartition(cacheName: string, partitionId: number): void {
        const key = this._key(cacheName, partitionId);
        this._journals.get(key)?.clear();
        this._journals.delete(key);
    }
}
