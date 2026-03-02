/**
 * NestJS module for Helios — the primary integration point.
 * Port of {@code com.hazelcast.spring.HazelcastNamespaceHandler} +
 * {@code com.hazelcast.spring.HazelcastInstanceDefinitionParser}.
 *
 * Usage (synchronous):
 *   HeliosModule.forRoot(heliosInstance)
 *
 * Usage (async / factory with imports):
 *   HeliosModule.forRootAsync({
 *       imports: [ConfigModule],
 *       useFactory: async (config: ConfigService) => createInstance(config),
 *       inject: [ConfigService],
 *   })
 *
 * Usage (class-based factory — ConfigurableModuleBuilder pattern):
 *   HeliosModule.forRootAsync({ useClass: MyHeliosFactory })
 *
 * Usage (reuse existing provider):
 *   HeliosModule.forRootAsync({ useExisting: EXISTING_FACTORY_TOKEN })
 */

import {
    DynamicModule,
    FactoryProvider,
    Global,
    Module,
    OnModuleDestroy,
    Optional,
    Provider,
    ValueProvider,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import type { HeliosInstance } from '@helios/core/core/HeliosInstance';
import { HELIOS_INSTANCE_TOKEN } from './HeliosInstanceDefinition';

// ---------------------------------------------------------------------------
// HeliosInstanceFactory — implemented by useClass factory classes
// ---------------------------------------------------------------------------

/**
 * Interface for class-based factories used with `forRootAsync({ useClass })`.
 * Implement this in a `@Injectable()` class and provide it via `useClass`.
 */
export interface HeliosInstanceFactory {
    /** Create (or resolve) the HeliosInstance to register. */
    createHeliosInstance(): HeliosInstance | Promise<HeliosInstance>;
}

/** Internal token for the intermediate factory class provider. */
const HELIOS_INSTANCE_FACTORY_TOKEN = 'HELIOS_INSTANCE_FACTORY';

// ---------------------------------------------------------------------------
// forRootAsync options
// ---------------------------------------------------------------------------

export interface HeliosModuleAsyncOptions {
    /**
     * Modules to import into the forRootAsync dynamic module.
     * These are available to inject into the factory.
     */
    imports?: DynamicModule['imports'];

    /**
     * Factory function that returns (or resolves) a HeliosInstance.
     * Use this when you have a function-based factory.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useFactory?: (...args: any[]) => HeliosInstance | Promise<HeliosInstance>;

    /**
     * Injectable class that implements {@link HeliosInstanceFactory}.
     * NestJS instantiates this class using its own DI and calls
     * `createHeliosInstance()` on the result.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useClass?: new (...args: any[]) => HeliosInstanceFactory;

    /**
     * Token of an existing provider that implements {@link HeliosInstanceFactory}.
     * NestJS resolves the existing instance and calls `createHeliosInstance()` on it.
     */
    useExisting?: string | symbol | (new (...args: unknown[]) => HeliosInstanceFactory);

    /** Tokens to inject into `useFactory`. Not used with `useClass`/`useExisting`. */
    inject?: unknown[];

    /** Additional providers made available inside the forRootAsync module. */
    extraProviders?: Provider[];
}

// ---------------------------------------------------------------------------
// Lifecycle host — shuts down the instance when the module is destroyed
// ---------------------------------------------------------------------------

@Global()
@Module({})
class HeliosModuleLifecycle implements OnModuleDestroy {
    constructor(
        @Optional() @Inject(HELIOS_INSTANCE_TOKEN) private readonly instance: HeliosInstance | null,
    ) {}

    onModuleDestroy(): void {
        this.instance?.shutdown();
    }
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

@Global()
@Module({})
export class HeliosModule {
    /**
     * Register an already-created HeliosInstance synchronously.
     *
     * @param instance  The HeliosInstance to provide.
     */
    static forRoot(instance: HeliosInstance): DynamicModule {
        const provider: ValueProvider = {
            provide: HELIOS_INSTANCE_TOKEN,
            useValue: instance,
        };
        return {
            module: HeliosModule,
            global: true,
            providers: [provider],
            exports: [HELIOS_INSTANCE_TOKEN],
        };
    }

    /**
     * Register a HeliosInstance asynchronously.
     *
     * Supports three patterns:
     * - `useFactory` — function-based (supports `inject` + `imports`)
     * - `useClass` — class-based (NestJS instantiates the class via DI)
     * - `useExisting` — reuse an already-registered factory provider
     */
    static forRootAsync(options: HeliosModuleAsyncOptions): DynamicModule {
        const extraProviders = options.extraProviders ?? [];
        const imports = options.imports ?? [];

        if (options.useClass) {
            return {
                module: HeliosModule,
                global: true,
                imports,
                providers: [
                    ...extraProviders,
                    {
                        provide: HELIOS_INSTANCE_FACTORY_TOKEN,
                        useClass: options.useClass,
                    },
                    {
                        provide: HELIOS_INSTANCE_TOKEN,
                        useFactory: (factory: HeliosInstanceFactory) =>
                            factory.createHeliosInstance(),
                        inject: [HELIOS_INSTANCE_FACTORY_TOKEN],
                    } satisfies FactoryProvider,
                ],
                exports: [HELIOS_INSTANCE_TOKEN],
            };
        }

        if (options.useExisting !== undefined) {
            return {
                module: HeliosModule,
                global: true,
                imports,
                providers: [
                    ...extraProviders,
                    {
                        provide: HELIOS_INSTANCE_TOKEN,
                        useFactory: (factory: HeliosInstanceFactory) =>
                            factory.createHeliosInstance(),
                        inject: [options.useExisting as never],
                    } satisfies FactoryProvider,
                ],
                exports: [HELIOS_INSTANCE_TOKEN],
            };
        }

        // useFactory (default)
        const asyncProvider: FactoryProvider = {
            provide: HELIOS_INSTANCE_TOKEN,
            useFactory: options.useFactory!,
            inject: (options.inject ?? []) as never[],
        };
        return {
            module: HeliosModule,
            global: true,
            imports,
            providers: [
                ...extraProviders,
                asyncProvider,
            ],
            exports: [HELIOS_INSTANCE_TOKEN],
        };
    }
}
