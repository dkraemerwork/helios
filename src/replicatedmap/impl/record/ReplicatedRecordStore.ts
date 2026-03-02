import type { ReplicatedRecord } from './ReplicatedRecord';
import type { InternalReplicatedMapStorage } from './InternalReplicatedMapStorage';

/**
 * Interface for replicated map record stores.
 * Java source: com.hazelcast.replicatedmap.impl.record.ReplicatedRecordStore
 */
export interface ReplicatedRecordStore {
  getName(): string;
  getPartitionId(): number;
  remove(key: unknown): unknown;
  get(key: unknown): unknown;
  put(key: unknown, value: unknown): unknown;
  put(key: unknown, value: unknown, ttl: number, timeUnit: unknown, incrementHits: boolean): unknown;
  containsKey(key: unknown): boolean;
  containsValue(value: unknown): boolean;
  getReplicatedRecord(key: unknown): ReplicatedRecord<unknown, unknown> | undefined;
  keySet(lazy: boolean): unknown;
  values(lazy: boolean): unknown;
  entrySet(lazy: boolean): unknown;
  size(): number;
  clear(): void;
  reset(): void;
  isEmpty(): boolean;
  unmarshall(key: unknown): unknown;
  marshall(key: unknown): unknown;
  destroy(): void;
  getVersion(): number;
  isStale(version: number): boolean;
  getStorage(): InternalReplicatedMapStorage<unknown, unknown>;
}
