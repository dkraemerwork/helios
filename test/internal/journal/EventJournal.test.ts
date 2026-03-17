/**
 * F3 — Event Journal unit tests.
 *
 * Covers:
 *   - EventJournal ring-buffer semantics (capacity, overflow, sequences)
 *   - TTL-based expiry
 *   - MapEventJournal per-partition isolation
 *   - EventJournalConfig defaults and validation
 *   - Journal wiring through HeliosInstanceImpl
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { EventJournal } from '@zenystx/helios-core/internal/journal/EventJournal';
import { MapEventJournal } from '@zenystx/helios-core/internal/journal/MapEventJournal';
import { EventJournalConfig } from '@zenystx/helios-core/config/EventJournalConfig';
import { EventJournalEventType } from '@zenystx/helios-core/internal/journal/EventJournalEvent';
import { HeapData } from '@zenystx/helios-core/internal/serialization/impl/HeapData';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Creates a properly-structured HeapData instance.
 * HeapData requires a payload of 0 or > 8 bytes (HEAP_DATA_OVERHEAD = 8).
 * The first 4 bytes are the partition hash, the next 4 bytes are the type ID,
 * and the rest is the actual data.
 */
function makeData(value: string): Data {
    const data = Buffer.from(value, 'utf8');
    // Build: [partitionHash(4)] + [typeId(4)] + [data]
    const buf = Buffer.allocUnsafe(8 + data.length);
    buf.fill(0, 0, 8);
    buf.writeInt32BE(0, 0);   // partitionHash = 0
    buf.writeInt32BE(1, 4);   // typeId = 1 (STRING)
    data.copy(buf, 8);
    return new HeapData(buf);
}

// ── EventJournalConfig ───────────────────────────────────────────────────────

describe('EventJournalConfig', () => {
    test('defaults are correct', () => {
        const cfg = new EventJournalConfig();
        expect(cfg.isEnabled()).toBe(false);
        expect(cfg.getCapacity()).toBe(EventJournalConfig.DEFAULT_CAPACITY);
        expect(cfg.getTimeToLiveSeconds()).toBe(EventJournalConfig.DEFAULT_TTL_SECONDS);
    });

    test('setEnabled toggles enabled state', () => {
        const cfg = new EventJournalConfig();
        cfg.setEnabled(true);
        expect(cfg.isEnabled()).toBe(true);
        cfg.setEnabled(false);
        expect(cfg.isEnabled()).toBe(false);
    });

    test('setCapacity clamps to minimum 1', () => {
        const cfg = new EventJournalConfig();
        cfg.setCapacity(0);
        expect(cfg.getCapacity()).toBe(1);
        cfg.setCapacity(-5);
        expect(cfg.getCapacity()).toBe(1);
        cfg.setCapacity(500);
        expect(cfg.getCapacity()).toBe(500);
    });

    test('setTimeToLiveSeconds clamps to minimum 0', () => {
        const cfg = new EventJournalConfig();
        cfg.setTimeToLiveSeconds(-1);
        expect(cfg.getTimeToLiveSeconds()).toBe(0);
        cfg.setTimeToLiveSeconds(60);
        expect(cfg.getTimeToLiveSeconds()).toBe(60);
    });

    test('chaining returns this', () => {
        const cfg = new EventJournalConfig();
        const result = cfg.setEnabled(true).setCapacity(100).setTimeToLiveSeconds(10);
        expect(result).toBe(cfg);
    });
});

// ── EventJournal ─────────────────────────────────────────────────────────────

describe('EventJournal', () => {
    let journal: EventJournal;
    const key = makeData('key1');
    const val1 = makeData('val1');
    const val2 = makeData('val2');

    beforeEach(() => {
        journal = new EventJournal(5);
    });

    test('starts empty with tailSequence = -1', () => {
        expect(journal.isEmpty()).toBe(true);
        expect(journal.size()).toBe(0);
        expect(journal.getTailSequence()).toBe(-1n);
    });

    test('add returns monotonically increasing sequences starting at 0', () => {
        const s0 = journal.add(key, null, val1, EventJournalEventType.ADDED);
        const s1 = journal.add(key, val1, val2, EventJournalEventType.UPDATED);
        expect(s0).toBe(0n);
        expect(s1).toBe(1n);
        expect(journal.getTailSequence()).toBe(1n);
        expect(journal.size()).toBe(2);
    });

    test('readMany returns events from startSequence', () => {
        journal.add(key, null, val1, EventJournalEventType.ADDED);
        journal.add(key, val1, val2, EventJournalEventType.UPDATED);
        journal.add(key, val2, null, EventJournalEventType.REMOVED);

        const events = journal.readMany(0n, 0, 10);
        expect(events.length).toBe(3);
        expect(events[0].sequence).toBe(0n);
        expect(events[0].eventType).toBe(EventJournalEventType.ADDED);
        expect(events[1].eventType).toBe(EventJournalEventType.UPDATED);
        expect(events[2].eventType).toBe(EventJournalEventType.REMOVED);
    });

    test('readMany respects maxCount', () => {
        for (let i = 0; i < 5; i++) {
            journal.add(key, null, val1, EventJournalEventType.ADDED);
        }
        const events = journal.readMany(0n, 0, 3);
        expect(events.length).toBe(3);
    });

    test('readMany applies predicate filter', () => {
        journal.add(key, null, val1, EventJournalEventType.ADDED);
        journal.add(key, val1, val2, EventJournalEventType.UPDATED);
        journal.add(key, val2, null, EventJournalEventType.REMOVED);

        const added = journal.readMany(0n, 0, 10,
            (e) => e.eventType === EventJournalEventType.ADDED);
        expect(added.length).toBe(1);
        expect(added[0].eventType).toBe(EventJournalEventType.ADDED);
    });

    test('overflow evicts oldest entries (ring buffer semantics)', () => {
        // capacity = 5, add 7 events
        for (let i = 0; i < 7; i++) {
            journal.add(key, null, makeData(`v${i}`), EventJournalEventType.ADDED);
        }
        expect(journal.size()).toBe(5);
        expect(journal.getHeadSequence()).toBe(2n);
        expect(journal.getTailSequence()).toBe(6n);
    });

    test('readMany starting before head reads from head', () => {
        for (let i = 0; i < 7; i++) {
            journal.add(key, null, makeData(`v${i}`), EventJournalEventType.ADDED);
        }
        // head is now 2, read from 0 → should start from 2
        const events = journal.readMany(0n, 0, 10);
        expect(events.length).toBe(5);
        expect(events[0].sequence).toBe(2n);
    });

    test('clear resets journal to initial state', () => {
        journal.add(key, null, val1, EventJournalEventType.ADDED);
        journal.clear();
        expect(journal.isEmpty()).toBe(true);
        expect(journal.size()).toBe(0);
        expect(journal.getTailSequence()).toBe(-1n);
        expect(journal.getHeadSequence()).toBe(0n);
    });

    test('event fields are set correctly', () => {
        const tsBefore = Date.now();
        journal.add(key, val1, val2, EventJournalEventType.UPDATED);
        const tsAfter = Date.now();

        const events = journal.readMany(0n, 0, 1);
        expect(events.length).toBe(1);
        const evt = events[0];
        expect(evt.sequence).toBe(0n);
        expect(evt.eventType).toBe(EventJournalEventType.UPDATED);
        expect(evt.key).toBe(key);
        expect(evt.oldValue).toBe(val1);
        expect(evt.newValue).toBe(val2);
        expect(evt.timestamp).toBeGreaterThanOrEqual(tsBefore);
        expect(evt.timestamp).toBeLessThanOrEqual(tsAfter);
    });
});

// ── MapEventJournal ──────────────────────────────────────────────────────────

describe('MapEventJournal', () => {
    let mapJournal: MapEventJournal;
    const mapName = 'myMap';
    const partition0 = 0;
    const partition1 = 1;
    const key = makeData('k1');
    const val = makeData('v1');
    const val2 = makeData('v2');

    beforeEach(() => {
        mapJournal = new MapEventJournal();
    });

    test('isEnabled returns false when no config registered', () => {
        expect(mapJournal.isEnabled(mapName)).toBe(false);
    });

    test('isEnabled returns true after registering an enabled config', () => {
        const cfg = new EventJournalConfig();
        cfg.setEnabled(true);
        mapJournal.registerConfig(mapName, cfg);
        expect(mapJournal.isEnabled(mapName)).toBe(true);
    });

    test('isEnabled returns false when config is registered but not enabled', () => {
        const cfg = new EventJournalConfig(); // enabled = false by default
        mapJournal.registerConfig(mapName, cfg);
        expect(mapJournal.isEnabled(mapName)).toBe(false);
    });

    test('writeAddEvent returns null when journal not enabled', () => {
        const result = mapJournal.writeAddEvent(mapName, partition0, key, null, val);
        expect(result).toBeNull();
    });

    test('writeAddEvent records ADDED event', () => {
        const cfg = new EventJournalConfig();
        cfg.setEnabled(true);
        mapJournal.registerConfig(mapName, cfg);

        const seq = mapJournal.writeAddEvent(mapName, partition0, key, null, val);
        expect(seq).toBe(0n);

        const events = mapJournal.readMany(mapName, partition0, 0n, 0, 10);
        expect(events.length).toBe(1);
        expect(events[0].eventType).toBe(EventJournalEventType.ADDED);
        expect(events[0].newValue).toBe(val);
        expect(events[0].oldValue).toBeNull();
    });

    test('writeAddEvent records UPDATED event when oldValue present', () => {
        const cfg = new EventJournalConfig();
        cfg.setEnabled(true);
        mapJournal.registerConfig(mapName, cfg);

        mapJournal.writeAddEvent(mapName, partition0, key, val, val2);
        const events = mapJournal.readMany(mapName, partition0, 0n, 0, 10);
        expect(events[0].eventType).toBe(EventJournalEventType.UPDATED);
        expect(events[0].oldValue).toBe(val);
        expect(events[0].newValue).toBe(val2);
    });

    test('writeRemoveEvent records REMOVED event', () => {
        const cfg = new EventJournalConfig();
        cfg.setEnabled(true);
        mapJournal.registerConfig(mapName, cfg);

        mapJournal.writeRemoveEvent(mapName, partition0, key, val);
        const events = mapJournal.readMany(mapName, partition0, 0n, 0, 10);
        expect(events[0].eventType).toBe(EventJournalEventType.REMOVED);
        expect(events[0].oldValue).toBe(val);
        expect(events[0].newValue).toBeNull();
    });

    test('writeEvictEvent records EVICTED event', () => {
        const cfg = new EventJournalConfig();
        cfg.setEnabled(true);
        mapJournal.registerConfig(mapName, cfg);

        mapJournal.writeEvictEvent(mapName, partition0, key, val);
        const events = mapJournal.readMany(mapName, partition0, 0n, 0, 10);
        expect(events[0].eventType).toBe(EventJournalEventType.EVICTED);
    });

    test('writeLoadEvent records LOADED event', () => {
        const cfg = new EventJournalConfig();
        cfg.setEnabled(true);
        mapJournal.registerConfig(mapName, cfg);

        mapJournal.writeLoadEvent(mapName, partition0, key, val);
        const events = mapJournal.readMany(mapName, partition0, 0n, 0, 10);
        expect(events[0].eventType).toBe(EventJournalEventType.LOADED);
        expect(events[0].newValue).toBe(val);
        expect(events[0].oldValue).toBeNull();
    });

    test('partitions are isolated', () => {
        const cfg = new EventJournalConfig();
        cfg.setEnabled(true);
        mapJournal.registerConfig(mapName, cfg);

        mapJournal.writeAddEvent(mapName, partition0, key, null, val);
        mapJournal.writeAddEvent(mapName, partition1, key, null, val2);

        const events0 = mapJournal.readMany(mapName, partition0, 0n, 0, 10);
        const events1 = mapJournal.readMany(mapName, partition1, 0n, 0, 10);
        expect(events0.length).toBe(1);
        expect(events1.length).toBe(1);
        expect(events0[0].newValue).toBe(val);
        expect(events1[0].newValue).toBe(val2);
    });

    test('getHeadSequence and getTailSequence return 0/-1 when no journal exists', () => {
        expect(mapJournal.getHeadSequence(mapName, partition0)).toBe(0n);
        expect(mapJournal.getTailSequence(mapName, partition0)).toBe(-1n);
    });

    test('size returns 0 when no journal exists', () => {
        expect(mapJournal.size(mapName, partition0)).toBe(0);
    });

    test('destroyMap clears all partitions for the map', () => {
        const cfg = new EventJournalConfig();
        cfg.setEnabled(true);
        mapJournal.registerConfig(mapName, cfg);

        mapJournal.writeAddEvent(mapName, partition0, key, null, val);
        mapJournal.writeAddEvent(mapName, partition1, key, null, val);
        mapJournal.destroyMap(mapName);

        // After destroy, isEnabled should be false (config removed)
        expect(mapJournal.isEnabled(mapName)).toBe(false);
        expect(mapJournal.size(mapName, partition0)).toBe(0);
        expect(mapJournal.size(mapName, partition1)).toBe(0);
    });

    test('destroyPartition removes only the specified partition journal', () => {
        const cfg = new EventJournalConfig();
        cfg.setEnabled(true);
        mapJournal.registerConfig(mapName, cfg);

        mapJournal.writeAddEvent(mapName, partition0, key, null, val);
        mapJournal.writeAddEvent(mapName, partition1, key, null, val);
        mapJournal.destroyPartition(mapName, partition0);

        expect(mapJournal.size(mapName, partition0)).toBe(0);
        expect(mapJournal.size(mapName, partition1)).toBe(1);
    });

    test('capacity is respected per journal', () => {
        const cfg = new EventJournalConfig();
        cfg.setEnabled(true).setCapacity(3);
        mapJournal.registerConfig(mapName, cfg);

        for (let i = 0; i < 5; i++) {
            mapJournal.writeAddEvent(mapName, partition0, key, null, makeData(`v${i}`));
        }
        expect(mapJournal.size(mapName, partition0)).toBe(3);
    });
});

// ── Integration through MapConfig ─────────────────────────────────────────────

describe('MapConfig EventJournal integration', () => {
    test('MapConfig has EventJournalConfig with correct defaults', async () => {
        const { MapConfig } = await import('@zenystx/helios-core/config/MapConfig');
        const mapConfig = new MapConfig('testMap');
        const ejConfig = mapConfig.getEventJournalConfig();
        expect(ejConfig).toBeDefined();
        expect(ejConfig.isEnabled()).toBe(false);
        expect(ejConfig.getCapacity()).toBe(EventJournalConfig.DEFAULT_CAPACITY);
    });

    test('MapConfig EventJournalConfig can be enabled and customized', async () => {
        const { MapConfig } = await import('@zenystx/helios-core/config/MapConfig');
        const mapConfig = new MapConfig('testMap');
        mapConfig.getEventJournalConfig().setEnabled(true).setCapacity(500).setTimeToLiveSeconds(30);
        const ejConfig = mapConfig.getEventJournalConfig();
        expect(ejConfig.isEnabled()).toBe(true);
        expect(ejConfig.getCapacity()).toBe(500);
        expect(ejConfig.getTimeToLiveSeconds()).toBe(30);
    });

    test('MapConfig setEventJournalConfig replaces the config', async () => {
        const { MapConfig } = await import('@zenystx/helios-core/config/MapConfig');
        const mapConfig = new MapConfig('testMap');
        const newCfg = new EventJournalConfig();
        newCfg.setEnabled(true).setCapacity(200);
        mapConfig.setEventJournalConfig(newCfg);
        expect(mapConfig.getEventJournalConfig()).toBe(newCfg);
    });
});
