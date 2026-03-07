#!/usr/bin/env bun
/**
 * Helios member worker — runs a single Helios instance in a child process.
 *
 * Receives configuration and commands via IPC (process.send / process.on('message')).
 * Returns results including provenance records for MapStore proof testing.
 *
 * Block 21.4: Enables separate-process clustered MapStore proof with real TCP.
 */
import { Helios } from '@zenystx/helios-core/Helios';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import { MapConfig } from '@zenystx/helios-core/config/MapConfig';
import { InitialLoadMode, MapStoreConfig } from '@zenystx/helios-core/config/MapStoreConfig';
import type { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';
import { MapKeyStream } from '@zenystx/helios-core/map/MapKeyStream';
import type { MapStore } from '@zenystx/helios-core/map/MapStore';
import { RingbufferService } from '@zenystx/helios-core/ringbuffer/impl/RingbufferService';
import { DynamoDbMapStore } from '../../packages/dynamodb/src/DynamoDbMapStore.js';
import { MongoMapStore } from '../../packages/mongodb/src/MongoMapStore.js';

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
            // Access partition epoch via MapContainerService
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
}

class ProvenanceMongoMapStore implements MapStore<string, string> {
    readonly records: ProvenanceRecord[] = [];
    private readonly _memberId: string;
    private readonly _inner: MongoMapStore<string>;
    private _instance: HeliosInstanceImpl | null = null;

    constructor(memberId: string, uri: string, database: string, collection: string) {
        this._memberId = memberId;
        this._inner = new MongoMapStore({ uri, database, collection });
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
        await this._inner.store(key, value);
    }

    async storeAll(entries: Map<string, string>): Promise<void> {
        this._record('storeAll', [...entries.keys()]);
        await this._inner.storeAll(entries);
    }

    async delete(key: string): Promise<void> {
        this._record('delete', [key]);
        await this._inner.delete(key);
    }

    async deleteAll(keys: string[]): Promise<void> {
        this._record('deleteAll', [...keys]);
        await this._inner.deleteAll(keys);
    }

    async load(key: string): Promise<string | null> {
        this._record('load', [key]);
        return this._inner.load(key);
    }

    async loadAll(keys: string[]): Promise<Map<string, string>> {
        this._record('loadAll', [...keys]);
        return this._inner.loadAll(keys);
    }

    async loadAllKeys(): Promise<MapKeyStream<string>> {
        this._record('loadAllKeys', []);
        return this._inner.loadAllKeys();
    }

    async init(properties: Map<string, string>, mapName: string): Promise<void> {
        if (typeof this._inner.init === 'function') {
            await this._inner.init(properties, mapName);
        }
    }

    async destroy(): Promise<void> {
        if (typeof this._inner.destroy === 'function') {
            await this._inner.destroy();
        }
    }

    getData(): Map<string, string> {
        return new Map();
    }
}

class ProvenanceDynamoDbMapStore implements MapStore<string, string> {
    readonly records: ProvenanceRecord[] = [];
    private readonly _memberId: string;
    private readonly _inner: DynamoDbMapStore<string>;
    private _instance: HeliosInstanceImpl | null = null;

    constructor(memberId: string, endpoint: string) {
        this._memberId = memberId;
        this._inner = new DynamoDbMapStore({ endpoint, autoCreateTable: true });
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
        await this._inner.store(key, value);
    }

    async storeAll(entries: Map<string, string>): Promise<void> {
        this._record('storeAll', [...entries.keys()]);
        await this._inner.storeAll(entries);
    }

    async delete(key: string): Promise<void> {
        this._record('delete', [key]);
        await this._inner.delete(key);
    }

    async deleteAll(keys: string[]): Promise<void> {
        this._record('deleteAll', [...keys]);
        await this._inner.deleteAll(keys);
    }

    async load(key: string): Promise<string | null> {
        this._record('load', [key]);
        return this._inner.load(key);
    }

    async loadAll(keys: string[]): Promise<Map<string, string>> {
        this._record('loadAll', [...keys]);
        return this._inner.loadAll(keys);
    }

    async loadAllKeys(): Promise<MapKeyStream<string>> {
        this._record('loadAllKeys', []);
        return this._inner.loadAllKeys();
    }

    async init(properties: Map<string, string>, mapName: string): Promise<void> {
        if (typeof this._inner.init === 'function') {
            await this._inner.init(properties, mapName);
        }
    }

    async destroy(): Promise<void> {
        if (typeof this._inner.destroy === 'function') {
            await this._inner.destroy();
        }
    }

    getData(): Map<string, string> {
        return new Map();
    }
}

// ═══════════════════════════════════════════════════════════
//  IPC message types
// ═══════════════════════════════════════════════════════════

interface StartMessage {
    type: 'start';
    id: string;
    name: string;
    port: number;
    peerPorts: number[];
    mapName: string;
    mapStoreKind?: 'in-memory' | 'mongo' | 'dynamodb';
    writeMode: 'write-through' | 'write-behind';
    writeDelaySeconds?: number;
    writeBatchSize?: number;
    writeCoalescing?: boolean;
    initialLoadMode?: 'EAGER' | 'LAZY';
    seedData?: Record<string, string>;
    mongoUri?: string;
    mongoDatabase?: string;
    mongoCollection?: string;
    dynamoDbEndpoint?: string;
}

interface CommandMessage {
    type: 'command';
    id: string;
    command: 'put' | 'get' | 'remove' | 'putAll' | 'getAll' | 'clear' | 'size' | 'reliableTopicPublish' | 'reliableTopicAddListener' | 'reliableTopicDestroy';
    mapName: string;
    key?: string;
    value?: string;
    entries?: [string, string][];
    keys?: string[];
    topicName?: string;
    message?: string;
}

interface QueryMessage {
    type: 'query';
    id: string;
    query: 'provenance' | 'clusterSize' | 'partitionOwner' | 'partitionId' | 'isRunning' | 'storeData' | 'reliableTopicMessages' | 'reliableTopicState' | 'reliableTopicOwner';
    key?: string;
    topicName?: string;
}

interface ShutdownMessage {
    type: 'shutdown';
    id: string;
}

interface ResetProvenanceMessage {
    type: 'resetProvenance';
    id: string;
}

type WorkerMessage = StartMessage | CommandMessage | QueryMessage | ShutdownMessage | ResetProvenanceMessage;

// ═══════════════════════════════════════════════════════════
//  Worker state
// ═══════════════════════════════════════════════════════════

let instance: HeliosInstanceImpl | null = null;
let store: (ProvenanceMapStore | ProvenanceMongoMapStore | ProvenanceDynamoDbMapStore) | null = null;
const reliableTopicMessages = new Map<string, string[]>();
const reliableTopicRegistrations = new Map<string, string>();

function reply(id: string, result: any, error?: string): void {
    process.send!({ id, result, error });
}

async function handleMessage(msg: WorkerMessage): Promise<void> {
    try {
        switch (msg.type) {
            case 'start': {
                if (msg.mapStoreKind === 'mongo') {
                    if (!msg.mongoUri || !msg.mongoDatabase || !msg.mongoCollection) {
                        throw new Error('Mongo worker requires mongoUri, mongoDatabase, and mongoCollection');
                    }
                    store = new ProvenanceMongoMapStore(msg.name, msg.mongoUri, msg.mongoDatabase, msg.mongoCollection);
                } else if (msg.mapStoreKind === 'dynamodb') {
                    if (!msg.dynamoDbEndpoint) {
                        throw new Error('DynamoDB worker requires dynamoDbEndpoint');
                    }
                    store = new ProvenanceDynamoDbMapStore(msg.name, msg.dynamoDbEndpoint);
                } else {
                    store = new ProvenanceMapStore(msg.name);
                }

                if (msg.seedData && store instanceof ProvenanceMapStore) {
                    for (const [k, v] of Object.entries(msg.seedData)) {
                        store.seed(k, v);
                    }
                }

                const cfg = new HeliosConfig(msg.name);
                cfg.getNetworkConfig()
                    .setPort(msg.port)
                    .getJoin()
                    .getTcpIpConfig()
                    .setEnabled(true);
                for (const pp of msg.peerPorts) {
                    cfg.getNetworkConfig().getJoin().getTcpIpConfig().addMember(`localhost:${pp}`);
                }

                const msCfg = new MapStoreConfig();
                msCfg.setEnabled(true);
                msCfg.setImplementation(store);

                if (msg.writeMode === 'write-behind') {
                    msCfg.setWriteDelaySeconds(msg.writeDelaySeconds ?? 1);
                    if (msg.writeBatchSize !== undefined) msCfg.setWriteBatchSize(msg.writeBatchSize);
                    if (msg.writeCoalescing !== undefined) msCfg.setWriteCoalescing(msg.writeCoalescing);
                }

                if (msg.initialLoadMode === 'EAGER') {
                    msCfg.setInitialLoadMode(InitialLoadMode.EAGER);
                }

                const mc = new MapConfig();
                mc.setName(msg.mapName);
                mc.setMapStoreConfig(msCfg);
                cfg.addMapConfig(mc);

                instance = await Helios.newInstance(cfg);
                store.setInstance(instance);

                reply(msg.id, { name: instance.getName(), port: msg.port });
                break;
            }

            case 'command': {
                if (!instance) { reply(msg.id, null, 'Instance not started'); return; }
                const map = instance.getMap<string, string>(msg.mapName);

                switch (msg.command) {
                    case 'put':
                        await map.put(msg.key!, msg.value!);
                        reply(msg.id, { ok: true });
                        break;
                    case 'get': {
                        const v = await map.get(msg.key!);
                        reply(msg.id, { value: v });
                        break;
                    }
                    case 'remove':
                        await map.remove(msg.key!);
                        reply(msg.id, { ok: true });
                        break;
                    case 'putAll':
                        await map.putAll(msg.entries!);
                        reply(msg.id, { ok: true });
                        break;
                    case 'getAll': {
                        const result = await map.getAll(msg.keys!);
                        reply(msg.id, { entries: [...result.entries()] });
                        break;
                    }
                    case 'clear':
                        await map.clear();
                        reply(msg.id, { ok: true });
                        break;
                    case 'size': {
                        const s = map.size();
                        reply(msg.id, { size: s });
                        break;
                    }
                    case 'reliableTopicPublish': {
                        const topic = instance.getReliableTopic<string>(msg.topicName!);
                        await topic.publishAsync(msg.message!);
                        reply(msg.id, { ok: true });
                        break;
                    }
                    case 'reliableTopicAddListener': {
                        const topicName = msg.topicName!;
                        const topic = instance.getReliableTopic<string>(topicName);
                        if (!reliableTopicMessages.has(topicName)) {
                            reliableTopicMessages.set(topicName, []);
                        }
                        if (!reliableTopicRegistrations.has(topicName)) {
                            const registrationId = topic.addMessageListener((message) => {
                                reliableTopicMessages.get(topicName)!.push(String(message.getMessageObject()));
                            });
                            reliableTopicRegistrations.set(topicName, registrationId);
                        }
                        reply(msg.id, { ok: true });
                        break;
                    }
                    case 'reliableTopicDestroy': {
                        const topic = instance.getReliableTopic<string>(msg.topicName!);
                        topic.destroy();
                        reliableTopicRegistrations.delete(msg.topicName!);
                        reply(msg.id, { ok: true });
                        break;
                    }
                }
                break;
            }

            case 'query': {
                if (!instance) { reply(msg.id, null, 'Instance not started'); return; }

                switch (msg.query) {
                    case 'provenance':
                        reply(msg.id, { records: store!.records });
                        break;
                    case 'clusterSize':
                        reply(msg.id, { size: instance.getCluster().getMembers().length });
                        break;
                    case 'partitionOwner': {
                        const pid = instance.getPartitionIdForName(msg.key!);
                        const owner = instance.getPartitionOwnerId(pid);
                        reply(msg.id, { partitionId: pid, owner });
                        break;
                    }
                    case 'partitionId': {
                        const pid = instance.getPartitionIdForName(msg.key!);
                        reply(msg.id, { partitionId: pid });
                        break;
                    }
                    case 'isRunning':
                        reply(msg.id, { running: instance.isRunning() });
                        break;
                    case 'storeData':
                        reply(msg.id, { data: [...store!.getData().entries()] });
                        break;
                    case 'reliableTopicMessages':
                        reply(msg.id, { messages: [...(reliableTopicMessages.get(msg.topicName!) ?? [])] });
                        break;
                    case 'reliableTopicState': {
                        const rbService = instance.getRingbufferService();
                        const rbName = `_hz_rb_${msg.topicName!}`;
                        const partitionId = rbService.getRingbufferPartitionId(rbName);
                        const ns = RingbufferService.getRingbufferNamespace(rbName);
                        const container = rbService.getContainerOrNull(partitionId, ns);
                        reply(msg.id, {
                            partitionId,
                            size: container?.size() ?? 0,
                            headSequence: container?.headSequence() ?? -1,
                            tailSequence: container?.tailSequence() ?? -1,
                        });
                        break;
                    }
                    case 'reliableTopicOwner': {
                        const rbService = instance.getRingbufferService();
                        const rbName = `_hz_rb_${msg.topicName!}`;
                        const partitionId = rbService.getRingbufferPartitionId(rbName);
                        const owner = instance.getPartitionOwnerId(partitionId);
                        reply(msg.id, { partitionId, owner });
                        break;
                    }
                }
                break;
            }

            case 'resetProvenance':
                if (store) store.records.length = 0;
                reply(msg.id, { ok: true });
                break;

            case 'shutdown':
                if (instance && instance.isRunning()) {
                    instance.shutdown();
                }
                reliableTopicMessages.clear();
                reliableTopicRegistrations.clear();
                reply(msg.id, { ok: true });
                // Give a moment for cleanup then exit
                setTimeout(() => process.exit(0), 100);
                break;
        }
    } catch (err: any) {
        reply(msg.id, null, err.message ?? String(err));
    }
}

process.on('message', (msg: WorkerMessage) => {
    handleMessage(msg).catch(err => {
        reply(msg.id, null, err.message ?? String(err));
    });
});

// Signal ready
process.send!({ type: 'ready' });
