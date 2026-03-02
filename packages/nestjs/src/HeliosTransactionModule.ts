/**
 * NestJS module for Helios transaction management.
 *
 * Port of the Spring {@code HazelcastTransactionManager} + XML configuration:
 *   <bean id="transactionManager" class="...HazelcastTransactionManager">
 *   <bean id="transactionalContext" class="...ManagedTransactionalTaskContext">
 *
 * Usage (synchronous — factory directly):
 *   HeliosTransactionModule.register(myTransactionContextFactory)
 *
 * Usage (async / factory with imports):
 *   HeliosTransactionModule.registerAsync({
 *       imports: [HeliosModule],
 *       useFactory: (hz: HeliosInstance) => ({
 *           factory: { create: (opts) => hz.newTransactionContext(opts) },
 *       }),
 *       inject: [HELIOS_INSTANCE_TOKEN],
 *   })
 *
 * The factory receives optional {@link TransactionCreateOptions} (timeout) and
 * must return a fresh {@link TransactionContext}. In production, wire it to
 * the HeliosInstance to call instance.newTransactionContext(options).
 */

import { DynamicModule, Global, Module, OnModuleInit, type Provider } from '@nestjs/common';
import { HeliosTransactionManager, type TransactionContextFactory } from './HeliosTransactionManager';
import { ManagedTransactionalTaskContext } from './ManagedTransactionalTaskContext';

// ---------------------------------------------------------------------------
// Module options
// ---------------------------------------------------------------------------

/** Options for `HeliosTransactionModule.registerAsync`. */
export interface HeliosTransactionModuleOptions {
    /** Factory that creates TransactionContext instances. */
    factory: TransactionContextFactory;
    /** Default transaction timeout in seconds (-1 = no timeout). */
    defaultTimeout?: number;
}

/** Interface for class-based async factories used with `registerAsync({ useClass })`. */
export interface HeliosTransactionModuleOptionsFactory {
    createHeliosTransactionOptions():
        | HeliosTransactionModuleOptions
        | Promise<HeliosTransactionModuleOptions>;
}

/** Options for `HeliosTransactionModule.registerAsync`. */
export interface HeliosTransactionModuleAsyncOptions {
    /** Modules imported into the registerAsync dynamic module. */
    imports?: DynamicModule['imports'];
    /** Factory function returning HeliosTransactionModuleOptions. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useFactory?: (
        ...args: any[]
    ) => HeliosTransactionModuleOptions | Promise<HeliosTransactionModuleOptions>;
    /** Injectable class implementing HeliosTransactionModuleOptionsFactory. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useClass?: new (...args: any[]) => HeliosTransactionModuleOptionsFactory;
    /** Token of an existing provider implementing HeliosTransactionModuleOptionsFactory. */
    useExisting?: string | symbol | (new (...args: unknown[]) => HeliosTransactionModuleOptionsFactory);
    /** Tokens to inject into `useFactory`. */
    inject?: unknown[];
}

// ---------------------------------------------------------------------------
// Internal tokens
// ---------------------------------------------------------------------------

const HELIOS_TX_OPTIONS_TOKEN = 'HELIOS_TX_MODULE_OPTIONS';
const HELIOS_TX_OPTIONS_FACTORY_TOKEN = 'HELIOS_TX_MODULE_OPTIONS_FACTORY';

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
                    useFactory: (mgr: HeliosTransactionManager) =>
                        new ManagedTransactionalTaskContext(mgr),
                    inject: [HeliosTransactionManager],
                },
            ],
            exports: [HeliosTransactionManager, ManagedTransactionalTaskContext],
        };
    }

    /**
     * Register the transaction module asynchronously.
     *
     * Supports three patterns:
     * - `useFactory` — function-based factory (supports `inject` + `imports`)
     * - `useClass`   — class-based factory (NestJS instantiates via DI)
     * - `useExisting`— reuse an already-registered factory provider
     *
     * @param options  Async registration options.
     */
    static registerAsync(options: HeliosTransactionModuleAsyncOptions): DynamicModule {
        const { imports = [] } = options;

        // Build the options provider
        let optionsProvider: Provider;
        const extraProviders: Provider[] = [];

        if (options.useClass) {
            extraProviders.push({
                provide: HELIOS_TX_OPTIONS_FACTORY_TOKEN,
                useClass: options.useClass,
            });
            optionsProvider = {
                provide: HELIOS_TX_OPTIONS_TOKEN,
                useFactory: async (f: HeliosTransactionModuleOptionsFactory) =>
                    f.createHeliosTransactionOptions(),
                inject: [HELIOS_TX_OPTIONS_FACTORY_TOKEN],
            };
        } else if (options.useExisting !== undefined) {
            optionsProvider = {
                provide: HELIOS_TX_OPTIONS_TOKEN,
                useFactory: async (f: HeliosTransactionModuleOptionsFactory) =>
                    f.createHeliosTransactionOptions(),
                inject: [options.useExisting as never],
            };
        } else {
            // useFactory (default)
            optionsProvider = {
                provide: HELIOS_TX_OPTIONS_TOKEN,
                useFactory: options.useFactory!,
                inject: (options.inject ?? []) as never[],
            };
        }

        return {
            module: HeliosTransactionModule,
            global: true,
            imports,
            providers: [
                ...extraProviders,
                optionsProvider,
                {
                    provide: HeliosTransactionManager,
                    useFactory: (opts: HeliosTransactionModuleOptions) => {
                        const mgr = new HeliosTransactionManager(opts.factory);
                        if (opts.defaultTimeout !== undefined) {
                            mgr.setDefaultTimeout(opts.defaultTimeout);
                        }
                        return mgr;
                    },
                    inject: [HELIOS_TX_OPTIONS_TOKEN],
                },
                {
                    provide: ManagedTransactionalTaskContext,
                    useFactory: (mgr: HeliosTransactionManager) =>
                        new ManagedTransactionalTaskContext(mgr),
                    inject: [HeliosTransactionManager],
                },
            ],
            exports: [HeliosTransactionManager, ManagedTransactionalTaskContext],
        };
    }
}
