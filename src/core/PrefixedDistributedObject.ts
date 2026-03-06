import type { DistributedObject } from '@zenystx/core/core/DistributedObject';

/**
 * A DistributedObject that has a prefixed name (used by JCache objects).
 * Port of com.hazelcast.core.PrefixedDistributedObject.
 */
export interface PrefixedDistributedObject extends DistributedObject {
  /** Returns the full name including the prefix. */
  getPrefixedName(): string;
}
