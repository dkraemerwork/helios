/**
 * Port of {@code com.hazelcast.spi.properties.ClusterProperty}.
 *
 * Descriptor for a named cluster property with a default value.
 */
export class ClusterProperty {
    /** Total number of partitions in the cluster. */
    static readonly PARTITION_COUNT = new ClusterProperty(
        'hazelcast.partition.count', '271',
    );

    /**
     * Maximum number of items a query may return before throwing
     * {@code QueryResultSizeExceededException}. -1 = disabled.
     */
    static readonly QUERY_RESULT_SIZE_LIMIT = new ClusterProperty(
        'hazelcast.query.result.size.limit', '-1',
    );

    /**
     * Maximum number of local partitions checked in pre-check before sending
     * a query to the whole cluster. -1 = disabled, default = 3.
     */
    static readonly QUERY_MAX_LOCAL_PARTITION_LIMIT_FOR_PRE_CHECK = new ClusterProperty(
        'hazelcast.query.max.local.partition.limit.for.precheck', '3',
    );

    readonly name: string;
    readonly defaultValue: string;

    private constructor(name: string, defaultValue: string) {
        this.name = name;
        this.defaultValue = defaultValue;
    }

    getName(): string { return this.name; }
    getDefaultValue(): string { return this.defaultValue; }

    toString(): string { return this.name; }
}
