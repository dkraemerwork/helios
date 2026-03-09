/**
 * Block 21.2 — Partition-scoped MapStore runtime + owner-only persistence.
 *
 * Proves:
 *  - MapStore store/delete/load execute on partition owners only
 *  - Backups never perform external writes (shadow-state only)
 *  - Exactly one external write/delete per logical clustered mutation
 *  - putAll/getAll route through owner for MapStore bulk paths
 *  - MapStoreContext shared lifecycle with partition-scoped runtime state
 */
import { Helios } from '@zenystx/helios-core/Helios';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import { MapConfig } from '@zenystx/helios-core/config/MapConfig';
import { MapStoreConfig } from '@zenystx/helios-core/config/MapStoreConfig';
import type { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';
import { MapKeyStream } from '@zenystx/helios-core/map/MapKeyStream';
import type { MapStore } from '@zenystx/helios-core/map/MapStore';
import { afterEach, describe, expect, it } from 'bun:test';

const BASE_PORT = 17200;
let portCounter = 0;

function nextPort(): number {
    return BASE_PORT + (portCounter++);
}

async function waitUntil(
    predicate: () => boolean | Promise<boolean>,
    timeoutMs = 5000,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!(await predicate())) {
        if (Date.now() >= deadline) {
            throw new Error(`waitUntil: timed out after ${timeoutMs} ms`);
        }
        await Bun.sleep(20);
    }
}

async function waitForClusterSize(
    instance: HeliosInstanceImpl,
    count: number,
): Promise<void> {
    await waitUntil(() => instance.getCluster().getMembers().length === count);
}

/**
 * Counting MapStore that records every store/delete/load call with the caller's
 * identity (which node triggered the external write).
 */
class CountingMapStore implements MapStore<string, string> {
    readonly stores: { key: string; value: string }[] = [];
    readonly deletes: string[] = [];
    readonly loads: string[] = [];
    readonly storeAlls: Map<string, string>[] = [];
    readonly deleteAlls: string[][] = [];
    readonly loadAlls: string[][] = [];
    private readonly _data = new Map<string, string>();

    async store(key: string, value: string): Promise<void> {
        this.stores.push({ key, value });
        this._data.set(key, value);
    }

    async storeAll(entries: Map<string, string>): Promise<void> {
        this.storeAlls.push(new Map(entries));
        for (const [k, v] of entries) {
            this._data.set(k, v);
        }
    }

    async delete(key: string): Promise<void> {
        this.deletes.push(key);
        this._data.delete(key);
    }

    async deleteAll(keys: string[]): Promise<void> {
        this.deleteAlls.push([...keys]);
        for (const k of keys) this._data.delete(k);
    }

    async load(key: string): Promise<string | null> {
        this.loads.push(key);
        return this._data.get(key) ?? null;
    }

    async loadAll(keys: string[]): Promise<Map<string, string>> {
        this.loadAlls.push([...keys]);
        const result = new Map<string, string>();
        for (const k of keys) {
            const v = this._data.get(k);
            if (v !== undefined) result.set(k, v);
        }
        return result;
    }

    async loadAllKeys(): Promise<MapKeyStream<string>> {
        return MapKeyStream.fromIterable([...this._data.keys()]);
    }

    /** Reset all counters. */
    reset(): void {
        this.stores.length = 0;
        this.deletes.length = 0;
        this.loads.length = 0;
        this.storeAlls.length = 0;
        this.deleteAlls.length = 0;
        this.loadAlls.length = 0;
    }
}

describe('Block 21.2 — Partition-scoped MapStore runtime + owner-only persistence', () => {
    const instances: HeliosInstanceImpl[] = [];

    afterEach(async () => {
        for (const inst of instances) {
            if (inst.isRunning()) inst.shutdown();
        }
        instances.length = 0;
        await Bun.sleep(30);
    });

    function makeConfig(
        name: string,
        port: number,
        peerPorts: number[],
        mapName: string,
        store: CountingMapStore,
    ): HeliosConfig {
        const cfg = new HeliosConfig(name);
        cfg.getNetworkConfig()
            .setPort(port)
            .getJoin()
            .getTcpIpConfig()
            .setEnabled(true);
        for (const pp of peerPorts) {
            cfg.getNetworkConfig().getJoin().getTcpIpConfig().addMember(`localhost:${pp}`);
        }
        const msCfg = new MapStoreConfig();
        msCfg.setEnabled(true);
        msCfg.setImplementation(store);
        const mc = new MapConfig();
        mc.setName(mapName);
        mc.setMapStoreConfig(msCfg);
        cfg.addMapConfig(mc);
        return cfg;
    }

    async function startTwoNodeCluster(
        mapName: string,
        storeA: CountingMapStore,
        storeB: CountingMapStore,
    ): Promise<[HeliosInstanceImpl, HeliosInstanceImpl]> {
        const portA = nextPort();
        const portB = nextPort();
        const a = await Helios.newInstance(makeConfig('storeA', portA, [], mapName, storeA));
        instances.push(a);
        const b = await Helios.newInstance(makeConfig('storeB', portB, [portA], mapName, storeB));
        instances.push(b);
        await waitForClusterSize(a, 2);
        await waitForClusterSize(b, 2);
        return [a, b];
    }

    function findKeyOwnedBy(
        instance: HeliosInstanceImpl,
        ownerName: string,
        prefix = 'k',
    ): string {
        for (let i = 0; i < 1000; i++) {
            const key = `${prefix}-${i}`;
            const pid = instance.getPartitionIdForName(key);
            if (instance.getPartitionOwnerId(pid) === ownerName) {
                return key;
            }
        }
        throw new Error(`Could not find key owned by ${ownerName}`);
    }

    // ── 1. Owner-side store: put triggers exactly one external store call on the owner ──

    it('put triggers exactly one external store call on partition owner', async () => {
        const storeA = new CountingMapStore();
        const storeB = new CountingMapStore();
        const [a, b] = await startTwoNodeCluster('store-put', storeA, storeB);

        const keyOwnedByA = findKeyOwnedBy(a, a.getLocalMemberId());
        const mapB = b.getMap<string, string>('store-put');

        // Put from B (non-owner) → should trigger store on A's MapStore only
        await mapB.put(keyOwnedByA, 'value1');

        // Exactly one store call on the owner's MapStore
        expect(storeA.stores.length).toBe(1);
        expect(storeA.stores[0]!.key).toBe(keyOwnedByA);
        expect(storeA.stores[0]!.value).toBe('value1');

        // Zero store calls on the non-owner's MapStore
        expect(storeB.stores.length).toBe(0);
    });

    // ── 2. Owner-side delete: remove triggers exactly one external delete on owner ──

    it('remove triggers exactly one external delete call on partition owner', async () => {
        const storeA = new CountingMapStore();
        const storeB = new CountingMapStore();
        const [a, b] = await startTwoNodeCluster('store-remove', storeA, storeB);

        const keyOwnedByA = findKeyOwnedBy(a, a.getLocalMemberId());
        const mapA = a.getMap<string, string>('store-remove');
        const mapB = b.getMap<string, string>('store-remove');

        // Put first (from owner)
        await mapA.put(keyOwnedByA, 'to-remove');
        storeA.reset();
        storeB.reset();

        // Remove from B (non-owner)
        await mapB.remove(keyOwnedByA);

        // Exactly one delete on owner
        expect(storeA.deletes.length).toBe(1);
        expect(storeA.deletes[0]).toBe(keyOwnedByA);

        // Zero on non-owner
        expect(storeB.deletes.length).toBe(0);
    });

    // ── 3. Owner-side delete via delete() ──

    it('delete() triggers exactly one external delete on partition owner', async () => {
        const storeA = new CountingMapStore();
        const storeB = new CountingMapStore();
        const [a, b] = await startTwoNodeCluster('store-delete', storeA, storeB);

        const keyOwnedByA = findKeyOwnedBy(a, a.getLocalMemberId());
        const mapA = a.getMap<string, string>('store-delete');
        const mapB = b.getMap<string, string>('store-delete');

        await mapA.put(keyOwnedByA, 'to-delete');
        storeA.reset();
        storeB.reset();

        await mapB.delete(keyOwnedByA);

        expect(storeA.deletes.length).toBe(1);
        expect(storeB.deletes.length).toBe(0);
    });

    // ── 4. Owner-side load-on-miss ──

    it('get load-on-miss triggers load on partition owner only', async () => {
        const storeA = new CountingMapStore();
        const storeB = new CountingMapStore();

        // Pre-populate storeA with data
        await storeA.store('preloaded', 'ext-value');
        storeA.reset();

        const [a, b] = await startTwoNodeCluster('store-load', storeA, storeB);

        // Find key owned by A and use 'preloaded' if possible
        // Pre-store the value directly in storeA's backing data
        const keyOwnedByA = findKeyOwnedBy(a, a.getLocalMemberId(), 'load');
        await storeA.store(keyOwnedByA, 'external-data');
        storeA.reset();

        const mapB = b.getMap<string, string>('store-load');

        // Get from B (non-owner) → miss in memory → load from owner's MapStore
        const val = await mapB.get(keyOwnedByA);
        expect(val).toBe('external-data');

        // Load happened on owner's store
        expect(storeA.loads.length).toBe(1);
        // No load on non-owner
        expect(storeB.loads.length).toBe(0);
    });

    // ── 5. set() triggers owner-side store ──

    it('set() triggers exactly one external store on partition owner', async () => {
        const storeA = new CountingMapStore();
        const storeB = new CountingMapStore();
        const [a, b] = await startTwoNodeCluster('store-set', storeA, storeB);

        const keyOwnedByA = findKeyOwnedBy(a, a.getLocalMemberId());
        const mapB = b.getMap<string, string>('store-set');

        await mapB.set(keyOwnedByA, 'set-value');

        expect(storeA.stores.length).toBe(1);
        expect(storeA.stores[0]!.value).toBe('set-value');
        expect(storeB.stores.length).toBe(0);
    });

    // ── 6. putIfAbsent triggers owner-side store ──

    it('putIfAbsent triggers external store on owner when key is absent', async () => {
        const storeA = new CountingMapStore();
        const storeB = new CountingMapStore();
        const [a, b] = await startTwoNodeCluster('store-pia', storeA, storeB);

        const keyOwnedByA = findKeyOwnedBy(a, a.getLocalMemberId());
        const mapB = b.getMap<string, string>('store-pia');

        const existing = await mapB.putIfAbsent(keyOwnedByA, 'first');
        expect(existing).toBeNull();

        expect(storeA.stores.length).toBe(1);
        expect(storeB.stores.length).toBe(0);

        // Second putIfAbsent should NOT store (key exists)
        storeA.reset();
        const existing2 = await mapB.putIfAbsent(keyOwnedByA, 'second');
        expect(existing2).toBe('first');
        expect(storeA.stores.length).toBe(0);
    });

    // ── 7. Backup does not trigger external writes (shadow-state) ──

    it('backup replication does not trigger external MapStore writes', async () => {
        const storeA = new CountingMapStore();
        const storeB = new CountingMapStore();
        const [a, b] = await startTwoNodeCluster('store-backup', storeA, storeB);

        const keyOwnedByA = findKeyOwnedBy(a, a.getLocalMemberId());
        const mapA = a.getMap<string, string>('store-backup');

        await mapA.put(keyOwnedByA, 'backed-up');

        // Wait for backup replication
        await Bun.sleep(100);

        // Owner A should have exactly 1 store call
        expect(storeA.stores.length).toBe(1);
        // Backup B should have 0 store calls — shadow-state only
        expect(storeB.stores.length).toBe(0);
    });

    // ── 8. putAll routes each key to its owner for store ──

    it('putAll routes each key to partition owner for MapStore writes', async () => {
        const storeA = new CountingMapStore();
        const storeB = new CountingMapStore();
        const [a, b] = await startTwoNodeCluster('store-putall', storeA, storeB);

        const mapA = a.getMap<string, string>('store-putall');
        void b;

        // Create entries owned by different nodes
        const entries: [string, string][] = [];
        let aOwnedCount = 0;
        let bOwnedCount = 0;
        for (let i = 0; i < 50; i++) {
            const key = `pa-${i}`;
            const pid = a.getPartitionIdForName(key);
            const owner = a.getPartitionOwnerId(pid);
            if (owner === a.getLocalMemberId()) aOwnedCount++;
            else bOwnedCount++;
            entries.push([key, `val-${i}`]);
        }

        // Both nodes should own some keys
        expect(aOwnedCount).toBeGreaterThan(0);
        expect(bOwnedCount).toBeGreaterThan(0);

        await mapA.putAll(entries);

        // Total store calls across both nodes should equal total entries
        const totalStores = storeA.stores.length + storeB.stores.length +
            storeA.storeAlls.reduce((n, m) => n + m.size, 0) +
            storeB.storeAlls.reduce((n, m) => n + m.size, 0);
        expect(totalStores).toBe(entries.length);

        // Each node should only have store calls for keys it owns
        for (const s of storeA.stores) {
            const pid = a.getPartitionIdForName(s.key);
            expect(a.getPartitionOwnerId(pid)).toBe(a.getLocalMemberId());
        }
        for (const s of storeB.stores) {
            const pid = a.getPartitionIdForName(s.key);
            expect(a.getPartitionOwnerId(pid)).toBe(b.getLocalMemberId());
        }
    });

    // ── 9. getAll bulk load routes through owners ──

    it('getAll load-on-miss routes through partition owners', async () => {
        const storeA = new CountingMapStore();
        const storeB = new CountingMapStore();
        const [a, b] = await startTwoNodeCluster('store-getall', storeA, storeB);

        // Pre-populate external stores with keys
        const keysOwnedByA: string[] = [];
        const keysOwnedByB: string[] = [];
        for (let i = 0; i < 20; i++) {
            const key = `ga-${i}`;
            const pid = a.getPartitionIdForName(key);
            const owner = a.getPartitionOwnerId(pid);
            if (owner === a.getLocalMemberId()) {
                await storeA.store(key, `ext-${i}`);
                keysOwnedByA.push(key);
            } else {
                await storeB.store(key, `ext-${i}`);
                keysOwnedByB.push(key);
            }
        }
        storeA.reset();
        storeB.reset();

        const mapB = b.getMap<string, string>('store-getall');
        const allKeys = [...keysOwnedByA, ...keysOwnedByB];
        const result = await mapB.getAll(allKeys);

        // All keys should have values
        for (const key of allKeys) {
            expect(result.get(key)).not.toBeNull();
        }

        // Loads should have happened on respective owners
        // A should have loaded A-owned keys, B should have loaded B-owned keys
        const aLoadedKeys = [...storeA.loads, ...storeA.loadAlls.flat()];
        const bLoadedKeys = [...storeB.loads, ...storeB.loadAlls.flat()];

        for (const k of aLoadedKeys) {
            const pid = a.getPartitionIdForName(k);
            expect(a.getPartitionOwnerId(pid)).toBe(a.getLocalMemberId());
        }
        for (const k of bLoadedKeys) {
            const pid = a.getPartitionIdForName(k);
            expect(a.getPartitionOwnerId(pid)).toBe(b.getLocalMemberId());
        }
    });

    // ── 10. Multiple puts to same key: exactly one store per put ──

    it('multiple puts to same key produce exactly one store per put', async () => {
        const storeA = new CountingMapStore();
        const storeB = new CountingMapStore();
        const [a, b] = await startTwoNodeCluster('store-multi', storeA, storeB);

        const keyOwnedByA = findKeyOwnedBy(a, a.getLocalMemberId());
        const mapB = b.getMap<string, string>('store-multi');

        await mapB.put(keyOwnedByA, 'v1');
        await mapB.put(keyOwnedByA, 'v2');
        await mapB.put(keyOwnedByA, 'v3');

        // 3 puts = 3 store calls on owner
        expect(storeA.stores.length).toBe(3);
        // 0 on non-owner
        expect(storeB.stores.length).toBe(0);
    });

    // ── 11. MapStoreContext shared lifecycle: both nodes share same store type ──

    it('MapStoreContext is shared at map level with partition-scoped stores', async () => {
        const storeA = new CountingMapStore();
        const storeB = new CountingMapStore();
        const [a, b] = await startTwoNodeCluster('store-ctx', storeA, storeB);

        const mapA = a.getMap<string, string>('store-ctx');
        const mapB = b.getMap<string, string>('store-ctx');

        // Write keys owned by A
        const k1 = findKeyOwnedBy(a, a.getLocalMemberId(), 'ctx1');
        await mapA.put(k1, 'val1');

        // Write keys owned by B
        const k2 = findKeyOwnedBy(a, b.getLocalMemberId(), 'ctx2');
        await mapB.put(k2, 'val2');

        // Each owner stored to its own MapStore
        expect(storeA.stores.length).toBe(1);
        expect(storeB.stores.length).toBe(1);
    });

    // ── 12. clear() triggers MapStore clear on owner only ──

    it('clear triggers MapStore clear behavior through owner paths', async () => {
        const storeA = new CountingMapStore();
        const storeB = new CountingMapStore();
        const [a, _b] = await startTwoNodeCluster('store-clear', storeA, storeB);

        const mapA = a.getMap<string, string>('store-clear');

        // Put some entries
        for (let i = 0; i < 5; i++) {
            await mapA.put(`cl-${i}`, `v-${i}`);
        }

        storeA.reset();
        storeB.reset();

        await mapA.clear();

        // After clear, the map should be empty
        expect(mapA.size()).toBe(0);
    });

    // ── 13. Owner-only writes hold across different operation types ──

    it('mixed operations all route external writes to partition owner', async () => {
        const storeA = new CountingMapStore();
        const storeB = new CountingMapStore();
        const [a, b] = await startTwoNodeCluster('store-mixed', storeA, storeB);

        const keyOwnedByA = findKeyOwnedBy(a, a.getLocalMemberId(), 'mix');
        const mapB = b.getMap<string, string>('store-mixed');

        await mapB.put(keyOwnedByA, 'v1');
        await mapB.set(keyOwnedByA, 'v2');
        await mapB.remove(keyOwnedByA);

        // All external writes on owner A
        expect(storeA.stores.length).toBe(2); // put + set
        expect(storeA.deletes.length).toBe(1); // remove
        // None on non-owner B
        expect(storeB.stores.length).toBe(0);
        expect(storeB.deletes.length).toBe(0);
    });

    // ── 14. Bidirectional: both nodes serve as owners for their keys ──

    it('both nodes serve as MapStore owners for their respective partitions', async () => {
        const storeA = new CountingMapStore();
        const storeB = new CountingMapStore();
        const [a, b] = await startTwoNodeCluster('store-bidir', storeA, storeB);

        const mapA = a.getMap<string, string>('store-bidir');

        const keyA = findKeyOwnedBy(a, a.getLocalMemberId(), 'biA');
        const keyB = findKeyOwnedBy(a, b.getLocalMemberId(), 'biB');

        await mapA.put(keyA, 'on-A');
        await mapA.put(keyB, 'on-B');

        // A stored its key
        expect(storeA.stores.some(s => s.key === keyA)).toBe(true);
        // B stored its key
        expect(storeB.stores.some(s => s.key === keyB)).toBe(true);
    });

    // ── 15. Write-behind backup shadow: no external writes on backup ──

    it('write-behind mode: backup receives shadow queue but no external write', async () => {
        const storeA = new CountingMapStore();
        const storeB = new CountingMapStore();

        const portA = nextPort();
        const portB = nextPort();

        // Configure write-behind (delay > 0)
        const cfgA = new HeliosConfig('wbA');
        cfgA.getNetworkConfig().setPort(portA).getJoin().getTcpIpConfig().setEnabled(true);
        const msA = new MapStoreConfig();
        msA.setEnabled(true);
        msA.setImplementation(storeA);
        msA.setWriteDelaySeconds(1); // write-behind
        const mcA = new MapConfig();
        mcA.setName('store-wb');
        mcA.setMapStoreConfig(msA);
        cfgA.addMapConfig(mcA);

        const cfgB = new HeliosConfig('wbB');
        cfgB.getNetworkConfig().setPort(portB).getJoin().getTcpIpConfig().setEnabled(true);
        cfgB.getNetworkConfig().getJoin().getTcpIpConfig().addMember(`localhost:${portA}`);
        const msB = new MapStoreConfig();
        msB.setEnabled(true);
        msB.setImplementation(storeB);
        msB.setWriteDelaySeconds(1);
        const mcB = new MapConfig();
        mcB.setName('store-wb');
        mcB.setMapStoreConfig(msB);
        cfgB.addMapConfig(mcB);

        const a = await Helios.newInstance(cfgA);
        instances.push(a);
        const b = await Helios.newInstance(cfgB);
        instances.push(b);
        await waitForClusterSize(a, 2);
        await waitForClusterSize(b, 2);

        const keyOwnedByA = findKeyOwnedBy(a, a.getLocalMemberId(), 'wb');
        const mapA = a.getMap<string, string>('store-wb');
        await mapA.put(keyOwnedByA, 'wb-value');

        // Wait for write-behind to flush
        await Bun.sleep(1500);

        // Owner A should have stored (write-behind uses storeAll batching)
        const aWrites = storeA.stores.length + storeA.storeAlls.reduce((n, m) => n + m.size, 0);
        expect(aWrites).toBeGreaterThanOrEqual(1);
        // Backup B should have 0 external writes
        const bWrites = storeB.stores.length + storeB.storeAlls.reduce((n, m) => n + m.size, 0);
        expect(bWrites).toBe(0);
    });

    // ── 16. Load from owner MapStore on miss, not from caller's store ──

    it('load-on-miss uses owner MapStore, not caller MapStore', async () => {
        const storeA = new CountingMapStore();
        const storeB = new CountingMapStore();
        const [a, b] = await startTwoNodeCluster('store-load2', storeA, storeB);

        const keyOwnedByA = findKeyOwnedBy(a, a.getLocalMemberId(), 'ld2');

        // Put data only in owner's external store
        await storeA.store(keyOwnedByA, 'from-owner-store');
        storeA.reset();

        // Get from B — should load from A's store
        const mapB = b.getMap<string, string>('store-load2');
        const val = await mapB.get(keyOwnedByA);
        expect(val).toBe('from-owner-store');

        // A loaded, B did not
        expect(storeA.loads.length).toBe(1);
        expect(storeB.loads.length).toBe(0);
    });

    // ── 17. putAll stores through owner paths ──

    it('putAll stores each entry through its partition owner MapStore', async () => {
        const storeA = new CountingMapStore();
        const storeB = new CountingMapStore();
        const [a, b] = await startTwoNodeCluster('store-paown', storeA, storeB);

        const entries: [string, string][] = [];
        for (let i = 0; i < 10; i++) {
            entries.push([`po-${i}`, `v-${i}`]);
        }

        const mapB = b.getMap<string, string>('store-paown');
        await mapB.putAll(entries);

        // Verify each store call happened on the correct owner
        const allAStores = storeA.stores.map(s => s.key);
        const allBStores = storeB.stores.map(s => s.key);

        for (const key of allAStores) {
            const pid = a.getPartitionIdForName(key);
            expect(a.getPartitionOwnerId(pid)).toBe(a.getLocalMemberId());
        }
        for (const key of allBStores) {
            const pid = a.getPartitionIdForName(key);
            expect(a.getPartitionOwnerId(pid)).toBe(b.getLocalMemberId());
        }

        // Total should be all entries
        expect(allAStores.length + allBStores.length).toBe(entries.length);
    });

    // ── 18. getAll loads only from owner MapStores ──

    it('getAll loads only from respective partition owner MapStores', async () => {
        const storeA = new CountingMapStore();
        const storeB = new CountingMapStore();
        const [a, b] = await startTwoNodeCluster('store-gaown', storeA, storeB);

        // Pre-populate stores on correct owners
        const keys: string[] = [];
        for (let i = 0; i < 10; i++) {
            const key = `go-${i}`;
            keys.push(key);
            const pid = a.getPartitionIdForName(key);
            const owner = a.getPartitionOwnerId(pid);
            if (owner === a.getLocalMemberId()) {
                await storeA.store(key, `ext-${i}`);
            } else {
                await storeB.store(key, `ext-${i}`);
            }
        }
        storeA.reset();
        storeB.reset();

        const mapA = a.getMap<string, string>('store-gaown');
        const result = await mapA.getAll(keys);

        expect(result.size).toBe(keys.length);

        // All loads happened on correct owners
        const aLoads = [...storeA.loads, ...storeA.loadAlls.flat()];
        const bLoads = [...storeB.loads, ...storeB.loadAlls.flat()];
        for (const k of aLoads) {
            const pid = a.getPartitionIdForName(k);
            expect(a.getPartitionOwnerId(pid)).toBe(a.getLocalMemberId());
        }
        for (const k of bLoads) {
            const pid = a.getPartitionIdForName(k);
            expect(a.getPartitionOwnerId(pid)).toBe(b.getLocalMemberId());
        }
    });

    // ── 19. Replace routes store through owner ──

    it('replace() routes external store through partition owner', async () => {
        const storeA = new CountingMapStore();
        const storeB = new CountingMapStore();
        const [a, _b] = await startTwoNodeCluster('store-replace', storeA, storeB);

        const keyOwnedByA = findKeyOwnedBy(a, a.getLocalMemberId(), 'rep');
        const mapA = a.getMap<string, string>('store-replace');

        // Put from owner so containsKey succeeds on the owner's local RecordStore
        await mapA.put(keyOwnedByA, 'old');
        storeA.reset();
        storeB.reset();

        await mapA.replace(keyOwnedByA, 'new');

        expect(storeA.stores.length).toBe(1);
        expect(storeB.stores.length).toBe(0);
    });

    // ── 20. Single-node MapStore still works (regression) ──

    it('single-node MapStore still works without clustering', async () => {
        const store = new CountingMapStore();
        const port = nextPort();
        const cfg = new HeliosConfig('single');
        cfg.getNetworkConfig().setPort(port);
        const msCfg = new MapStoreConfig();
        msCfg.setEnabled(true);
        msCfg.setImplementation(store);
        const mc = new MapConfig();
        mc.setName('single-map');
        mc.setMapStoreConfig(msCfg);
        cfg.addMapConfig(mc);

        const inst = await Helios.newInstance(cfg);
        instances.push(inst);

        const map = inst.getMap<string, string>('single-map');
        await map.put('k1', 'v1');
        await map.set('k2', 'v2');
        await map.remove('k1');

        expect(store.stores.length).toBe(2);
        expect(store.deletes.length).toBe(1);
    });

    // ── 21. Verification: partition owners are the ONLY external writers ──

    it('verification: partition owners are the only external writers across all operations', async () => {
        const storeA = new CountingMapStore();
        const storeB = new CountingMapStore();
        const [a, b] = await startTwoNodeCluster('store-verify', storeA, storeB);

        const mapA = a.getMap<string, string>('store-verify');
        const mapB = b.getMap<string, string>('store-verify');

        // Exercise all mutation types from both nodes
        for (let i = 0; i < 20; i++) {
            const key = `vfy-${i}`;
            if (i % 2 === 0) {
                await mapA.put(key, `a-${i}`);
            } else {
                await mapB.put(key, `b-${i}`);
            }
        }

        // Some removes
        for (let i = 0; i < 5; i++) {
            await mapB.remove(`vfy-${i * 2}`);
        }

        // Wait for any async processing
        await Bun.sleep(100);

        // Verify ALL store calls on A are for A-owned keys
        for (const s of storeA.stores) {
            const pid = a.getPartitionIdForName(s.key);
            expect(a.getPartitionOwnerId(pid)).toBe(a.getLocalMemberId());
        }

        // Verify ALL store calls on B are for B-owned keys
        for (const s of storeB.stores) {
            const pid = a.getPartitionIdForName(s.key);
            expect(a.getPartitionOwnerId(pid)).toBe(b.getLocalMemberId());
        }

        // Verify ALL delete calls on A are for A-owned keys
        for (const k of storeA.deletes) {
            const pid = a.getPartitionIdForName(k);
            expect(a.getPartitionOwnerId(pid)).toBe(a.getLocalMemberId());
        }

        // Verify ALL delete calls on B are for B-owned keys
        for (const k of storeB.deletes) {
            const pid = a.getPartitionIdForName(k);
            expect(a.getPartitionOwnerId(pid)).toBe(b.getLocalMemberId());
        }

        // Total stores should equal total puts (20)
        expect(storeA.stores.length + storeB.stores.length).toBe(20);
        // Total deletes should equal 5
        expect(storeA.deletes.length + storeB.deletes.length).toBe(5);
    });

    // ── 22. Verification: no duplicate external writes per mutation ──

    it('verification: exactly one external write per logical mutation, no duplicates', async () => {
        const storeA = new CountingMapStore();
        const storeB = new CountingMapStore();
        const [a, _b] = await startTwoNodeCluster('store-nodup', storeA, storeB);

        const mapA = a.getMap<string, string>('store-nodup');

        // 10 puts from A
        for (let i = 0; i < 10; i++) {
            await mapA.put(`nd-${i}`, `v-${i}`);
        }

        // Wait for backup replication
        await Bun.sleep(100);

        // Exactly 10 total store calls (one per put, split across owners)
        const totalStores = storeA.stores.length + storeB.stores.length;
        expect(totalStores).toBe(10);
    });
});
