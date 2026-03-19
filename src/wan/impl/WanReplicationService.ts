/**
 * Top-level WAN replication service.
 *
 * Orchestrates WAN publishers, consumers, and sync managers.
 * Exposes a publishMapEvent() hook called by map operation code, and routes
 * incoming WAN cluster messages to the consumer.
 *
 * Port of {@code com.hazelcast.wan.impl.WanReplicationService}.
 */
import type { ClusterMessage } from '@zenystx/helios-core/cluster/tcp/ClusterMessage.js';
import type { WanReplicationConfig } from '@zenystx/helios-core/config/WanReplicationConfig.js';
import type { MapConfig } from '@zenystx/helios-core/config/MapConfig.js';
import type { MapContainerService } from '@zenystx/helios-core/map/impl/MapContainerService.js';
import { MergePolicyProvider } from '@zenystx/helios-core/spi/merge/MergePolicyProvider.js';
import { WanBatchPublisher, WanPublisherState } from '@zenystx/helios-core/wan/impl/WanBatchPublisher.js';
import { WanConsumerService } from '@zenystx/helios-core/wan/impl/WanConsumer.js';
import { WanSyncManager } from '@zenystx/helios-core/wan/impl/WanSyncManager.js';
import { MerkleTree } from '@zenystx/helios-core/wan/impl/MerkleTree.js';
import type { WanReplicationEvent } from '@zenystx/helios-core/wan/WanReplicationEvent.js';

export interface WanPublisherStatus {
    configName: string;
    publisherIndex: number;
    targetClusterName: string;
    state: WanPublisherState;
    queueSize: number;
}

export class WanReplicationService {
    static readonly SERVICE_NAME = 'hz:wan:replicationService';

    /** config name → list of publishers (one per batch-publisher config entry) */
    private readonly _publishers = new Map<string, WanBatchPublisher[]>();
    /** config name → consumer service */
    private readonly _consumers = new Map<string, WanConsumerService>();
    /** config name → sync manager (one per WAN config, shares a single publisher) */
    private readonly _syncManagers = new Map<string, WanSyncManager>();
    /** Shared Merkle tree — one per WAN service instance */
    private readonly _merkleTree: MerkleTree;
    /** map name → WAN config name (populated from MapConfig.wanReplicationRef) */
    private readonly _mapToWanConfig = new Map<string, string>();

    private readonly _wanConfigs: Map<string, WanReplicationConfig>;
    private readonly _sourceClusterName: string;
    private readonly _mergePolicyProvider = new MergePolicyProvider();
    private _mapContainerService: MapContainerService | null = null;

    constructor(
        wanConfigs: Map<string, WanReplicationConfig>,
        sourceClusterName: string,
    ) {
        this._wanConfigs = wanConfigs;
        this._sourceClusterName = sourceClusterName;
        this._merkleTree = new MerkleTree(8);
    }

    /**
     * Set the map container service for record store access.
     * Must be called before init().
     */
    setMapContainerService(service: MapContainerService): void {
        this._mapContainerService = service;
        for (const consumer of this._consumers.values()) {
            consumer.setMapContainerService(service);
        }
        for (const syncMgr of this._syncManagers.values()) {
            syncMgr.setMapContainerService(service);
        }
    }

    /**
     * Register WAN replication references from map configurations.
     * Called during instance startup for each configured map.
     */
    registerMapConfig(mapConfig: MapConfig): void {
        const ref = mapConfig.getWanReplicationRef();
        if (ref === null) return;
        const mapName = mapConfig.getName();
        if (mapName === null) return;
        this._mapToWanConfig.set(mapName, ref.getName());
    }

    /**
     * Initialize all publishers and consumers from the WAN replication configs.
     */
    init(): void {
        for (const [configName, wanConfig] of this._wanConfigs) {
            // Create publishers
            const publishers: WanBatchPublisher[] = [];
            for (const publisherConfig of wanConfig.getBatchPublishers()) {
                const publisher = new WanBatchPublisher(publisherConfig, this._sourceClusterName);
                publishers.push(publisher);
            }
            this._publishers.set(configName, publishers);

            // Create consumer
            const consumer = new WanConsumerService(
                wanConfig.getConsumerConfig(),
                this._mergePolicyProvider,
            );
            if (this._mapContainerService !== null) {
                consumer.setMapContainerService(this._mapContainerService);
            }
            this._consumers.set(configName, consumer);

            // Create sync manager using the first publisher for this config
            if (publishers.length > 0) {
                const syncMgr = new WanSyncManager(this._merkleTree, publishers[0]);
                if (this._mapContainerService !== null) {
                    syncMgr.setMapContainerService(this._mapContainerService);
                }
                this._syncManagers.set(configName, syncMgr);
            }

            // Start all publishers
            for (const publisher of publishers) {
                publisher.start();
            }
        }
    }

    /**
     * Publish a map mutation event to all WAN publishers that reference the given map.
     * Only called on the primary replica (replicaIndex === 0).
     */
    publishMapEvent(
        mapName: string,
        eventType: 'PUT' | 'REMOVE' | 'CLEAR',
        key: Buffer | null,
        value: Buffer | null,
        ttl: number,
    ): void {
        const configName = this._mapToWanConfig.get(mapName);
        if (configName === undefined) {
            return;
        }
        const publishers = this._publishers.get(configName);
        if (publishers === undefined || publishers.length === 0) {
            return;
        }
        const event: WanReplicationEvent = {
            mapName,
            eventType,
            key,
            value,
            ttl,
            timestamp: Date.now(),
        };
        for (const publisher of publishers) {
            publisher.publishEvent(event);
        }
    }

    // ── Management operations ─────────────────────────────────────────────────

    /**
     * Pause all publishers for a named WAN replication config.
     */
    pauseReplication(configName: string): void {
        const publishers = this._publishers.get(configName);
        if (publishers === undefined) {
            throw new Error(`No WAN replication config found: '${configName}'`);
        }
        for (const publisher of publishers) {
            publisher.pause();
        }
    }

    /**
     * Resume all publishers for a named WAN replication config.
     */
    resumeReplication(configName: string): void {
        const publishers = this._publishers.get(configName);
        if (publishers === undefined) {
            throw new Error(`No WAN replication config found: '${configName}'`);
        }
        for (const publisher of publishers) {
            publisher.resume();
        }
    }

    /**
     * Stop all publishers for a named WAN replication config.
     */
    stopReplication(configName: string): void {
        const publishers = this._publishers.get(configName);
        if (publishers === undefined) {
            throw new Error(`No WAN replication config found: '${configName}'`);
        }
        for (const publisher of publishers) {
            publisher.stop();
        }
    }

    /**
     * Returns the status of all publishers for a named WAN replication config.
     */
    getStatus(configName: string): WanPublisherStatus[] {
        const publishers = this._publishers.get(configName);
        if (publishers === undefined) {
            return [];
        }
        return publishers.map((publisher, idx) => ({
            configName,
            publisherIndex: idx,
            targetClusterName: this._wanConfigs.get(configName)?.getBatchPublishers()[idx]?.getClusterName() ?? '',
            state: publisher.getState(),
            queueSize: publisher.eventQueue.size(),
        }));
    }

    /**
     * Trigger a full sync for a map via the WAN publisher.
     */
    async triggerSync(configName: string, mapName: string): Promise<void> {
        const syncMgr = this._syncManagers.get(configName);
        if (syncMgr === undefined) {
            throw new Error(`No WAN sync manager for config: '${configName}'`);
        }
        await syncMgr.requestFullSync(mapName);
    }

    /**
     * Handle an incoming WAN cluster message — routes to the appropriate consumer.
     */
    handleIncomingMessage(msg: ClusterMessage): boolean {
        switch (msg.type) {
            case 'WAN_REPLICATION_EVENT_BATCH': {
                // Route to all consumers (in practice, route by source cluster name)
                for (const consumer of this._consumers.values()) {
                    consumer.handleIncomingBatch(msg);
                }
                return true;
            }
            case 'WAN_CONSISTENCY_CHECK_REQUEST': {
                const syncMgr = this._syncManagers.values().next().value as WanSyncManager | undefined;
                if (syncMgr !== undefined) {
                    syncMgr.handleConsistencyCheckRequest(msg);
                }
                return true;
            }
            case 'WAN_SYNC_REQUEST':
            case 'WAN_SYNC_RESPONSE':
            case 'WAN_REPLICATION_ACK':
            case 'WAN_CONSISTENCY_CHECK_RESPONSE':
                return true;
            default:
                return false;
        }
    }

    /**
     * Shut down all publishers gracefully.
     */
    shutdown(): void {
        for (const publishers of this._publishers.values()) {
            for (const publisher of publishers) {
                publisher.stop();
            }
        }
        this._publishers.clear();
        this._consumers.clear();
        this._syncManagers.clear();
    }

    /**
     * Returns the names of all registered WAN replication configs.
     */
    getConfigNames(): string[] {
        return [...this._wanConfigs.keys()];
    }
}
