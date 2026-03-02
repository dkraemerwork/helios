/** Index type mirrors Java's com.hazelcast.config.IndexType. */
export enum IndexType {
  HASH = 'HASH',
  SORTED = 'SORTED',
  BITMAP = 'BITMAP',
}

export interface IndexConfig {
  getType(): IndexType;
}

/**
 * Minimal Index interface for predicate use in Phase 1.
 * Full implementation added in later phases with IndexRegistry wiring.
 */
export interface Index {
  getConfig(): IndexConfig;
}
