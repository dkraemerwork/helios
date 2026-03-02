/**
 * NestJS module for Helios — the primary integration point.
 * Port of {@code com.hazelcast.spring.HazelcastNamespaceHandler} +
 * {@code com.hazelcast.spring.HazelcastInstanceDefinitionParser}.
 *
 * Usage (synchronous):
 *   HeliosModule.forRoot(heliosInstance)
 *
 * Usage (asynchronous / factory):
 *   HeliosModule.forRootAsync({ useFactory: async () => createHeliosInstance() })
 */

import { DynamicModule, FactoryProvider, Global, Module, Provider, ValueProvider } from '@nestjs/common';
import type { HeliosInstance } from '@helios/core/HeliosInstance';
import { HELIOS_INSTANCE_TOKEN } from './HeliosInstanceDefinition';

// ---------------------------------------------------------------------------
// forRootAsync options
// ---------------------------------------------------------------------------

export interface HeliosModuleAsyncOptions {
    /** Factory function that returns (or resolves) a HeliosInstance. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useFactory: (...args: any[]) => HeliosInstance | Promise<HeliosInstance>;
    /** Tokens to inject into useFactory. */
    inject?: unknown[];
    /** Additional providers made available inside the forRootAsync module. */
    extraProviders?: Provider[];
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
     * Register a HeliosInstance asynchronously using a factory function.
     *
     * @param options  Async options with useFactory (and optional inject/extraProviders).
     */
    static forRootAsync(options: HeliosModuleAsyncOptions): DynamicModule {
        const asyncProvider: FactoryProvider = {
            provide: HELIOS_INSTANCE_TOKEN,
            useFactory: options.useFactory,
            inject: (options.inject ?? []) as never[],
        };
        return {
            module: HeliosModule,
            global: true,
            providers: [
                ...(options.extraProviders ?? []),
                asyncProvider,
            ],
            exports: [HELIOS_INSTANCE_TOKEN],
        };
    }
}
