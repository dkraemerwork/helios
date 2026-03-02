/**
 * Port of {@code com.hazelcast.spring.transaction.ManagedTransactionalTaskContext}.
 *
 * Proxies transactional data structure access through the active
 * {@link HeliosTransactionManager}. Useful for declarative \@Transactional
 * usage where the TransactionContext is managed by the framework.
 *
 * Calling any method outside an active transaction will throw
 * {@link NoTransactionException}.
 */

import { Injectable } from '@nestjs/common';
import { HeliosTransactionManager } from '@helios/nestjs/HeliosTransactionManager';
import type { TransactionalMap } from '@helios/transaction/TransactionContext';

@Injectable()
export class ManagedTransactionalTaskContext {
    constructor(private readonly _txMgr: HeliosTransactionManager) {}

    /**
     * Returns a transactional map from the current transaction context.
     * @throws NoTransactionException if no transaction is active.
     */
    getMap<K, V>(name: string): TransactionalMap<K, V> {
        return this._txMgr.getTransactionContext().getMap<K, V>(name);
    }
}
