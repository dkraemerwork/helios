/**
 * Port of {@code com.hazelcast.transaction.TransactionContext}.
 *
 * Represents a transactional context bound to a single transaction lifecycle.
 * Provides access to transactional data structures.
 */

/**
 * Transactional map proxy — minimal interface for transaction-scoped map operations.
 */
export interface TransactionalMap<K, V> {
    put(key: K, value: V): V | undefined;
    get(key: K): V | undefined;
    size(): number;
}

/**
 * Core transaction lifecycle + transactional structure access interface.
 */
export interface TransactionContext {
    beginTransaction(): void;
    commitTransaction(): void;
    rollbackTransaction(): void;
    getMap<K, V>(name: string): TransactionalMap<K, V>;
}
