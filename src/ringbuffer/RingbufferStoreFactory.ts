/**
 * Port of {@code com.hazelcast.ringbuffer.RingbufferStoreFactory}.
 * Factory for creating RingbufferStore instances.
 */
import type { RingbufferStore } from './RingbufferStore.js';

export interface RingbufferStoreFactory<T> {
    newRingbufferStore(name: string, properties: Map<string, string>): RingbufferStore<T>;
}
