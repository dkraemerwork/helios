/**
 * WAN consumer service — receives incoming WAN event batches from a remote
 * cluster and applies them to the local map stores using a merge policy.
 *
 * Port of {@code com.hazelcast.wan.impl.WanEventConsumerService}.
 */
import type { WanReplicationEventBatchMsg } from '@zenystx/helios-core/cluster/tcp/ClusterMessage.js';
import type { WanConsumerConfig } from '@zenystx/helios-core/config/WanReplicationConfig.js';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data.js';
import { HeapData } from '@zenystx/helios-core/internal/serialization/impl/HeapData.js';
import type { MapContainerService } from '@zenystx/helios-core/map/impl/MapContainerService.js';
import type { MergePolicyProvider } from '@zenystx/helios-core/spi/merge/MergePolicyProvider.js';
import type { SplitBrainMergeData } from '@zenystx/helios-core/spi/merge/MergingValue.js';

// ── SplitBrainMergeData adapter for WAN events ────────────────────────────────

class WanMergeData implements SplitBrainMergeData {
    private readonly _key: Data;
    private readonly _value: Data | null;

    constructor(key: Data, value: Data | null) {
        this._key = key;
        this._value = value;
    }

    getKey(): Data { return this._key; }
    getDeserializedKey<K>(): K { return this._key as unknown as K; }
    getValue(): Data | null { return this._value; }
    getDeserializedValue<V>(): V | null { return this._value as unknown as V | null; }
    getHits(): number { return 0; }
    getCreationTime(): number { return Date.now(); }
    getLastAccessTime(): number { return Date.now(); }
    getLastUpdateTime(): number { return Date.now(); }
    getExpirationTime(): number { return 0; }
    getVersion(): number { return 0; }
}

// ── WanConsumerService ─────────────────────────────────────────────────────────

export class WanConsumerService {
    private readonly _config: WanConsumerConfig;
    private readonly _mergePolicyProvider: MergePolicyProvider;
    private _mapContainerService: MapContainerService | null = null;

    constructor(config: WanConsumerConfig, mergePolicyProvider: MergePolicyProvider) {
        this._config = config;
        this._mergePolicyProvider = mergePolicyProvider;
    }

    /**
     * Set the map container service used to access local record stores.
     * Must be called before processing any batches.
     */
    setMapContainerService(service: MapContainerService): void {
        this._mapContainerService = service;
    }

    /**
     * Handle an incoming WAN event batch from a remote cluster.
     * Each event is applied to the local map using the configured merge policy.
     */
    handleIncomingBatch(batch: WanReplicationEventBatchMsg): void {
        if (this._mapContainerService === null) {
            return;
        }
        const mergePolicy = this._mergePolicyProvider.getMergePolicy(
            this._config.getMergePolicyClassName(),
        );

        for (const event of batch.events) {
            switch (event.eventType) {
                case 'PUT': {
                    if (event.keyData === null || event.valueData === null) {
                        break;
                    }
                    const keyData = new HeapData(event.keyData);
                    const incomingValueData = new HeapData(event.valueData);
                    this._applyPutWithMerge(
                        event.mapName,
                        keyData,
                        incomingValueData,
                        mergePolicy,
                        event.ttl,
                    );
                    break;
                }
                case 'REMOVE': {
                    if (event.keyData === null) {
                        break;
                    }
                    const keyData = new HeapData(event.keyData);
                    this._applyRemove(event.mapName, keyData);
                    break;
                }
                case 'CLEAR': {
                    this._applyClear(event.mapName);
                    break;
                }
            }
        }
    }

    /**
     * Apply a PUT event using the configured merge policy.
     * The merge policy decides whether to overwrite the existing value.
     */
    private _applyPutWithMerge(
        mapName: string,
        key: Data,
        incomingValue: Data,
        mergePolicy: import('@zenystx/helios-core/spi/merge/SplitBrainMergePolicy.js').SplitBrainMergePolicy,
        ttl: number,
    ): void {
        if (this._mapContainerService === null) return;

        // Use partition 0 as a fallback; in production, partitionId would be
        // derived from the key hash, but WAN events don't carry partition context
        const partitionId = this._getPartitionIdForKey(key);
        const recordStore = this._mapContainerService.getOrCreateRecordStore(mapName, partitionId);

        const existingData = recordStore.get(key);
        const existingMergeData: SplitBrainMergeData | null = existingData !== null
            ? new WanMergeData(key, existingData)
            : null;
        const incomingMergeData = new WanMergeData(key, incomingValue);

        const result = mergePolicy.merge(incomingMergeData, existingMergeData);
        if (result !== null) {
            const valueToStore = result.getValue();
            if (valueToStore !== null) {
                recordStore.put(key, valueToStore, ttl, 0);
            }
        }
    }

    private _applyRemove(mapName: string, key: Data): void {
        if (this._mapContainerService === null) return;
        const partitionId = this._getPartitionIdForKey(key);
        const recordStore = this._mapContainerService.getOrCreateRecordStore(mapName, partitionId);
        recordStore.remove(key);
    }

    private _applyClear(mapName: string): void {
        if (this._mapContainerService === null) return;
        // Clear across all known partitions for this map
        for (let pid = 0; pid < 271; pid++) {
            const store = this._mapContainerService.getOrCreateRecordStore(mapName, pid);
            if (store.size() > 0) {
                store.clear();
            }
        }
    }

    private _getPartitionIdForKey(key: Data): number {
        const hash = key.getPartitionHash();
        const mod = hash % 271;
        return mod < 0 ? mod + 271 : mod;
    }
}
