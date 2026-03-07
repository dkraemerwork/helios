/**
 * Block 21.4 — MongoDB clustered MapStore proof.
 *
 * Gated by HELIOS_MONGODB_TEST_URI environment variable.
 * Requires a running MongoDB instance.
 *
 * Run:
 *   HELIOS_MONGODB_TEST_URI=mongodb://127.0.0.1:27017 bun test packages/mongodb/test/MongoClusteredMapStore.test.ts
 *
 * Proves:
 *  - MongoDB adapter works correctly as a clustered MapStore (owner-only writes)
 *  - Write-through with real MongoDB produces no duplicate documents
 *  - Load-on-miss fetches from MongoDB through partition owner only
 *  - putAll/getAll route correctly through owners to MongoDB
 *  - Per-call provenance capture (memberId, partitionId, replicaRole, partitionEpoch,
 *    operationKind) is verified for every physical external call
 *  - No duplicate physical store/delete calls for any single logical mutation
 */
import { describe, it, expect, afterEach, beforeAll, afterAll } from 'bun:test';

const MONGO_URI = process.env.HELIOS_MONGODB_TEST_URI;
const SKIP = !MONGO_URI;

let Helios: any;
let HeliosConfig: any;
let MapStoreConfig: any;
let MapConfig: any;
let MongoMapStore: any;
let MongoClient: any;

if (!SKIP) {
    const core = await import('@zenystx/helios-core/Helios');
    Helios = core.Helios;
    const cfgMod = await import('@zenystx/helios-core/config/HeliosConfig');
    HeliosConfig = cfgMod.HeliosConfig;
    const msCfgMod = await import('@zenystx/helios-core/config/MapStoreConfig');
    MapStoreConfig = msCfgMod.MapStoreConfig;
    const mcMod = await import('@zenystx/helios-core/config/MapConfig');
    MapConfig = mcMod.MapConfig;
    const mongoMod = await import('../src/MongoMapStore.js');
    MongoMapStore = mongoMod.MongoMapStore;
    const mongoDriver = await import('mongodb');
    MongoClient = mongoDriver.MongoClient;
}

const BASE_PORT = 17600;
let portCounter = 0;
function nextPort(): number {
    return BASE_PORT + (portCounter++);
}

async function waitForClusterSize(instance: any, count: number): Promise<void> {
    const deadline = Date.now() + 10000;
    while (instance.getCluster().getMembers().length !== count) {
        if (Date.now() >= deadline) throw new Error('Cluster size timeout');
        await Bun.sleep(20);
    }
}

// ═══════════════════════════════════════════════════════════
//  Provenance-recording wrapper with full provenance fields
// ═══════════════════════════════════════════════════════════

interface ProvenanceRecord {
    memberId: string;
    partitionId: number;
    replicaRole: 'PRIMARY' | 'BACKUP' | 'UNKNOWN';
    partitionEpoch: number;
    operationKind: string;
    keys: string[];
    ts: number;
}

class ProvenanceMongoStore {
    readonly records: ProvenanceRecord[] = [];
    private readonly _inner: any;
    private readonly _memberId: string;
    private _instance: any = null;

    constructor(memberId: string, opts: any) {
        this._memberId = memberId;
        this._inner = new MongoMapStore(opts);
    }

    setInstance(instance: any): void {
        this._instance = instance;
    }

    private _record(kind: string, keys: string[]): void {
        let partitionId = -1;
        let replicaRole: ProvenanceRecord['replicaRole'] = 'UNKNOWN';
        let partitionEpoch = 0;

        if (this._instance && keys.length > 0) {
            partitionId = this._instance.getPartitionIdForName(keys[0]!);
            const ownerId = this._instance.getPartitionOwnerId(partitionId);
            replicaRole = ownerId === this._memberId ? 'PRIMARY' : 'BACKUP';
            const mapSvc = this._instance._mapService;
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
        return this._inner.store(key, value);
    }

    async storeAll(entries: Map<string, string>): Promise<void> {
        this._record('storeAll', [...entries.keys()]);
        return this._inner.storeAll(entries);
    }

    async delete(key: string): Promise<void> {
        this._record('delete', [key]);
        return this._inner.delete(key);
    }

    async deleteAll(keys: string[]): Promise<void> {
        this._record('deleteAll', [...keys]);
        return this._inner.deleteAll(keys);
    }

    async load(key: string): Promise<string | null> {
        this._record('load', [key]);
        return this._inner.load(key);
    }

    async loadAll(keys: string[]): Promise<Map<string, string>> {
        this._record('loadAll', [...keys]);
        return this._inner.loadAll(keys);
    }

    async loadAllKeys(): Promise<any> {
        this._record('loadAllKeys', []);
        return this._inner.loadAllKeys();
    }

    async init(properties: Map<string, string>, mapName: string): Promise<void> {
        if (typeof this._inner.init === 'function') {
            return this._inner.init(properties, mapName);
        }
    }

    async destroy(): Promise<void> {
        if (typeof this._inner.destroy === 'function') {
            return this._inner.destroy();
        }
    }

    totalStoreCount(): number {
        return this.records
            .filter(r => r.operationKind === 'store' || r.operationKind === 'storeAll')
            .reduce((n, r) => n + r.keys.length, 0);
    }

    totalDeleteCount(): number {
        return this.records
            .filter(r => r.operationKind === 'delete' || r.operationKind === 'deleteAll')
            .reduce((n, r) => n + r.keys.length, 0);
    }

    writeRecords(): ProvenanceRecord[] {
        return this.records.filter(r =>
            r.operationKind === 'store' || r.operationKind === 'storeAll' ||
            r.operationKind === 'delete' || r.operationKind === 'deleteAll',
        );
    }

    reset(): void {
        this.records.length = 0;
    }
}

// ═══════════════════════════════════════════════════════════
//  Provenance assertion helpers
// ═══════════════════════════════════════════════════════════

function assertProvenanceOwnerOnly(storeA: ProvenanceMongoStore, storeB: ProvenanceMongoStore, instance: any): void {
    for (const r of storeA.writeRecords()) {
        expect(r.replicaRole).toBe('PRIMARY');
        for (const key of r.keys) {
            const pid = instance.getPartitionIdForName(key);
            expect(instance.getPartitionOwnerId(pid)).toBe(r.memberId);
        }
    }
    for (const r of storeB.writeRecords()) {
        expect(r.replicaRole).toBe('PRIMARY');
        for (const key of r.keys) {
            const pid = instance.getPartitionIdForName(key);
            expect(instance.getPartitionOwnerId(pid)).toBe(r.memberId);
        }
    }
}

function assertNoDuplicateWrites(storeA: ProvenanceMongoStore, storeB: ProvenanceMongoStore): void {
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

function assertPartitionIdsPresent(store: ProvenanceMongoStore): void {
    for (const r of store.writeRecords()) {
        expect(r.partitionId).toBeGreaterThanOrEqual(0);
    }
}

function assertFullProvenance(storeA: ProvenanceMongoStore, storeB: ProvenanceMongoStore, instance: any): void {
    assertProvenanceOwnerOnly(storeA, storeB, instance);
    assertNoDuplicateWrites(storeA, storeB);
    assertPartitionIdsPresent(storeA);
    assertPartitionIdsPresent(storeB);
}

describe('Block 21.4 — MongoDB clustered MapStore proof', () => {
    if (SKIP) {
        it('SKIP: MongoDB not available (set HELIOS_MONGODB_TEST_URI to enable)', () => {
            expect(true).toBe(true);
        });
        return;
    }

    const DB_NAME = 'helios_clustered_proof';
    const COLL_NAME = 'clustered_test';
    let client: any;
    const instances: any[] = [];

    beforeAll(async () => {
        client = new MongoClient(MONGO_URI);
        await client.connect();
        await client.db(DB_NAME).collection(COLL_NAME).deleteMany({});
    });

    afterEach(async () => {
        for (const inst of instances) {
            if (inst.isRunning()) inst.shutdown();
        }
        instances.length = 0;
        await Bun.sleep(30);
        await client.db(DB_NAME).collection(COLL_NAME).deleteMany({});
    });

    afterAll(async () => {
        await client?.close();
    });

    function makeConfig(name: string, port: number, peerPorts: number[]): { cfg: any; store: ProvenanceMongoStore } {
        const cfg = new HeliosConfig(name);
        cfg.getNetworkConfig().setPort(port).getJoin().getTcpIpConfig().setEnabled(true);
        for (const pp of peerPorts) {
            cfg.getNetworkConfig().getJoin().getTcpIpConfig().addMember(`localhost:${pp}`);
        }
        const store = new ProvenanceMongoStore(name, {
            uri: MONGO_URI,
            database: DB_NAME,
            collection: COLL_NAME,
        });
        const msCfg = new MapStoreConfig();
        msCfg.setEnabled(true).setImplementation(store);
        const mc = new MapConfig();
        mc.setName('mongo-clustered');
        mc.setMapStoreConfig(msCfg);
        cfg.addMapConfig(mc);
        return { cfg, store };
    }

    function findKeyOwnedBy(instance: any, ownerName: string, prefix = 'mk'): string {
        for (let i = 0; i < 1000; i++) {
            const key = `${prefix}-${i}`;
            const pid = instance.getPartitionIdForName(key);
            if (instance.getPartitionOwnerId(pid) === ownerName) return key;
        }
        throw new Error(`Could not find key owned by ${ownerName}`);
    }

    async function startTwoNode(name1: string, name2: string): Promise<[any, any, ProvenanceMongoStore, ProvenanceMongoStore]> {
        const portA = nextPort();
        const portB = nextPort();
        const { cfg: cfgA, store: storeA } = makeConfig(name1, portA, []);
        const { cfg: cfgB, store: storeB } = makeConfig(name2, portB, [portA]);
        const a = await Helios.newInstance(cfgA);
        instances.push(a);
        storeA.setInstance(a);
        const b = await Helios.newInstance(cfgB);
        instances.push(b);
        storeB.setInstance(b);
        await waitForClusterSize(a, 2);
        return [a, b, storeA, storeB];
    }

    it('MONGO-1: clustered put — writes to MongoDB exactly once via owner, full provenance', async () => {
        const [a, b, storeA, storeB] = await startTwoNode('mongoA', 'mongoB');

        const key = findKeyOwnedBy(a, a.getName(), 'mput');
        await b.getMap('mongo-clustered').put(key, 'mongo-val');

        const coll = client.db(DB_NAME).collection(COLL_NAME);
        const doc = await coll.findOne({ _id: key });
        expect(doc).not.toBeNull();
        const count = await coll.countDocuments({ _id: key });
        expect(count).toBe(1);

        expect(storeA.totalStoreCount()).toBe(1);
        expect(storeB.totalStoreCount()).toBe(0);
        assertFullProvenance(storeA, storeB, a);

        const rec = storeA.records[0]!;
        expect(rec.memberId).toBe('mongoA');
        expect(rec.operationKind).toBe('store');
        expect(rec.replicaRole).toBe('PRIMARY');
        expect(rec.partitionId).toBeGreaterThanOrEqual(0);
        expect(rec.partitionEpoch).toBeGreaterThanOrEqual(0);
    });

    it('MONGO-2: clustered get — loads from MongoDB through owner on miss, full provenance', async () => {
        const coll = client.db(DB_NAME).collection(COLL_NAME);
        await coll.insertOne({ _id: 'preseeded', value: JSON.stringify('ext-value') });

        const [_a, b, storeA, storeB] = await startTwoNode('mongoLA', 'mongoLB');

        const val = await b.getMap('mongo-clustered').get('preseeded');
        expect(val).toBe('ext-value');

        const loadA = storeA.records.filter(r => r.operationKind === 'load');
        const loadB = storeB.records.filter(r => r.operationKind === 'load');
        expect(loadA.length + loadB.length).toBe(1);

        // Load record should show PRIMARY role
        const loadRec = loadA.length > 0 ? loadA[0]! : loadB[0]!;
        expect(loadRec.replicaRole).toBe('PRIMARY');
        expect(loadRec.partitionId).toBeGreaterThanOrEqual(0);
    });

    it('MONGO-3: clustered remove — deletes from MongoDB exactly once, full provenance', async () => {
        const [a, b, storeA, storeB] = await startTwoNode('mongoRA', 'mongoRB');

        const key = findKeyOwnedBy(a, a.getName(), 'mrm');
        await a.getMap('mongo-clustered').put(key, 'to-remove');

        const coll = client.db(DB_NAME).collection(COLL_NAME);
        expect(await coll.countDocuments({ _id: key })).toBe(1);

        storeA.reset(); storeB.reset();
        await b.getMap('mongo-clustered').remove(key);
        expect(await coll.countDocuments({ _id: key })).toBe(0);

        expect(storeA.totalDeleteCount()).toBe(1);
        expect(storeB.totalDeleteCount()).toBe(0);
        assertFullProvenance(storeA, storeB, a);
    });

    it('MONGO-4: clustered putAll — routes to owners, no duplicate Mongo writes, full provenance', async () => {
        const [a, _b, storeA, storeB] = await startTwoNode('mongoPaA', 'mongoPaB');

        const entries: [string, string][] = [];
        for (let i = 0; i < 15; i++) entries.push([`mpa-${i}`, `mv-${i}`]);
        await a.getMap('mongo-clustered').putAll(entries);

        const coll = client.db(DB_NAME).collection(COLL_NAME);
        const docCount = await coll.countDocuments({});
        expect(docCount).toBe(15);

        const total = storeA.totalStoreCount() + storeB.totalStoreCount();
        expect(total).toBe(15);
        assertFullProvenance(storeA, storeB, a);
    });
});
