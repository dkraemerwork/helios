/**
 * Port of {@code com.hazelcast.internal.serialization.impl.FactoryIdHelper}.
 *
 * Constants registry for DataSerializable factory IDs.
 * System properties → process.env in Bun/Node.js.
 */
export const FactoryIdHelper = {
    SPI_DS_FACTORY: 'hazelcast.serialization.ds.spi',
    SPI_DS_FACTORY_ID: -1,

    PARTITION_DS_FACTORY: 'hazelcast.serialization.ds.partition',
    PARTITION_DS_FACTORY_ID: -2,

    CLIENT_DS_FACTORY: 'hazelcast.serialization.ds.client',
    CLIENT_DS_FACTORY_ID: -3,

    MAP_DS_FACTORY: 'hazelcast.serialization.ds.map',
    MAP_DS_FACTORY_ID: -4,

    QUEUE_DS_FACTORY: 'hazelcast.serialization.ds.queue',
    QUEUE_DS_FACTORY_ID: -5,

    MULTIMAP_DS_FACTORY: 'hazelcast.serialization.ds.multimap',
    MULTIMAP_DS_FACTORY_ID: -6,

    EXECUTOR_DS_FACTORY: 'hazelcast.serialization.ds.executor',
    EXECUTOR_DS_FACTORY_ID: -7,

    LOCK_DS_FACTORY: 'hazelcast.serialization.ds.lock',
    LOCK_DS_FACTORY_ID: -8,

    TOPIC_DS_FACTORY: 'hazelcast.serialization.ds.topic',
    TOPIC_DS_FACTORY_ID: -9,

    TRANSACTION_DS_FACTORY: 'hazelcast.serialization.ds.transaction',
    TRANSACTION_DS_FACTORY_ID: -10,

    COLLECTION_DS_FACTORY: 'hazelcast.serialization.ds.collection',
    COLLECTION_DS_FACTORY_ID: -11,

    REPLICATED_MAP_DS_FACTORY: 'hazelcast.serialization.ds.replicated_map',
    REPLICATED_MAP_DS_FACTORY_ID: -12,

    CACHE_DS_FACTORY: 'hazelcast.serialization.ds.cache',
    CACHE_DS_FACTORY_ID: -13,

    PREDICATE_DS_FACTORY: 'hazelcast.serialization.ds.predicate',
    PREDICATE_DS_FACTORY_ID: -20,

    RINGBUFFER_DS_FACTORY: 'hazelcast.serialization.ds.ringbuffer',
    RINGBUFFER_DS_FACTORY_ID: -17,

    AGGREGATOR_DS_FACTORY: 'hazelcast.serialization.ds.aggregator',
    AGGREGATOR_DS_FACTORY_ID: -29,

    PROJECTION_DS_FACTORY: 'hazelcast.serialization.ds.projection',
    PROJECTION_DS_FACTORY_ID: -30,

    CONFIG_DS_FACTORY: 'hazelcast.serialization.ds.config',
    CONFIG_DS_FACTORY_ID: -31,

    JSON_DS_FACTORY: 'hazelcast.serialization.json',
    JSON_DS_FACTORY_ID: -39,

    /**
     * Reads the factory ID from process.env[prop]; falls back to {@code defaultId}.
     * Mirrors Java's {@code System.getProperty(prop)}.
     */
    getFactoryId(prop: string, defaultId: number): number {
        const value = process.env[prop];
        if (value != null) {
            const parsed = parseInt(value, 10);
            if (!isNaN(parsed)) return parsed;
        }
        return defaultId;
    },
} as const;
