/**
 * WAN (Wide Area Network) replication configuration.
 *
 * Port of {@code com.hazelcast.config.WanReplicationConfig},
 * {@code com.hazelcast.config.WanBatchPublisherConfig},
 * {@code com.hazelcast.config.WanConsumerConfig},
 * {@code com.hazelcast.config.WanSyncConfig}.
 */

// ── Enumerations ─────────────────────────────────────────────────────────────

export enum WanQueueFullBehavior {
    /** New events are silently discarded when the publisher queue is full. */
    DISCARD_AFTER_MUTATION = 'DISCARD_AFTER_MUTATION',
    /** An exception is thrown when the publisher queue is full. */
    THROW_EXCEPTION = 'THROW_EXCEPTION',
    /**
     * An exception is thrown only when WAN replication is active (publisher connected).
     * If the publisher is disconnected, events are silently discarded.
     */
    THROW_EXCEPTION_ONLY_IF_REPLICATION_ACTIVE = 'THROW_EXCEPTION_ONLY_IF_REPLICATION_ACTIVE',
}

export enum WanAcknowledgeType {
    /** Publisher considers the event complete as soon as the target receives it. */
    ACK_ON_RECEIPT = 'ACK_ON_RECEIPT',
    /** Publisher considers the event complete only when the target has fully processed it. */
    ACK_ON_OPERATION_COMPLETE = 'ACK_ON_OPERATION_COMPLETE',
}

export enum WanConsistencyCheckStrategy {
    /** No consistency check strategy. Anti-entropy is disabled. */
    NONE = 'NONE',
    /** Use Merkle trees to detect and resolve divergence between clusters. */
    MERKLE_TREES = 'MERKLE_TREES',
}

// ── WanSyncConfig ────────────────────────────────────────────────────────────

export class WanSyncConfig {
    private _consistencyCheckStrategy: WanConsistencyCheckStrategy = WanConsistencyCheckStrategy.NONE;

    getConsistencyCheckStrategy(): WanConsistencyCheckStrategy {
        return this._consistencyCheckStrategy;
    }

    setConsistencyCheckStrategy(strategy: WanConsistencyCheckStrategy): this {
        this._consistencyCheckStrategy = strategy;
        return this;
    }
}

// ── WanBatchPublisherConfig ───────────────────────────────────────────────────

export class WanBatchPublisherConfig {
    static readonly DEFAULT_BATCH_SIZE = 500;
    static readonly DEFAULT_BATCH_MAX_DELAY_MILLIS = 1000;
    static readonly DEFAULT_QUEUE_CAPACITY = 10_000;
    static readonly DEFAULT_QUEUE_FULL_BEHAVIOR = WanQueueFullBehavior.DISCARD_AFTER_MUTATION;
    static readonly DEFAULT_ACKNOWLEDGE_TYPE = WanAcknowledgeType.ACK_ON_RECEIPT;

    private _clusterName: string = '';
    private _targetEndpoints: string[] = [];
    private _batchSize: number = WanBatchPublisherConfig.DEFAULT_BATCH_SIZE;
    private _batchMaxDelayMillis: number = WanBatchPublisherConfig.DEFAULT_BATCH_MAX_DELAY_MILLIS;
    private _queueCapacity: number = WanBatchPublisherConfig.DEFAULT_QUEUE_CAPACITY;
    private _queueFullBehavior: WanQueueFullBehavior = WanBatchPublisherConfig.DEFAULT_QUEUE_FULL_BEHAVIOR;
    private _acknowledgeType: WanAcknowledgeType = WanBatchPublisherConfig.DEFAULT_ACKNOWLEDGE_TYPE;
    private _syncConfig: WanSyncConfig = new WanSyncConfig();

    getClusterName(): string {
        return this._clusterName;
    }

    setClusterName(clusterName: string): this {
        this._clusterName = clusterName;
        return this;
    }

    getTargetEndpoints(): string[] {
        return [...this._targetEndpoints];
    }

    setTargetEndpoints(endpoints: string[]): this {
        this._targetEndpoints = [...endpoints];
        return this;
    }

    addTargetEndpoint(endpoint: string): this {
        this._targetEndpoints.push(endpoint);
        return this;
    }

    getBatchSize(): number {
        return this._batchSize;
    }

    setBatchSize(batchSize: number): this {
        if (batchSize <= 0) {
            throw new Error(`batchSize must be > 0, was: ${batchSize}`);
        }
        this._batchSize = batchSize;
        return this;
    }

    getBatchMaxDelayMillis(): number {
        return this._batchMaxDelayMillis;
    }

    setBatchMaxDelayMillis(delayMillis: number): this {
        if (delayMillis < 0) {
            throw new Error(`batchMaxDelayMillis must be >= 0, was: ${delayMillis}`);
        }
        this._batchMaxDelayMillis = delayMillis;
        return this;
    }

    getQueueCapacity(): number {
        return this._queueCapacity;
    }

    setQueueCapacity(capacity: number): this {
        if (capacity <= 0) {
            throw new Error(`queueCapacity must be > 0, was: ${capacity}`);
        }
        this._queueCapacity = capacity;
        return this;
    }

    getQueueFullBehavior(): WanQueueFullBehavior {
        return this._queueFullBehavior;
    }

    setQueueFullBehavior(behavior: WanQueueFullBehavior): this {
        this._queueFullBehavior = behavior;
        return this;
    }

    getAcknowledgeType(): WanAcknowledgeType {
        return this._acknowledgeType;
    }

    setAcknowledgeType(acknowledgeType: WanAcknowledgeType): this {
        this._acknowledgeType = acknowledgeType;
        return this;
    }

    getSyncConfig(): WanSyncConfig {
        return this._syncConfig;
    }

    setSyncConfig(syncConfig: WanSyncConfig): this {
        this._syncConfig = syncConfig;
        return this;
    }
}

// ── WanConsumerConfig ─────────────────────────────────────────────────────────

export class WanConsumerConfig {
    private _persistWanReplicatedData: boolean = false;
    private _mergePolicyClassName: string = 'PassThroughMergePolicy';

    isPersistWanReplicatedData(): boolean {
        return this._persistWanReplicatedData;
    }

    setPersistWanReplicatedData(persist: boolean): this {
        this._persistWanReplicatedData = persist;
        return this;
    }

    getMergePolicyClassName(): string {
        return this._mergePolicyClassName;
    }

    setMergePolicyClassName(className: string): this {
        this._mergePolicyClassName = className;
        return this;
    }
}

// ── WanReplicationConfig ──────────────────────────────────────────────────────

export class WanReplicationConfig {
    private _name: string = '';
    private _batchPublishers: WanBatchPublisherConfig[] = [];
    private _consumerConfig: WanConsumerConfig = new WanConsumerConfig();

    getName(): string {
        return this._name;
    }

    setName(name: string): this {
        this._name = name;
        return this;
    }

    getBatchPublishers(): WanBatchPublisherConfig[] {
        return [...this._batchPublishers];
    }

    setBatchPublishers(publishers: WanBatchPublisherConfig[]): this {
        this._batchPublishers = [...publishers];
        return this;
    }

    addBatchPublisher(publisher: WanBatchPublisherConfig): this {
        this._batchPublishers.push(publisher);
        return this;
    }

    getConsumerConfig(): WanConsumerConfig {
        return this._consumerConfig;
    }

    setConsumerConfig(config: WanConsumerConfig): this {
        this._consumerConfig = config;
        return this;
    }
}
