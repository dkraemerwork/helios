/**
 * Thrown when a write-behind queue exceeds its maximum configured capacity.
 * Mirrors Hazelcast's com.hazelcast.map.ReachedMaxSizeException.
 */
export class ReachedMaxSizeException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReachedMaxSizeException';
  }
}
