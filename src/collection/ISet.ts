import type { ICollection } from './ICollection';

/**
 * Distributed set interface.
 * Port of com.hazelcast.collection.ISet.
 */
export interface ISet<E> extends ICollection<E> {
    // ISet adds no extra methods over ICollection in the basic API.
}
