/**
 * ValueCollectionType enum for MultiMap.
 * Port of com.hazelcast.config.MultiMapConfig.ValueCollectionType.
 */
export enum ValueCollectionType {
    /** Values stored in a Set (no duplicates per key). */
    SET = 'SET',
    /** Values stored in a List (duplicates allowed per key). */
    LIST = 'LIST',
}
