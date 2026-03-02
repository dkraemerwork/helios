/**
 * String-based partitioning strategy.
 * Port of com.hazelcast.partition.strategy.StringPartitioningStrategy.
 * Keys can be decorated as "key@partitionKey" to force a specific partition.
 */
export class StringPartitioningStrategy {
  private constructor() {}

  /**
   * Returns the base name (part before first '@'), or null if input is null.
   */
  static getBaseName(key: string | null): string | null {
    if (key === null) return null;
    const idx = key.indexOf('@');
    if (idx < 0) return key;
    return key.substring(0, idx);
  }

  /**
   * Returns the partition key (part after first '@'), or the key itself if no '@'.
   * Returns null if input is null.
   */
  static getPartitionKey(key: string | null): string | null {
    if (key === null) return null;
    const idx = key.indexOf('@');
    if (idx < 0) return key;
    return key.substring(idx + 1);
  }
}
