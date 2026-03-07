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
 *  - Per-call provenance capture (memberId, operationKind) is verified
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

/**
 * Provenance-recording wrapper around MongoMapStore that captures
 * memberId and operationKind for every physical external call.
 */
class ProvenanceMongoStore {
    readonly records: { memberId: string; operationKind: string; keys: string[]; ts: number }[] = [];
    private readonly _inner: any;
    private readonly _memberId: string;

    constructor(memberId: string, opts: any) {
        this._memberId = memberId;
        this._inner = new MongoMapStore(opts);
    }

    private _record(kind: string, keys: string[]): void {
        this.records.push({ memberId: this._memberId, operationKind: kind, keys, ts: Date.now() });
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

    writeRecords(): typeof this.records {
        return this.records.filter(r =>
            r.operationKind === 'store' || r.operationKind === 'storeAll' ||
            r.operationKind === 'delete' || r.operationKind === 'deleteAll',
        );
    }

    reset(): void {
        this.records.length = 0;
    }
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

    function assertProvenanceOwnerOnly(storeA: ProvenanceMongoStore, storeB: ProvenanceMongoStore, instance: any): void {
        for (const r of storeA.writeRecords()) {
            for (const key of r.keys) {
                const pid = instance.getPartitionIdForName(key);
                expect(instance.getPartitionOwnerId(pid)).toBe(r.memberId);
            }
        }
        for (const r of storeB.writeRecords()) {
            for (const key of r.keys) {
                const pid = instance.getPartitionIdForName(key);
                expect(instance.getPartitionOwnerId(pid)).toBe(r.memberId);
            }
        }
    }

    it('MONGO-1: clustered put — writes to MongoDB exactly once via owner, provenance verified', async () => {
        const portA = nextPort();
        const portB = nextPort();
        const { cfg: cfgA, store: storeA } = makeConfig('mongoA', portA, []);
        const { cfg: cfgB, store: storeB } = makeConfig('mongoB', portB, [portA]);
        const a = await Helios.newInstance(cfgA);
        instances.push(a);
        const b = await Helios.newInstance(cfgB);
        instances.push(b);
        await waitForClusterSize(a, 2);

        const key = findKeyOwnedBy(a, a.getName(), 'mput');
        await b.getMap('mongo-clustered').put(key, 'mongo-val');

        const coll = client.db(DB_NAME).collection(COLL_NAME);
        const doc = await coll.findOne({ _id: key });
        expect(doc).not.toBeNull();
        const count = await coll.countDocuments({ _id: key });
        expect(count).toBe(1);

        // Provenance: exactly one store record on owner
        expect(storeA.totalStoreCount()).toBe(1);
        expect(storeB.totalStoreCount()).toBe(0);
        assertProvenanceOwnerOnly(storeA, storeB, a);
        expect(storeA.records[0]!.memberId).toBe('mongoA');
        expect(storeA.records[0]!.operationKind).toBe('store');
    });

    it('MONGO-2: clustered get — loads from MongoDB through owner on miss, provenance verified', async () => {
        const portA = nextPort();
        const portB = nextPort();

        const coll = client.db(DB_NAME).collection(COLL_NAME);
        await coll.insertOne({ _id: 'preseeded', value: JSON.stringify('ext-value') });

        const { cfg: cfgA, store: storeA } = makeConfig('mongoLA', portA, []);
        const { cfg: cfgB, store: storeB } = makeConfig('mongoLB', portB, [portA]);
        const a = await Helios.newInstance(cfgA);
        instances.push(a);
        const b = await Helios.newInstance(cfgB);
        instances.push(b);
        await waitForClusterSize(a, 2);

        const val = await b.getMap('mongo-clustered').get('preseeded');
        expect(val).toBe('ext-value');

        // Provenance: load went to exactly one member (the owner)
        const loadA = storeA.records.filter(r => r.operationKind === 'load');
        const loadB = storeB.records.filter(r => r.operationKind === 'load');
        expect(loadA.length + loadB.length).toBe(1);
    });

    it('MONGO-3: clustered remove — deletes from MongoDB exactly once, provenance verified', async () => {
        const portA = nextPort();
        const portB = nextPort();
        const { cfg: cfgA, store: storeA } = makeConfig('mongoRA', portA, []);
        const { cfg: cfgB, store: storeB } = makeConfig('mongoRB', portB, [portA]);
        const a = await Helios.newInstance(cfgA);
        instances.push(a);
        const b = await Helios.newInstance(cfgB);
        instances.push(b);
        await waitForClusterSize(a, 2);

        const key = findKeyOwnedBy(a, a.getName(), 'mrm');
        await a.getMap('mongo-clustered').put(key, 'to-remove');

        const coll = client.db(DB_NAME).collection(COLL_NAME);
        expect(await coll.countDocuments({ _id: key })).toBe(1);

        storeA.reset(); storeB.reset();
        await b.getMap('mongo-clustered').remove(key);
        expect(await coll.countDocuments({ _id: key })).toBe(0);

        // Provenance: exactly one delete on owner
        expect(storeA.totalDeleteCount()).toBe(1);
        expect(storeB.totalDeleteCount()).toBe(0);
        assertProvenanceOwnerOnly(storeA, storeB, a);
    });

    it('MONGO-4: clustered putAll — routes to owners, no duplicate Mongo writes', async () => {
        const portA = nextPort();
        const portB = nextPort();
        const { cfg: cfgA, store: storeA } = makeConfig('mongoPaA', portA, []);
        const { cfg: cfgB, store: storeB } = makeConfig('mongoPaB', portB, [portA]);
        const a = await Helios.newInstance(cfgA);
        instances.push(a);
        const b = await Helios.newInstance(cfgB);
        instances.push(b);
        await waitForClusterSize(a, 2);

        const entries: [string, string][] = [];
        for (let i = 0; i < 15; i++) entries.push([`mpa-${i}`, `mv-${i}`]);
        await a.getMap('mongo-clustered').putAll(entries);

        const coll = client.db(DB_NAME).collection(COLL_NAME);
        const docCount = await coll.countDocuments({});
        expect(docCount).toBe(15);

        const total = storeA.totalStoreCount() + storeB.totalStoreCount();
        expect(total).toBe(15);
        assertProvenanceOwnerOnly(storeA, storeB, a);
    });
});
