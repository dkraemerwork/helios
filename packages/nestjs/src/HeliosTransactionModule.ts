/**
 * NestJS module for Helios transaction management.
 *
 * Port of the Spring {@code HazelcastTransactionManager} + XML configuration:
 *   <bean id="transactionManager" class="...HazelcastTransactionManager">
 *   <bean id="transactionalContext" class="...ManagedTransactionalTaskContext">
 *
 * Usage:
 *   HeliosTransactionModule.register(myTransactionContextFactory)
 *
 * The factory receives optional {@link TransactionCreateOptions} (timeout) and
 * must return a fresh {@link TransactionContext}. In production, wire it to
 * the HeliosInstance to call instance.newTransactionContext(options).
 */

import { DynamicModule, Global, Module, OnModuleInit } from '@nestjs/common';
import { HeliosTransactionManager, type TransactionContextFactory } from './HeliosTransactionManager';
import { ManagedTransactionalTaskContext } from './ManagedTransactionalTaskContext';

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

@Global()
@Module({})
export class HeliosTransactionModule implements OnModuleInit {
    constructor(private readonly _txMgr: HeliosTransactionManager) {}

    onModuleInit(): void {
        // Register the manager as globally accessible for @Transactional decorator
        HeliosTransactionManager.setCurrent(this._txMgr);
    }

    /**
     * Register the transaction module with a given context factory.
     *
     * @param factory  Factory that creates TransactionContext instances.
     *                 In production: wrap HeliosInstance.newTransactionContext().
     */
    static register(factory: TransactionContextFactory): DynamicModule {
        return {
            module: HeliosTransactionModule,
            global: true,
            providers: [
                {
                    provide: 'HELIOS_TX_FACTORY',
                    useValue: factory,
                },
                {
                    provide: HeliosTransactionManager,
                    useFactory: (f: TransactionContextFactory) => new HeliosTransactionManager(f),
                    inject: ['HELIOS_TX_FACTORY'],
                },
                {
                    provide: ManagedTransactionalTaskContext,
                    useFactory: (mgr: HeliosTransactionManager) => new ManagedTransactionalTaskContext(mgr),
                    inject: [HeliosTransactionManager],
                },
            ],
            exports: [HeliosTransactionManager, ManagedTransactionalTaskContext],
        };
    }
}
