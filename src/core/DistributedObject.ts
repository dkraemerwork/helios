/**
 * Base interface for all distributed objects.
 * Port of com.hazelcast.core.DistributedObject.
 */
export interface DistributedObject {
  getName(): string;
  getServiceName(): string;
  destroy(): Promise<void>;
}
