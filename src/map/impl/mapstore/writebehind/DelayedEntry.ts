export const enum DelayedEntryType {
  ADD = 'ADD',
  DELETE = 'DELETE',
}

export interface DelayedEntry<K, V> {
  readonly type: DelayedEntryType;
  readonly key: K;
  readonly value: V | null; // null for DELETE
  readonly storeTime: number; // Date.now() + writeDelayMs — deadline for flush
  readonly sequence: number; // monotonic counter for ordering
}

let _seq = 0;

export function addedEntry<K, V>(key: K, value: V, storeTime: number): DelayedEntry<K, V> {
  return { type: DelayedEntryType.ADD, key, value, storeTime, sequence: ++_seq };
}

export function deletedEntry<K, V>(key: K, storeTime: number): DelayedEntry<K, V> {
  return { type: DelayedEntryType.DELETE, key, value: null, storeTime, sequence: ++_seq };
}
