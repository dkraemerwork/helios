/**
 * Tests for {@link WriteBehindStateHolder}.
 *
 * Block 16.F2 — write-behind queue + flush sequences capture/apply during partition replication.
 */
import { describe, test, expect, mock, afterEach } from 'bun:test';
import { WriteBehindStateHolder } from '@helios/map/impl/operation/WriteBehindStateHolder';
import { WriteBehindStore } from '@helios/map/impl/mapstore/writebehind/WriteBehindStore';
import { ArrayWriteBehindQueue } from '@helios/map/impl/mapstore/writebehind/ArrayWriteBehindQueue';
import { CoalescedWriteBehindQueue } from '@helios/map/impl/mapstore/writebehind/CoalescedWriteBehindQueue';
import { BoundedWriteBehindQueue } from '@helios/map/impl/mapstore/writebehind/BoundedWriteBehindQueue';
import { WriteBehindProcessor } from '@helios/map/impl/mapstore/writebehind/WriteBehindProcessor';
import { MapStoreWrapper } from '@helios/map/impl/mapstore/MapStoreWrapper';
import { addedEntry } from '@helios/map/impl/mapstore/writebehind/DelayedEntry';

function makeWrapper(storeFn?: (key: string, value: string) => Promise<void>): MapStoreWrapper<string, string> {
    const impl = {
        store: storeFn ?? mock(async () => {}),
        storeAll: mock(async () => {}),
        delete: mock(async () => {}),
        deleteAll: mock(async () => {}),
        load: mock(async () => null as string | null),
        loadAll: mock(async () => new Map<string, string>()),
        loadAllKeys: mock(async () => [] as string[]),
    };
    return new MapStoreWrapper<string, string>(impl as any);
}

function createStore(writeDelayMs = 5000): {
    store: WriteBehindStore<string, string>;
    queue: ArrayWriteBehindQueue<string, string>;
} {
    const queue = new ArrayWriteBehindQueue<string, string>();
    const processor = new WriteBehindProcessor<string, string>(makeWrapper(), 10);
    const store = new WriteBehindStore<string, string>(makeWrapper(), queue, processor, writeDelayMs);
    return { store, queue };
}

describe('WriteBehindStateHolder', () => {
    const stores: WriteBehindStore<string, string>[] = [];

    afterEach(() => {
        for (const s of stores) s.destroy();
        stores.length = 0;
    });

    function track(s: WriteBehindStore<string, string>): WriteBehindStore<string, string> {
        stores.push(s);
        return s;
    }

    test('prepare captures queued entries from a single map', async () => {
        const { store } = createStore();
        track(store);
        await store.add('k1', 'v1', Date.now());
        await store.add('k2', 'v2', Date.now());

        const holder = new WriteBehindStateHolder();
        holder.prepare(new Map([['myMap', store]]));

        expect(holder.delayedEntries.has('myMap')).toBe(true);
        expect(holder.delayedEntries.get('myMap')!.length).toBe(2);
    });

    test('prepare captures entries from multiple maps', async () => {
        const { store: s1 } = createStore();
        track(s1);
        const { store: s2 } = createStore();
        track(s2);
        await s1.add('a', '1', Date.now());
        await s2.add('b', '2', Date.now());
        await s2.add('c', '3', Date.now());

        const holder = new WriteBehindStateHolder();
        holder.prepare(new Map([['map1', s1], ['map2', s2]]));

        expect(holder.delayedEntries.size).toBe(2);
        expect(holder.delayedEntries.get('map1')!.length).toBe(1);
        expect(holder.delayedEntries.get('map2')!.length).toBe(2);
    });

    test('prepare captures empty queue as empty array', () => {
        const { store } = createStore();
        track(store);

        const holder = new WriteBehindStateHolder();
        holder.prepare(new Map([['emptyMap', store]]));

        expect(holder.delayedEntries.has('emptyMap')).toBe(true);
        expect(holder.delayedEntries.get('emptyMap')!.length).toBe(0);
    });

    test('prepare captures flush sequences', () => {
        const { store } = createStore();
        track(store);
        store.setFlushSequences(new Map([['ns1', 42]]));

        const holder = new WriteBehindStateHolder();
        holder.prepare(new Map([['myMap', store]]));

        expect(holder.flushSequences.has('myMap')).toBe(true);
        expect(holder.flushSequences.get('myMap')!.get('ns1')).toBe(42);
    });

    test('applyState restores entries via addForcibly', async () => {
        const { store: src } = createStore();
        track(src);
        await src.add('k1', 'v1', Date.now());
        await src.add('k2', 'v2', Date.now());

        const holder = new WriteBehindStateHolder();
        holder.prepare(new Map([['myMap', src]]));

        const { store: dst } = createStore();
        track(dst);
        holder.applyState(new Map([['myMap', dst]]));

        expect(dst.hasPendingWrites()).toBe(true);
    });

    test('applyState restores flush sequences', () => {
        const holder = new WriteBehindStateHolder();
        holder.flushSequences.set('myMap', new Map([['ns1', 99]]));
        holder.delayedEntries.set('myMap', []);

        const { store: dst } = createStore();
        track(dst);
        holder.applyState(new Map([['myMap', dst]]));

        expect(dst.getFlushSequences().get('ns1')).toBe(99);
    });

    test('applyState resets destination store before restoring', async () => {
        const { store: dst } = createStore();
        track(dst);
        await dst.add('old', 'data', Date.now());

        const holder = new WriteBehindStateHolder();
        holder.delayedEntries.set('myMap', [addedEntry('new', 'data', Date.now() + 5000)]);
        holder.flushSequences.set('myMap', new Map());

        holder.applyState(new Map([['myMap', dst]]));

        const entries = dst.asList();
        expect(entries.length).toBe(1);
        expect(entries[0].key).toBe('new');
    });

    test('applyState: worker starts after addForcibly loop; overdue entries flush on first tick', async () => {
        const stored: string[] = [];
        const impl = {
            store: mock(async (key: string) => { stored.push(key); }),
            storeAll: mock(async (entries: Map<string, string>) => { for (const k of entries.keys()) stored.push(k); }),
            delete: mock(async () => {}),
            deleteAll: mock(async () => {}),
            load: mock(async () => null as string | null),
            loadAll: mock(async () => new Map<string, string>()),
            loadAllKeys: mock(async () => [] as string[]),
        };
        const wrapper = new MapStoreWrapper<string, string>(impl as any);
        const queue = new ArrayWriteBehindQueue<string, string>();
        const processor = new WriteBehindProcessor<string, string>(wrapper, 10);
        const dst = new WriteBehindStore<string, string>(wrapper, queue, processor, 5000);
        track(dst);

        const holder = new WriteBehindStateHolder();
        const pastTime = Date.now() - 10000;
        holder.delayedEntries.set('myMap', [
            addedEntry('overdue1', 'val1', pastTime),
            addedEntry('overdue2', 'val2', pastTime),
        ]);
        holder.flushSequences.set('myMap', new Map());

        holder.applyState(new Map([['myMap', dst]]));

        // Wait for the first tick (1 second interval)
        await new Promise(resolve => setTimeout(resolve, 1200));

        expect(stored.length).toBe(2);
    });
});

describe('WriteBehindQueue.asList', () => {
    test('ArrayWriteBehindQueue returns snapshot copy (not live reference)', () => {
        const queue = new ArrayWriteBehindQueue<string, string>();
        queue.offer(addedEntry('k1', 'v1', 1000));

        const snapshot = queue.asList();
        queue.offer(addedEntry('k2', 'v2', 2000));

        expect(snapshot.length).toBe(1);
        expect(queue.size()).toBe(2);
    });

    test('CoalescedWriteBehindQueue returns snapshot copy', () => {
        const queue = new CoalescedWriteBehindQueue<string, string>();
        queue.offer(addedEntry('k1', 'v1', 1000));

        const snapshot = queue.asList();
        queue.offer(addedEntry('k2', 'v2', 2000));

        expect(snapshot.length).toBe(1);
        expect(queue.size()).toBe(2);
    });
});

describe('WriteBehindStateHolder data loss window (H-4)', () => {
    const stores: WriteBehindStore<string, string>[] = [];

    afterEach(() => {
        for (const s of stores) s.destroy();
        stores.length = 0;
    });

    function track(s: WriteBehindStore<string, string>): WriteBehindStore<string, string> {
        stores.push(s);
        return s;
    }

    test('entries written before asList() snapshot are present on destination', async () => {
        const { store: src } = createStore();
        track(src);
        await src.add('before1', 'val1', Date.now());
        await src.add('before2', 'val2', Date.now());

        // Capture snapshot — entries added before are captured
        const holder = new WriteBehindStateHolder();
        holder.prepare(new Map([['myMap', src]]));

        const { store: dst } = createStore();
        track(dst);
        holder.applyState(new Map([['myMap', dst]]));

        const entries = dst.asList();
        expect(entries.length).toBe(2);
        expect(entries.some(e => e.key === 'before1')).toBe(true);
        expect(entries.some(e => e.key === 'before2')).toBe(true);
    });

    test('entries written after asList() snapshot are absent on destination', async () => {
        const { store: src } = createStore();
        track(src);
        await src.add('before', 'val1', Date.now());

        // Capture snapshot
        const holder = new WriteBehindStateHolder();
        holder.prepare(new Map([['myMap', src]]));

        // Write AFTER snapshot — this simulates the data loss window
        await src.add('after', 'val2', Date.now());

        // Source now has 2 entries, but snapshot only has 1
        expect(src.asList().length).toBe(2);

        const { store: dst } = createStore();
        track(dst);
        holder.applyState(new Map([['myMap', dst]]));

        const entries = dst.asList();
        expect(entries.length).toBe(1);
        expect(entries.some(e => e.key === 'before')).toBe(true);
        expect(entries.some(e => e.key === 'after')).toBe(false);
    });
});

describe('BoundedWriteBehindQueue.asList', () => {
    test('delegates to underlying queue and returns snapshot', () => {
        const inner = new ArrayWriteBehindQueue<string, string>();
        const bounded = new BoundedWriteBehindQueue<string, string>(inner, 100);
        bounded.offer(addedEntry('k1', 'v1', 1000));
        bounded.offer(addedEntry('k2', 'v2', 2000));

        const snapshot = bounded.asList();
        bounded.offer(addedEntry('k3', 'v3', 3000));

        expect(snapshot.length).toBe(2);
        expect(bounded.size()).toBe(3);
    });
});

describe('WriteBehindStore replication support', () => {
    let store: WriteBehindStore<string, string>;

    afterEach(() => {
        store?.destroy();
    });

    test('reset clears queue AND staging area', async () => {
        const { store: s } = createStore();
        store = s;
        await store.add('k1', 'v1', Date.now());
        expect(store.hasPendingWrites()).toBe(true);

        store.reset();

        expect(store.hasPendingWrites()).toBe(false);
        const val = await store.load('k1');
        expect(val).toBeNull();
    });

    test('getFlushSequences/setFlushSequences round-trip correctly', () => {
        const { store: s } = createStore();
        store = s;

        const seqs = new Map([['ns1', 10], ['ns2', 20]]);
        store.setFlushSequences(seqs);

        const retrieved = store.getFlushSequences();
        expect(retrieved.get('ns1')).toBe(10);
        expect(retrieved.get('ns2')).toBe(20);
    });

    test('asList includes entries currently in staging area', async () => {
        const { store: s } = createStore();
        store = s;
        await store.add('k1', 'v1', Date.now());

        const entries = store.asList();
        expect(entries.length).toBeGreaterThanOrEqual(1);
        expect(entries.some(e => e.key === 'k1')).toBe(true);
    });
});
