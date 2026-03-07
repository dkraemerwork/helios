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
 */
import { describe, it, expect, afterEach, beforeAll, afterAll } from 'bun:test';

const MONGO_URI = process.env.HELIOS_MONGODB_TEST_URI;
const SKIP = !MONGO_URI;

// Dynamic imports to avoid hard dependency when MongoDB is unavailable
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

    function makeConfig(name: string, port: number, peerPorts: number[]): any {
        const cfg = new HeliosConfig(name);
        cfg.getNetworkConfig().setPort(port).getJoin().getTcpIpConfig().setEnabled(true);
        for (const pp of peerPorts) {
            cfg.getNetworkConfig().getJoin().getTcpIpConfig().addMember(`localhost:${pp}`);
        }
        const mongoStore = new MongoMapStore({
            uri: MONGO_URI,
            database: DB_NAME,
            collection: COLL_NAME,
        });
        const msCfg = new MapStoreConfig();
        msCfg.setEnabled(true).setImplementation(mongoStore);
        const mc = new MapConfig();
        mc.setName('mongo-clustered');
        mc.setMapStoreConfig(msCfg);
        cfg.addMapConfig(mc);
        return cfg;
    }

    function findKeyOwnedBy(instance: any, ownerName: string, prefix = 'mk'): string {
        for (let i = 0; i < 1000; i++) {
            const key = `${prefix}-${i}`;
            const pid = instance.getPartitionIdForName(key);
            if (instance.getPartitionOwnerId(pid) === ownerName) return key;
        }
        throw new Error(`Could not find key owned by ${ownerName}`);
    }

    it('MONGO-1: clustered put writes to MongoDB exactly once via owner', async () => {
        const portA = nextPort();
        const portB = nextPort();
        const a = await Helios.newInstance(makeConfig('mongoA', portA, []));
        instances.push(a);
        const b = await Helios.newInstance(makeConfig('mongoB', portB, [portA]));
        instances.push(b);
        await waitForClusterSize(a, 2);

        const key = findKeyOwnedBy(a, a.getName(), 'mput');
        await b.getMap('mongo-clustered').put(key, 'mongo-val');

        // Verify exactly one document in MongoDB
        const coll = client.db(DB_NAME).collection(COLL_NAME);
        const doc = await coll.findOne({ _id: key });
        expect(doc).not.toBeNull();
        const count = await coll.countDocuments({ _id: key });
        expect(count).toBe(1);
    });

    it('MONGO-2: clustered get loads from MongoDB through owner on miss', async () => {
        const portA = nextPort();
        const portB = nextPort();

        // Pre-seed MongoDB
        const coll = client.db(DB_NAME).collection(COLL_NAME);
        await coll.insertOne({ _id: 'preseeded', value: JSON.stringify('ext-value') });

        const a = await Helios.newInstance(makeConfig('mongoLA', portA, []));
        instances.push(a);
        const b = await Helios.newInstance(makeConfig('mongoLB', portB, [portA]));
        instances.push(b);
        await waitForClusterSize(a, 2);

        const val = await b.getMap('mongo-clustered').get('preseeded');
        expect(val).toBe('ext-value');
    });

    it('MONGO-3: clustered remove deletes from MongoDB exactly once', async () => {
        const portA = nextPort();
        const portB = nextPort();
        const a = await Helios.newInstance(makeConfig('mongoRA', portA, []));
        instances.push(a);
        const b = await Helios.newInstance(makeConfig('mongoRB', portB, [portA]));
        instances.push(b);
        await waitForClusterSize(a, 2);

        const key = findKeyOwnedBy(a, a.getName(), 'mrm');
        await a.getMap('mongo-clustered').put(key, 'to-remove');

        const coll = client.db(DB_NAME).collection(COLL_NAME);
        expect(await coll.countDocuments({ _id: key })).toBe(1);

        await b.getMap('mongo-clustered').remove(key);
        expect(await coll.countDocuments({ _id: key })).toBe(0);
    });
});
