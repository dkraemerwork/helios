import type { DistributedObject } from '@zenystx/core/core/DistributedObject';
import type { PrefixedDistributedObject } from '@zenystx/core/core/PrefixedDistributedObject';

/**
 * Utility class for DistributedObject name handling.
 * Port of com.hazelcast.core.DistributedObjectUtil.
 */
export class DistributedObjectUtil {
  private constructor() {}

  /**
   * Returns the name of the distributed object. For PrefixedDistributedObject
   * instances (e.g. ICache), returns the prefixed name.
   */
  static getName(obj: DistributedObject): string {
    if (isPrefixed(obj)) {
      return obj.getPrefixedName();
    }
    return obj.getName();
  }
}

function isPrefixed(obj: DistributedObject): obj is PrefixedDistributedObject {
  return typeof (obj as PrefixedDistributedObject).getPrefixedName === 'function';
}
