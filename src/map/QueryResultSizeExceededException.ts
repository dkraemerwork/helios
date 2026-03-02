/**
 * Port of {@code com.hazelcast.map.QueryResultSizeExceededException}.
 *
 * Thrown when a query exceeds the configured result size limit.
 * @see ClusterProperty.QUERY_RESULT_SIZE_LIMIT
 */
export class QueryResultSizeExceededException extends Error {
    static readonly DEFAULT_MESSAGE =
        'This exception has been thrown to prevent an OOME on this Helios instance.' +
        ' An OOME might occur when a query collects large data sets from the whole cluster,' +
        ' e.g. by calling IMap.values(), IMap.keySet() or IMap.entrySet().' +
        ' See ClusterProperty.QUERY_RESULT_SIZE_LIMIT for further details.';

    constructor(messageOrLimit?: string | number, optionalMessage?: string) {
        if (typeof messageOrLimit === 'number') {
            super(
                `This exception has been thrown to prevent an OOME on this Helios instance.` +
                ` An OOME might occur when a query collects large data sets from the whole cluster,` +
                ` e.g. by calling IMap.values(), IMap.keySet() or IMap.entrySet().` +
                ` See ClusterProperty.QUERY_RESULT_SIZE_LIMIT for further details.` +
                ` The configured query result size limit is ${messageOrLimit} items.${optionalMessage ?? ''}`,
            );
        } else {
            super(messageOrLimit ?? QueryResultSizeExceededException.DEFAULT_MESSAGE);
        }
        this.name = 'QueryResultSizeExceededException';
    }
}
