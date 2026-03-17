/**
 * Port of {@code com.hazelcast.collection.QueueStoreFactory}.
 * Factory for creating QueueStore instances.
 */
import type { QueueStore } from './QueueStore.js';

export interface QueueStoreFactory<T> {
    newQueueStore(name: string, properties: Map<string, string>): QueueStore<T>;
}
