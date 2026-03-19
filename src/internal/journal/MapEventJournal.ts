/**
 * Port of {@code com.hazelcast.map.impl.journal.MapEventJournal}.
 *
 * Manages per-partition EventJournal instances for IMap.
 * Journal instances are keyed by `mapName:partitionId` to mirror
 * MapContainerService's per-partition RecordStore pattern.
 */
import type { EventJournalConfig } from '@zenystx/helios-core/config/EventJournalConfig';
import { EventJournal } from '@zenystx/helios-core/internal/journal/EventJournal';
import type { EventJournalEvent } from '@zenystx/helios-core/internal/journal/EventJournalEvent';
import { EventJournalEventType } from '@zenystx/helios-core/internal/journal/EventJournalEvent';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';

export class MapEventJournal {
    /** Per (mapName:partitionId) journal instances. */
    private readonly _journals = new Map<string, EventJournal>();
    /** Per-map config. */
    private readonly _configs = new Map<string, EventJournalConfig>();

    registerConfig(mapName: string, config: EventJournalConfig): void {
        this._configs.set(mapName, config);
    }

    isEnabled(mapName: string): boolean {
        const config = this._configs.get(mapName);
        return config !== undefined && config.isEnabled();
    }

    private _key(mapName: string, partitionId: number): string {
        return `${mapName}:${partitionId}`;
    }

    private _getOrCreate(mapName: string, partitionId: number): EventJournal | null {
        const config = this._configs.get(mapName);
        if (!config || !config.isEnabled()) return null;

        const key = this._key(mapName, partitionId);
        let journal = this._journals.get(key);
        if (!journal) {
            journal = new EventJournal(config.getCapacity(), config.getTimeToLiveSeconds());
            this._journals.set(key, journal);
        }
        return journal;
    }

    /** Record a PUT event (add or update). */
    writeAddEvent(
        mapName: string,
        partitionId: number,
        key: Data,
        oldValue: Data | null,
        newValue: Data,
    ): bigint | null {
        const journal = this._getOrCreate(mapName, partitionId);
        if (!journal) return null;
        const eventType = oldValue !== null ? EventJournalEventType.UPDATED : EventJournalEventType.ADDED;
        return journal.add(key, oldValue, newValue, eventType);
    }

    /** Record a REMOVE event. */
    writeRemoveEvent(
        mapName: string,
        partitionId: number,
        key: Data,
        oldValue: Data | null,
    ): bigint | null {
        const journal = this._getOrCreate(mapName, partitionId);
        if (!journal) return null;
        return journal.add(key, oldValue, null, EventJournalEventType.REMOVED);
    }

    /** Record an EVICTION event. */
    writeEvictEvent(
        mapName: string,
        partitionId: number,
        key: Data,
        oldValue: Data | null,
    ): bigint | null {
        const journal = this._getOrCreate(mapName, partitionId);
        if (!journal) return null;
        return journal.add(key, oldValue, null, EventJournalEventType.EVICTED);
    }

    /** Record a LOAD event (from MapStore). */
    writeLoadEvent(
        mapName: string,
        partitionId: number,
        key: Data,
        value: Data,
    ): bigint | null {
        const journal = this._getOrCreate(mapName, partitionId);
        if (!journal) return null;
        return journal.add(key, null, value, EventJournalEventType.LOADED);
    }

    /** Read events from the journal. */
    readMany(
        mapName: string,
        partitionId: number,
        startSequence: bigint,
        minCount: number,
        maxCount: number,
        predicate?: (event: EventJournalEvent) => boolean,
    ): EventJournalEvent[] {
        const journal = this._getOrCreate(mapName, partitionId);
        if (!journal) return [];
        return journal.readMany(startSequence, minCount, maxCount, predicate);
    }

    /** Get the head (oldest) sequence for a partition's journal. */
    getHeadSequence(mapName: string, partitionId: number): bigint {
        const journal = this._getOrCreate(mapName, partitionId);
        return journal ? journal.getHeadSequence() : 0n;
    }

    /** Get the tail (newest) sequence for a partition's journal. */
    getTailSequence(mapName: string, partitionId: number): bigint {
        const journal = this._getOrCreate(mapName, partitionId);
        return journal ? journal.getTailSequence() : -1n;
    }

    /** Get journal size for a partition. */
    size(mapName: string, partitionId: number): number {
        const journal = this._getOrCreate(mapName, partitionId);
        return journal ? journal.size() : 0;
    }

    /** Destroy all journals for a map. */
    destroyMap(mapName: string): void {
        const prefix = `${mapName}:`;
        for (const key of [...this._journals.keys()]) {
            if (key.startsWith(prefix)) {
                this._journals.get(key)?.clear();
                this._journals.delete(key);
            }
        }
        this._configs.delete(mapName);
    }

    /** Destroy a specific partition's journal. */
    destroyPartition(mapName: string, partitionId: number): void {
        const key = this._key(mapName, partitionId);
        this._journals.get(key)?.clear();
        this._journals.delete(key);
    }
}
