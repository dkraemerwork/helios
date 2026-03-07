import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { MongoClient } from 'mongodb';
import { MultiProcessCluster } from '../../../src/test-support/MultiProcessCluster.js';

const MONGO_URI = process.env.HELIOS_MONGODB_TEST_URI;
const SKIP = !MONGO_URI;

const BASE_PORT = 17600;
let portCounter = 0;

function nextPort(): number {
    return BASE_PORT + (portCounter++);
}

interface ProvenanceRecord {
    memberId: string;
    partitionId: number;
    replicaRole: 'PRIMARY' | 'BACKUP' | 'UNKNOWN';
    partitionEpoch: number;
    operationKind: string;
    keys: string[];
    ts: number;
}

function writeRecords(records: ProvenanceRecord[]): ProvenanceRecord[] {
    return records.filter(r =>
        r.operationKind === 'store' || r.operationKind === 'storeAll' ||
        r.operationKind === 'delete' || r.operationKind === 'deleteAll',
    );
}

function totalStoreCount(records: ProvenanceRecord[]): number {
    return records
        .filter(r => r.operationKind === 'store' || r.operationKind === 'storeAll')
        .reduce((n, r) => n + r.keys.length, 0);
}

function totalDeleteCount(records: ProvenanceRecord[]): number {
    return records
        .filter(r => r.operationKind === 'delete' || r.operationKind === 'deleteAll')
        .reduce((n, r) => n + r.keys.length, 0);
}

function assertAllWritesArePrimary(recordsA: ProvenanceRecord[], recordsB: ProvenanceRecord[]): void {
    for (const record of [...writeRecords(recordsA), ...writeRecords(recordsB)]) {
        expect(record.replicaRole).toBe('PRIMARY');
        expect(record.partitionId).toBeGreaterThanOrEqual(0);
        expect(record.partitionEpoch).toBeGreaterThanOrEqual(0);
    }
}

function assertNoDuplicateWrites(recordsA: ProvenanceRecord[], recordsB: ProvenanceRecord[]): void {
    const seen = new Map<string, string>();
    for (const record of [...writeRecords(recordsA), ...writeRecords(recordsB)]) {
        for (const key of record.keys) {
            const prior = seen.get(key);
            if (prior !== undefined && prior !== record.memberId) {
                throw new Error(`Duplicate physical write for key ${key}: ${prior} and ${record.memberId}`);
            }
            seen.set(key, record.memberId);
        }
    }
}

describe('Block 21.4 — MongoDB clustered MapStore proof', () => {
    if (SKIP) {
        it('SKIP: MongoDB not available (set HELIOS_MONGODB_TEST_URI to enable)', () => {
            expect(true).toBe(true);
        });
        return;
    }

    const DATABASE = 'helios_clustered_proof';
    let client: MongoClient;
    let cluster: MultiProcessCluster;

    async function startTwoNode(mapName: string, collection: string): Promise<void> {
        cluster = new MultiProcessCluster();
        const portA = nextPort();
        const portB = nextPort();
        await cluster.startMember({
            name: 'mongoA',
            port: portA,
            peerPorts: [],
            mapName,
            mapStoreKind: 'mongo',
            writeMode: 'write-through',
            mongoUri: MONGO_URI!,
            mongoDatabase: DATABASE,
            mongoCollection: collection,
        });
        await cluster.startMember({
            name: 'mongoB',
            port: portB,
            peerPorts: [portA],
            mapName,
            mapStoreKind: 'mongo',
            writeMode: 'write-through',
            mongoUri: MONGO_URI!,
            mongoDatabase: DATABASE,
            mongoCollection: collection,
        });
        await cluster.waitForClusterSize('mongoA', 2);
        await cluster.waitForClusterSize('mongoB', 2);
    }

    function collectionName(label: string): string {
        return `${label}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    }

    beforeAll(async () => {
        client = new MongoClient(MONGO_URI!);
        await client.connect();
    });

    afterEach(async () => {
        if (cluster) {
            await cluster.shutdownAll();
        }
    });

    afterAll(async () => {
        await client.close();
    });

    it('MONGO-MP-1: clustered put writes to Mongo exactly once from the owner process', async () => {
        const collection = collectionName('mp_put');
        const mapName = 'mongo-clustered-put';
        const coll: any = client.db(DATABASE).collection(collection);
        await startTwoNode(mapName, collection);

        const key = await cluster.findKeyOwnedBy('mongoA', 'mongoA', 'mput');
        await cluster.mapPut('mongoB', mapName, key, 'value-1');

        const recordsA = await cluster.getProvenance('mongoA');
        const recordsB = await cluster.getProvenance('mongoB');
        assertAllWritesArePrimary(recordsA, recordsB);
        assertNoDuplicateWrites(recordsA, recordsB);
        expect(totalStoreCount(recordsA) + totalStoreCount(recordsB)).toBe(1);

        const doc = await coll.findOne({ _id: key });
        expect(doc).not.toBeNull();
        expect(await coll.countDocuments({ _id: key })).toBe(1);
    });

    it('MONGO-MP-2: load-on-miss uses the owner process only', async () => {
        const collection = collectionName('mp_get');
        const mapName = 'mongo-clustered-get';
        const coll: any = client.db(DATABASE).collection(collection);
        await coll.insertOne({ _id: 'preseeded', value: JSON.stringify('ext-value') });
        await startTwoNode(mapName, collection);

        const value = await cluster.mapGet('mongoB', mapName, 'preseeded');
        expect(value).toBe('ext-value');

        const recordsA = await cluster.getProvenance('mongoA');
        const recordsB = await cluster.getProvenance('mongoB');
        const loads = [...recordsA, ...recordsB].filter(r => r.operationKind === 'load');
        expect(loads.length).toBe(1);
        expect(loads[0]!.replicaRole).toBe('PRIMARY');
    });

    it('MONGO-MP-3: clustered clear routes external deletes through one owner process only', async () => {
        const collection = collectionName('mp_clear');
        const mapName = 'mongo-clustered-clear';
        const coll: any = client.db(DATABASE).collection(collection);
        await startTwoNode(mapName, collection);

        for (let i = 0; i < 8; i++) {
            await cluster.mapPut('mongoA', mapName, `clr-${i}`, `v-${i}`);
        }
        await cluster.resetProvenance('mongoA');
        await cluster.resetProvenance('mongoB');

        await cluster.mapClear('mongoB', mapName);

        const recordsA = await cluster.getProvenance('mongoA');
        const recordsB = await cluster.getProvenance('mongoB');
        assertAllWritesArePrimary(recordsA, recordsB);
        assertNoDuplicateWrites(recordsA, recordsB);
        expect(totalDeleteCount(recordsA) + totalDeleteCount(recordsB)).toBeLessThanOrEqual(8);
        expect(await coll.countDocuments({})).toBe(0);
    });

    it('MONGO-MP-4: failover keeps post-promotion writes owner-only and non-duplicated', async () => {
        const collection = collectionName('mp_failover');
        const mapName = 'mongo-clustered-failover';
        const coll: any = client.db(DATABASE).collection(collection);
        await startTwoNode(mapName, collection);

        const key = await cluster.findKeyOwnedBy('mongoA', 'mongoA', 'fail');
        await cluster.mapPut('mongoA', mapName, key, 'before-crash');
        cluster.killMember('mongoA');
        await Bun.sleep(2500);

        await cluster.resetProvenance('mongoB');
        await cluster.mapPut('mongoB', mapName, key, 'after-crash');

        const recordsB = await cluster.getProvenance('mongoB');
        assertAllWritesArePrimary(recordsB, []);
        expect(totalStoreCount(recordsB)).toBe(1);
        expect(await coll.countDocuments({ _id: key })).toBe(1);
    });
});
