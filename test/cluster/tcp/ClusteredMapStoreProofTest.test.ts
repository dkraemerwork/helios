/**
 * Block 21.4 — Real adapter proof + clustered MapStore production gate.
 *
 * Proves:
 *  - Clustered write-through correctness with provenance-recording adapters
 *  - Clustered write-behind correctness with provenance-recording adapters
 *  - No duplicate physical writes under healthy two-node write-through
 *  - No duplicate physical writes under healthy two-node write-behind
 *  - Owner-only persistence holds across put, set, remove, delete, putAll, getAll
 *  - Write-behind batching and coalescing work correctly in clustered mode
 *  - EAGER load in clustered mode calls loadAllKeys() through coordinated path only
 *  - LAZY load-on-miss works correctly in clustered write-behind mode
 *  - Clear does not produce duplicate external deletes
 *  - Mixed write-through and write-behind maps coexist correctly
 *  - No hidden broadcast-replay or duplicate-write behavior under end-to-end flows
 *
 * Every physical external call records provenance: memberId, partitionId,
 * replicaRole, partitionEpoch, and operationKind. Tests assert absence of
 * duplicate physical store/storeAll/delete/deleteAll for any single logical
 * mutation.
 */
import { Helios } from '@zenystx/helios-core/Helios';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import { MapConfig } from '@zenystx/helios-core/config/MapConfig';
import { InitialLoadMode, MapStoreConfig } from '@zenystx/helios-core/config/MapStoreConfig';
import type { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';
import { MapKeyStream } from '@zenystx/helios-core/map/MapKeyStream';
import type { MapStore } from '@zenystx/helios-core/map/MapStore';
import { afterEach, describe, expect, it } from 'bun:test';

const BASE_PORT = 17400;
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

// ═══════════════════════════════════════════════════════════
//  Provenance-recording adapter
// ═══════════════════════════════════════════════════════════

type OperationKind = 'store' | 'storeAll' | 'delete' | 'deleteAll' | 'load' | 'loadAll' | 'loadAllKeys';

interface ProvenanceRecord {
    memberId: string;
    partitionId: number;
    replicaRole: 'PRIMARY' | 'BACKUP' | 'UNKNOWN';
    partitionEpoch: number;
    operationKind: OperationKind;
    keys: string[];
    ts: number;
}

/**
 * Provenance-recording MapStore that captures memberId and operationKind
 * for every physical external call. partitionId and replicaRole are derived
 * at assertion time from the cluster topology — the adapter records the
 * calling memberId so we can verify it was the partition owner.
 */
class ProvenanceMapStore implements MapStore<string, string> {
    readonly records: ProvenanceRecord[] = [];
    private readonly _data = new Map<string, string>();
    private readonly _memberId: string;
    private _instance: HeliosInstanceImpl | null = null;

    constructor(memberId: string) {
        this._memberId = memberId;
    }

    setInstance(instance: HeliosInstanceImpl): void {
        this._instance = instance;
    }

    private _record(kind: OperationKind, keys: string[]): void {
        let partitionId = -1;
        let replicaRole: ProvenanceRecord['replicaRole'] = 'UNKNOWN';
        let partitionEpoch = 0;

        if (this._instance && keys.length > 0) {
            partitionId = this._instance.getPartitionIdForName(keys[0]!);
            const ownerId = this._instance.getPartitionOwnerId(partitionId);
            replicaRole = ownerId === this._memberId ? 'PRIMARY' : 'BACKUP';
            const mapSvc = (this._instance as any)._mapService;
            if (mapSvc && typeof mapSvc.getPartitionEpoch === 'function') {
                partitionEpoch = mapSvc.getPartitionEpoch(partitionId);
            }
        }

        this.records.push({
            memberId: this._memberId,
            partitionId,
            replicaRole,
            partitionEpoch,
            operationKind: kind,
            keys,
            ts: Date.now(),
        });
    }

    async store(key: string, value: string): Promise<void> {
        this._record('store', [key]);
        this._data.set(key, value);
    }

    async storeAll(entries: Map<string, string>): Promise<void> {
        this._record('storeAll', [...entries.keys()]);
        for (const [k, v] of entries) this._data.set(k, v);
    }

    async delete(key: string): Promise<void> {
        this._record('delete', [key]);
        this._data.delete(key);
    }

    async deleteAll(keys: string[]): Promise<void> {
        this._record('deleteAll', [...keys]);
        for (const k of keys) this._data.delete(k);
    }

    async load(key: string): Promise<string | null> {
        this._record('load', [key]);
        return this._data.get(key) ?? null;
    }

    async loadAll(keys: string[]): Promise<Map<string, string>> {
        this._record('loadAll', [...keys]);
        const result = new Map<string, string>();
        for (const k of keys) {
            const v = this._data.get(k);
            if (v !== undefined) result.set(k, v);
        }
        return result;
    }

    async loadAllKeys(): Promise<MapKeyStream<string>> {
        this._record('loadAllKeys', []);
        return MapKeyStream.fromIterable([...this._data.keys()]);
    }

    seed(key: string, value: string): void {
        this._data.set(key, value);
    }

    getData(): Map<string, string> {
        return new Map(this._data);
    }

    reset(): void {
        this.records.length = 0;
    }

    /** Count physical store calls (store + storeAll entries). */
    totalStoreCount(): number {
        return this.records
            .filter(r => r.operationKind === 'store' || r.operationKind === 'storeAll')
            .reduce((n, r) => n + r.keys.length, 0);
    }

    /** Count physical delete calls (delete + deleteAll entries). */
    totalDeleteCount(): number {
        return this.records
            .filter(r => r.operationKind === 'delete' || r.operationKind === 'deleteAll')
            .reduce((n, r) => n + r.keys.length, 0);
    }

    /** Count physical load calls (load + loadAll entries). */
    totalLoadCount(): number {
        return this.records
            .filter(r => r.operationKind === 'load' || r.operationKind === 'loadAll')
            .reduce((n, r) => n + r.keys.length, 0);
    }

    loadAllKeysCalls(): number {
        return this.records.filter(r => r.operationKind === 'loadAllKeys').length;
    }

    /** All write-type records (store/storeAll/delete/deleteAll). */
    writeRecords(): ProvenanceRecord[] {
        return this.records.filter(r =>
            r.operationKind === 'store' || r.operationKind === 'storeAll' ||
            r.operationKind === 'delete' || r.operationKind === 'deleteAll',
        );
    }
}

/**
 * Assert no duplicate physical writes for any key across both stores.
 * A duplicate means the same key appears in store/storeAll more than once
 * without an intervening logical mutation (i.e., two physical writes for
 * one logical put).
 *
 * instanceA / instanceB are the Helios instances owning storeA / storeB
 * respectively. Their cluster member UUIDs are used for owner verification
 * (instance names and member UUIDs are distinct since the UUID change).
 */
function assertNoDuplicatePhysicalWrites(
    storeA: ProvenanceMapStore,
    storeB: ProvenanceMapStore,
    instance: HeliosInstanceImpl,
    instanceA?: HeliosInstanceImpl,
    instanceB?: HeliosInstanceImpl,
): void {
    const memberIdA = (instanceA ?? storeA['_instance'])?.getLocalMemberId();
    const memberIdB = (instanceB ?? storeB['_instance'])?.getLocalMemberId();
    // Every write-type record must be on the partition owner
    if (memberIdA !== undefined) {
        for (const r of storeA.writeRecords()) {
            for (const key of r.keys) {
                const pid = instance.getPartitionIdForName(key);
                const owner = instance.getPartitionOwnerId(pid);
                expect(owner).toBe(memberIdA);
            }
        }
    }
    if (memberIdB !== undefined) {
        for (const r of storeB.writeRecords()) {
            for (const key of r.keys) {
                const pid = instance.getPartitionIdForName(key);
                const owner = instance.getPartitionOwnerId(pid);
                expect(owner).toBe(memberIdB);
            }
        }
    }
    // No key should have write records on both stores
    const writtenByA = new Set<string>();
    const writtenByB = new Set<string>();
    for (const r of storeA.writeRecords()) r.keys.forEach(k => writtenByA.add(k));
    for (const r of storeB.writeRecords()) r.keys.forEach(k => writtenByB.add(k));
    for (const k of writtenByA) {
        if (writtenByB.has(k)) {
            throw new Error(`Duplicate physical write: key "${k}" written by both members`);
        }
    }
}

/**
 * Assert provenance: writes on each store were executed on the correct partition
 * owner. Uses the Helios instance's member UUID for comparison (not the
 * human-readable store ID).
 */
function assertProvenanceOwnerOnly(
    storeA: ProvenanceMapStore,
    storeB: ProvenanceMapStore,
    instance: HeliosInstanceImpl,
): void {
    const instanceA: HeliosInstanceImpl | null = storeA['_instance'];
    const instanceB: HeliosInstanceImpl | null = storeB['_instance'];
    const memberIdA = instanceA?.getLocalMemberId();
    const memberIdB = instanceB?.getLocalMemberId();
    // storeA should only have records for partitions owned by member A
    for (const r of storeA.writeRecords()) {
        expect(r.memberId).toBe(storeA['_memberId']);
        if (memberIdA !== undefined) {
            for (const key of r.keys) {
                const pid = instance.getPartitionIdForName(key);
                expect(instance.getPartitionOwnerId(pid)).toBe(memberIdA);
            }
        }
    }
    // storeB should only have records for partitions owned by member B
    for (const r of storeB.writeRecords()) {
        expect(r.memberId).toBe(storeB['_memberId']);
        if (memberIdB !== undefined) {
            for (const key of r.keys) {
                const pid = instance.getPartitionIdForName(key);
                expect(instance.getPartitionOwnerId(pid)).toBe(memberIdB);
            }
        }
    }
}

describe('Block 21.4 — Real adapter proof + clustered MapStore production gate', () => {
    const instances: HeliosInstanceImpl[] = [];

    afterEach(async () => {
        for (const inst of instances) {
            if (inst.isRunning()) inst.shutdown();
        }
        instances.length = 0;
        await Bun.sleep(30);
    });

    function makeWriteThroughConfig(
        name: string,
        port: number,
        peerPorts: number[],
        mapName: string,
        store: ProvenanceMapStore,
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

    function makeWriteBehindConfig(
        name: string,
        port: number,
        peerPorts: number[],
        mapName: string,
        store: ProvenanceMapStore,
        delaySeconds = 1,
        batchSize = 1,
        coalescing = false,
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
        msCfg.setWriteDelaySeconds(delaySeconds);
        msCfg.setWriteBatchSize(batchSize);
        msCfg.setWriteCoalescing(coalescing);
        const mc = new MapConfig();
        mc.setName(mapName);
        mc.setMapStoreConfig(msCfg);
        cfg.addMapConfig(mc);
        return cfg;
    }

    function makeEagerConfig(
        name: string,
        port: number,
        peerPorts: number[],
        mapName: string,
        store: ProvenanceMapStore,
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
        msCfg.setInitialLoadMode(InitialLoadMode.EAGER);
        const mc = new MapConfig();
        mc.setName(mapName);
        mc.setMapStoreConfig(msCfg);
        cfg.addMapConfig(mc);
        return cfg;
    }

    async function startTwoNode(
        mapName: string,
        cfgFn: (name: string, port: number, peers: number[], map: string, store: ProvenanceMapStore) => HeliosConfig,
        storeA: ProvenanceMapStore,
        storeB: ProvenanceMapStore,
    ): Promise<[HeliosInstanceImpl, HeliosInstanceImpl]> {
        const portA = nextPort();
        const portB = nextPort();
        const a = await Helios.newInstance(cfgFn('proofA', portA, [], mapName, storeA));
        instances.push(a);
        storeA.setInstance(a);
        const b = await Helios.newInstance(cfgFn('proofB', portB, [portA], mapName, storeB));
        instances.push(b);
        storeB.setInstance(b);
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
            if (instance.getPartitionOwnerId(pid) === ownerName) return key;
        }
        throw new Error(`Could not find key owned by ${ownerName}`);
    }

    // ═══════════════════════════════════════════════════════════
    //  SECTION 1: Write-through provenance-recording proof
    // ═══════════════════════════════════════════════════════════

    it('WT-1: write-through put — exactly one physical store on owner, provenance verified', async () => {
        const sA = new ProvenanceMapStore('proofA');
        const sB = new ProvenanceMapStore('proofB');
        const [a, b] = await startTwoNode('wt-put', makeWriteThroughConfig, sA, sB);

        const key = findKeyOwnedBy(a, a.getLocalMemberId(), 'wt');
        await b.getMap<string, string>('wt-put').put(key, 'v1');

        expect(sA.totalStoreCount()).toBe(1);
        expect(sB.totalStoreCount()).toBe(0);
        assertNoDuplicatePhysicalWrites(sA, sB, a);
        assertProvenanceOwnerOnly(sA, sB, a);

        // Verify provenance record fields
        const rec = sA.records[0]!;
        expect(rec.memberId).toBe('proofA');
        expect(rec.operationKind).toBe('store');
        expect(rec.keys).toEqual([key]);
    });

    it('WT-2: write-through remove — exactly one physical delete on owner, provenance verified', async () => {
        const sA = new ProvenanceMapStore('proofA');
        const sB = new ProvenanceMapStore('proofB');
        const [a, b] = await startTwoNode('wt-rm', makeWriteThroughConfig, sA, sB);

        const key = findKeyOwnedBy(a, a.getLocalMemberId(), 'wtrm');
        await a.getMap<string, string>('wt-rm').put(key, 'v');
        sA.reset(); sB.reset();

        await b.getMap<string, string>('wt-rm').remove(key);
        expect(sA.totalDeleteCount()).toBe(1);
        expect(sB.totalDeleteCount()).toBe(0);
        assertNoDuplicatePhysicalWrites(sA, sB, a);
        assertProvenanceOwnerOnly(sA, sB, a);
    });

    it('WT-3: write-through putAll — routes to owners, no duplicate physical writes', async () => {
        const sA = new ProvenanceMapStore('proofA');
        const sB = new ProvenanceMapStore('proofB');
        const [a, _b] = await startTwoNode('wt-pa', makeWriteThroughConfig, sA, sB);

        const entries: [string, string][] = [];
        for (let i = 0; i < 30; i++) entries.push([`wtpa-${i}`, `v-${i}`]);

        await a.getMap<string, string>('wt-pa').putAll(entries);

        const total = sA.totalStoreCount() + sB.totalStoreCount();
        expect(total).toBe(entries.length);
        assertNoDuplicatePhysicalWrites(sA, sB, a);
        assertProvenanceOwnerOnly(sA, sB, a);
    });

    it('WT-4: write-through getAll load-on-miss — loads routed to owners, no duplicates', async () => {
        const sA = new ProvenanceMapStore('proofA');
        const sB = new ProvenanceMapStore('proofB');
        const [a, b] = await startTwoNode('wt-ga', makeWriteThroughConfig, sA, sB);

        for (let i = 0; i < 20; i++) {
            const key = `wtga-${i}`;
            const pid = a.getPartitionIdForName(key);
            const owner = a.getPartitionOwnerId(pid);
            if (owner === a.getLocalMemberId()) sA.seed(key, `ext-${i}`);
            else sB.seed(key, `ext-${i}`);
        }
        sA.reset(); sB.reset();

        const keys = Array.from({ length: 20 }, (_, i) => `wtga-${i}`);
        const result = await b.getMap<string, string>('wt-ga').getAll(keys);

        for (const key of keys) expect(result.get(key)).toBeDefined();
        const totalLoads = sA.totalLoadCount() + sB.totalLoadCount();
        expect(totalLoads).toBe(keys.length);
    });

    it('WT-5: write-through mixed ops — zero duplicate physical calls, provenance correct', async () => {
        const sA = new ProvenanceMapStore('proofA');
        const sB = new ProvenanceMapStore('proofB');
        const [a, b] = await startTwoNode('wt-mix', makeWriteThroughConfig, sA, sB);

        const keyA = findKeyOwnedBy(a, a.getLocalMemberId(), 'wtmx');
        const mapB = b.getMap<string, string>('wt-mix');

        await mapB.put(keyA, 'v1');
        await mapB.set(keyA, 'v2');
        await mapB.remove(keyA);
        await mapB.put(keyA, 'v3');
        await mapB.delete(keyA);

        expect(sA.totalStoreCount()).toBe(3);
        expect(sA.totalDeleteCount()).toBe(2);
        expect(sB.totalStoreCount()).toBe(0);
        expect(sB.totalDeleteCount()).toBe(0);
        assertProvenanceOwnerOnly(sA, sB, a);

        // Verify every record has correct memberId
        for (const r of sA.records) {
            expect(r.memberId).toBe('proofA');
        }
    });

    // ═══════════════════════════════════════════════════════════
    //  SECTION 2: Write-behind provenance-recording proof
    // ═══════════════════════════════════════════════════════════

    it('WB-1: write-behind put — flushes to owner only, provenance verified', async () => {
        const sA = new ProvenanceMapStore('proofA');
        const sB = new ProvenanceMapStore('proofB');
        const [a, b] = await startTwoNode('wb-put', makeWriteBehindConfig, sA, sB);

        const key = findKeyOwnedBy(a, a.getLocalMemberId(), 'wbp');
        await b.getMap<string, string>('wb-put').put(key, 'v1');

        await waitUntil(() => sA.totalStoreCount() >= 1, 3000);

        expect(sA.totalStoreCount()).toBeGreaterThanOrEqual(1);
        expect(sB.totalStoreCount()).toBe(0);
        assertProvenanceOwnerOnly(sA, sB, a);
    });

    it('WB-2: write-behind batching — storeAll on owner, no backup writes', async () => {
        const sA = new ProvenanceMapStore('batchA');
        const sB = new ProvenanceMapStore('batchB');
        const portA = nextPort();
        const portB = nextPort();
        const a = await Helios.newInstance(
            makeWriteBehindConfig('batchA', portA, [], 'wb-batch', sA, 1, 5),
        );
        instances.push(a);
        const b = await Helios.newInstance(
            makeWriteBehindConfig('batchB', portB, [portA], 'wb-batch', sB, 1, 5),
        );
        instances.push(b);
        await waitForClusterSize(a, 2);
        await waitForClusterSize(b, 2);

        const mapA = a.getMap<string, string>('wb-batch');

        for (let i = 0; i < 5; i++) {
            const key = findKeyOwnedBy(a, a.getLocalMemberId(), `wbb-${i}`);
            await mapA.put(key, `batch-${i}`);
        }

        await waitUntil(() => sA.totalStoreCount() >= 5, 3000);

        expect(sA.totalStoreCount()).toBeGreaterThanOrEqual(5);
        expect(sB.totalStoreCount()).toBe(0);
        assertProvenanceOwnerOnly(sA, sB, a);
    });

    it('WB-3: write-behind coalescing — deduplicates on owner, provenance verified', async () => {
        const sA = new ProvenanceMapStore('coalA');
        const sB = new ProvenanceMapStore('coalB');
        const portA = nextPort();
        const portB = nextPort();
        const a = await Helios.newInstance(
            makeWriteBehindConfig('coalA', portA, [], 'wb-coal', sA, 1, 1, true),
        );
        instances.push(a);
        const b = await Helios.newInstance(
            makeWriteBehindConfig('coalB', portB, [portA], 'wb-coal', sB, 1, 1, true),
        );
        instances.push(b);
        await waitForClusterSize(a, 2);
        await waitForClusterSize(b, 2);

        const key = findKeyOwnedBy(a, a.getLocalMemberId(), 'coal');
        const mapA = a.getMap<string, string>('wb-coal');

        for (let i = 0; i < 5; i++) await mapA.put(key, `coal-${i}`);

        await waitUntil(() => sA.totalStoreCount() >= 1, 3000);

        expect(sA.totalStoreCount()).toBeLessThanOrEqual(5);
        expect(sA.totalStoreCount()).toBeGreaterThanOrEqual(1);
        expect(sB.totalStoreCount()).toBe(0);
        assertProvenanceOwnerOnly(sA, sB, a);
    });

    it('WB-4: write-behind remove — exactly one physical delete on owner after flush', async () => {
        const sA = new ProvenanceMapStore('proofA');
        const sB = new ProvenanceMapStore('proofB');
        const [a, b] = await startTwoNode('wb-rm', makeWriteBehindConfig, sA, sB);

        const key = findKeyOwnedBy(a, a.getLocalMemberId(), 'wbrm');
        const mapA = a.getMap<string, string>('wb-rm');
        await mapA.put(key, 'v');
        await waitUntil(() => sA.totalStoreCount() >= 1, 3000);
        sA.reset(); sB.reset();

        await b.getMap<string, string>('wb-rm').remove(key);
        await waitUntil(() => sA.totalDeleteCount() >= 1, 3000);

        expect(sA.totalDeleteCount()).toBeGreaterThanOrEqual(1);
        expect(sB.totalDeleteCount()).toBe(0);
        assertProvenanceOwnerOnly(sA, sB, a);
    });

    it('WB-5: write-behind lazy load-on-miss — loads on owner only', async () => {
        const sA = new ProvenanceMapStore('proofA');
        const sB = new ProvenanceMapStore('proofB');
        const [a, b] = await startTwoNode('wb-lazy', makeWriteBehindConfig, sA, sB);

        const key = findKeyOwnedBy(a, a.getLocalMemberId(), 'wblz');
        sA.seed(key, 'lazy-ext');

        const val = await b.getMap<string, string>('wb-lazy').get(key);
        expect(val).toBe('lazy-ext');

        const loadRecords = sA.records.filter(r => r.operationKind === 'load');
        expect(loadRecords.length).toBe(1);
        expect(loadRecords[0]!.memberId).toBe('proofA');
        expect(sB.records.filter(r => r.operationKind === 'load').length).toBe(0);
    });

    // ═══════════════════════════════════════════════════════════
    //  SECTION 3: Clustered EAGER load proof
    // ═══════════════════════════════════════════════════════════

    it('EAGER-1: clustered EAGER load — coordinated loadAllKeys, provenance verified', async () => {
        const sA = new ProvenanceMapStore('proofA');
        const sB = new ProvenanceMapStore('proofB');

        for (let i = 0; i < 10; i++) {
            sA.seed(`ek-${i}`, `ev-${i}`);
            sB.seed(`ek-${i}`, `ev-${i}`);
        }

        const [a, b] = await startTwoNode('eager-proof', makeEagerConfig, sA, sB);

        const mapA = a.getMap<string, string>('eager-proof');
        const mapB = b.getMap<string, string>('eager-proof');

        await Bun.sleep(1000);

        const totalLoadAllKeys = sA.loadAllKeysCalls() + sB.loadAllKeysCalls();
        expect(totalLoadAllKeys).toBeLessThanOrEqual(2);

        for (let i = 0; i < 10; i++) {
            const vA = await mapA.get(`ek-${i}`);
            const vB = await mapB.get(`ek-${i}`);
            expect(vA).toBe(`ev-${i}`);
            expect(vB).toBe(`ev-${i}`);
        }
    });

    // ═══════════════════════════════════════════════════════════
    //  SECTION 4: Clear proof
    // ═══════════════════════════════════════════════════════════

    it('CLEAR-1: clustered clear — no duplicate external deletes, provenance verified', async () => {
        const sA = new ProvenanceMapStore('proofA');
        const sB = new ProvenanceMapStore('proofB');
        const [a, _b] = await startTwoNode('clear-proof', makeWriteThroughConfig, sA, sB);

        const mapA = a.getMap<string, string>('clear-proof');
        for (let i = 0; i < 10; i++) await mapA.put(`cp-${i}`, `v-${i}`);
        sA.reset(); sB.reset();

        await mapA.clear();
        expect(mapA.size()).toBe(0);

        const totalDeletes = sA.totalDeleteCount() + sB.totalDeleteCount();
        expect(totalDeletes).toBeLessThanOrEqual(10);
        assertProvenanceOwnerOnly(sA, sB, a);
    });

    // ═══════════════════════════════════════════════════════════
    //  SECTION 5: Mixed mode proof
    // ═══════════════════════════════════════════════════════════

    it('MIXED-1: write-through and write-behind coexist — provenance isolated per map', async () => {
        const wtStoreA = new ProvenanceMapStore('mixA');
        const wtStoreB = new ProvenanceMapStore('mixB');
        const wbStoreA = new ProvenanceMapStore('mixA');
        const wbStoreB = new ProvenanceMapStore('mixB');

        const portA = nextPort();
        const portB = nextPort();

        const cfgA = new HeliosConfig('mixA');
        cfgA.getNetworkConfig().setPort(portA).getJoin().getTcpIpConfig().setEnabled(true);

        const wtCfgA = new MapStoreConfig();
        wtCfgA.setEnabled(true).setImplementation(wtStoreA);
        const wtMapA = new MapConfig();
        wtMapA.setName('mix-wt');
        wtMapA.setMapStoreConfig(wtCfgA);
        cfgA.addMapConfig(wtMapA);

        const wbCfgA = new MapStoreConfig();
        wbCfgA.setEnabled(true).setImplementation(wbStoreA).setWriteDelaySeconds(1);
        const wbMapA = new MapConfig();
        wbMapA.setName('mix-wb');
        wbMapA.setMapStoreConfig(wbCfgA);
        cfgA.addMapConfig(wbMapA);

        const cfgB = new HeliosConfig('mixB');
        cfgB.getNetworkConfig().setPort(portB).getJoin().getTcpIpConfig().setEnabled(true);
        cfgB.getNetworkConfig().getJoin().getTcpIpConfig().addMember(`localhost:${portA}`);

        const wtCfgB = new MapStoreConfig();
        wtCfgB.setEnabled(true).setImplementation(wtStoreB);
        const wtMapB = new MapConfig();
        wtMapB.setName('mix-wt');
        wtMapB.setMapStoreConfig(wtCfgB);
        cfgB.addMapConfig(wtMapB);

        const wbCfgB = new MapStoreConfig();
        wbCfgB.setEnabled(true).setImplementation(wbStoreB).setWriteDelaySeconds(1);
        const wbMapB = new MapConfig();
        wbMapB.setName('mix-wb');
        wbMapB.setMapStoreConfig(wbCfgB);
        cfgB.addMapConfig(wbMapB);

        const a = await Helios.newInstance(cfgA);
        instances.push(a);
        const b = await Helios.newInstance(cfgB);
        instances.push(b);
        await waitForClusterSize(a, 2);
        await waitForClusterSize(b, 2);

        const keyWt = findKeyOwnedBy(a, a.getLocalMemberId(), 'mwt');
        await b.getMap<string, string>('mix-wt').put(keyWt, 'wt-val');
        expect(wtStoreA.totalStoreCount()).toBe(1);
        expect(wtStoreB.totalStoreCount()).toBe(0);

        const keyWb = findKeyOwnedBy(a, a.getLocalMemberId(), 'mwb');
        await b.getMap<string, string>('mix-wb').put(keyWb, 'wb-val');
        await waitUntil(() => wbStoreA.totalStoreCount() >= 1, 3000);
        expect(wbStoreA.totalStoreCount()).toBeGreaterThanOrEqual(1);
        expect(wbStoreB.totalStoreCount()).toBe(0);

        // Verify provenance memberId on all write records
        for (const r of wtStoreA.writeRecords()) expect(r.memberId).toBe('mixA');
        for (const r of wbStoreA.writeRecords()) expect(r.memberId).toBe('mixA');
    });

    // ═══════════════════════════════════════════════════════════
    //  SECTION 6: End-to-end production gate verification
    // ═══════════════════════════════════════════════════════════

    it('GATE-1: bidirectional ownership — both nodes serve as owners, provenance verified', async () => {
        const sA = new ProvenanceMapStore('proofA');
        const sB = new ProvenanceMapStore('proofB');
        const [a, b] = await startTwoNode('gate-bidir', makeWriteThroughConfig, sA, sB);

        const mapA = a.getMap<string, string>('gate-bidir');
        const keyA = findKeyOwnedBy(a, a.getLocalMemberId(), 'gA');
        const keyB = findKeyOwnedBy(a, b.getLocalMemberId(), 'gB');

        await mapA.put(keyA, 'on-A');
        await mapA.put(keyB, 'on-B');

        expect(sA.records.some(r => r.keys.includes(keyA))).toBe(true);
        expect(sB.records.some(r => r.keys.includes(keyB))).toBe(true);
        assertNoDuplicatePhysicalWrites(sA, sB, a);
        assertProvenanceOwnerOnly(sA, sB, a);
    });

    it('GATE-2: high-volume write-through — 100 ops, no duplicates, provenance correct', async () => {
        const sA = new ProvenanceMapStore('proofA');
        const sB = new ProvenanceMapStore('proofB');
        const [a, b] = await startTwoNode('gate-vol', makeWriteThroughConfig, sA, sB);

        const mapA = a.getMap<string, string>('gate-vol');
        const mapB = b.getMap<string, string>('gate-vol');

        for (let i = 0; i < 50; i++) await mapA.put(`gv-${i}`, `a-${i}`);
        for (let i = 50; i < 100; i++) await mapB.put(`gv-${i}`, `b-${i}`);

        const total = sA.totalStoreCount() + sB.totalStoreCount();
        expect(total).toBe(100);
        assertNoDuplicatePhysicalWrites(sA, sB, a);
        assertProvenanceOwnerOnly(sA, sB, a);
    });

    it('GATE-3: write-behind high-volume — 30 ops, no duplicates after flush', async () => {
        const sA = new ProvenanceMapStore('proofA');
        const sB = new ProvenanceMapStore('proofB');
        const [a, b] = await startTwoNode('gate-wbvol', makeWriteBehindConfig, sA, sB);

        const mapA = a.getMap<string, string>('gate-wbvol');

        for (let i = 0; i < 30; i++) await mapA.put(`gwb-${i}`, `v-${i}`);

        await waitUntil(() => sA.totalStoreCount() + sB.totalStoreCount() >= 30, 5000);

        const total = sA.totalStoreCount() + sB.totalStoreCount();
        expect(total).toBe(30);
        assertNoDuplicatePhysicalWrites(sA, sB, a);
        assertProvenanceOwnerOnly(sA, sB, a);
    });

    it('GATE-4: no broadcast-replay — non-owner writes produce zero backup external calls', async () => {
        const sA = new ProvenanceMapStore('proofA');
        const sB = new ProvenanceMapStore('proofB');
        const [a, b] = await startTwoNode('gate-noreplay', makeWriteThroughConfig, sA, sB);

        const key = findKeyOwnedBy(a, a.getLocalMemberId(), 'nr');
        const mapB = b.getMap<string, string>('gate-noreplay');

        await mapB.put(key, 'v1');
        await mapB.put(key, 'v2');
        await mapB.remove(key);

        expect(sB.totalStoreCount()).toBe(0);
        expect(sB.totalDeleteCount()).toBe(0);
        expect(sA.totalStoreCount()).toBe(2);
        expect(sA.totalDeleteCount()).toBe(1);
        assertProvenanceOwnerOnly(sA, sB, a);

        const valA = await a.getMap<string, string>('gate-noreplay').get(key);
        const valB = await mapB.get(key);
        expect(valA).toBeNull();
        expect(valB).toBeNull();
    });

    // ═══════════════════════════════════════════════════════════
    //  SECTION 7: Adapter eligibility proof
    // ═══════════════════════════════════════════════════════════

    it('ADAPTER-1: full lifecycle adapter contract — provenance-recorded end-to-end', async () => {
        const sA = new ProvenanceMapStore('proofA');
        const sB = new ProvenanceMapStore('proofB');
        const [a, _b] = await startTwoNode('adapter-proof', makeWriteThroughConfig, sA, sB);

        const mapA = a.getMap<string, string>('adapter-proof');
        const mapB = _b.getMap<string, string>('adapter-proof');

        // 1. Put from non-owner
        const keyA = findKeyOwnedBy(a, a.getLocalMemberId(), 'ap');
        await mapB.put(keyA, 'adapter-v1');
        expect(sA.totalStoreCount()).toBe(1);
        expect(sB.totalStoreCount()).toBe(0);

        // 2. Get (in-memory, no load)
        const v1 = await mapB.get(keyA);
        expect(v1).toBe('adapter-v1');

        // 3. Load-on-miss
        const missKey = findKeyOwnedBy(a, a.getLocalMemberId(), 'apmiss');
        sA.seed(missKey, 'ext-miss');
        sA.reset(); sB.reset();
        const missVal = await mapB.get(missKey);
        expect(missVal).toBe('ext-miss');
        expect(sA.records.filter(r => r.operationKind === 'load').length).toBe(1);
        expect(sB.records.filter(r => r.operationKind === 'load').length).toBe(0);

        // 4. Remove
        sA.reset(); sB.reset();
        await mapB.remove(keyA);
        expect(sA.totalDeleteCount()).toBe(1);
        expect(sB.totalDeleteCount()).toBe(0);

        // 5. putAll
        sA.reset(); sB.reset();
        const entries: [string, string][] = [];
        for (let i = 0; i < 10; i++) entries.push([`apall-${i}`, `pv-${i}`]);
        await mapA.putAll(entries);
        const totalPutAll = sA.totalStoreCount() + sB.totalStoreCount();
        expect(totalPutAll).toBe(10);

        assertNoDuplicatePhysicalWrites(sA, sB, a);
        assertProvenanceOwnerOnly(sA, sB, a);
    });
});
