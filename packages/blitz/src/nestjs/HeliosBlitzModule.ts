import { Module, Global, type DynamicModule, type FactoryProvider, type Provider } from '@nestjs/common';
import { BlitzService } from '../BlitzService.ts';
import { type BlitzConfig } from '../BlitzConfig.ts';
import { HeliosBlitzService } from './HeliosBlitzService.ts';
import { HELIOS_BLITZ_SERVICE_TOKEN } from './InjectBlitz.decorator.ts';
import { FenceAwareBlitzProvider } from './FenceAwareBlitzProvider.ts';

/** Internal token for the raw BlitzConfig object passed to the async factory. */
const BLITZ_CONFIG_TOKEN = 'HELIOS_BLITZ_CONFIG';

/**
 * Options for {@link HeliosBlitzModule.forRootAsync}.
 */
export interface HeliosBlitzModuleAsyncOptions {
    /** Additional providers to make available during factory resolution. */
    extraProviders?: Provider[];
    /** Tokens to inject into `useFactory`. */
    inject?: unknown[];
    /** Additional modules whose providers should be available to the factory. */
    imports?: DynamicModule['imports'];
    /**
     * Factory function that returns a {@link BlitzConfig} (or a Promise of one).
     * The values from `inject` are passed as arguments.
     */
    useFactory: (...args: unknown[]) => BlitzConfig | Promise<BlitzConfig>;
}

/**
 * NestJS module that registers {@link HeliosBlitzService} globally.
 *
 * ### Synchronous registration
 * ```typescript
 * HeliosBlitzModule.forRoot({ servers: 'nats://localhost:4222' })
 * ```
 *
 * ### Asynchronous registration
 * ```typescript
 * HeliosBlitzModule.forRootAsync({
 *   useFactory: async (config: ConfigService) => ({
 *     servers: config.get('NATS_URL'),
 *   }),
 *   inject: [ConfigService],
 * })
 * ```
 */
@Global()
@Module({})
export class HeliosBlitzModule {
    /**
     * Register {@link HeliosBlitzService} synchronously using a static {@link BlitzConfig}.
     */
    static forRoot(config: BlitzConfig): DynamicModule {
        const blitzServiceProvider: FactoryProvider = {
            provide: HELIOS_BLITZ_SERVICE_TOKEN,
            useFactory: async (): Promise<HeliosBlitzService> => {
                const blitz = await BlitzService.connect(config);
                return new HeliosBlitzService(blitz);
            },
        };

        return {
            module: HeliosBlitzModule,
            global: true,
            providers: [blitzServiceProvider],
            exports: [HELIOS_BLITZ_SERVICE_TOKEN],
        };
    }

    /**
     * Register {@link HeliosBlitzService} by reusing an existing Helios-owned
     * {@link BlitzService} instead of creating a parallel unmanaged instance.
     *
     * Use this in `distributed-auto` mode where Helios owns the Blitz
     * lifecycle and the NestJS bridge should share the same NATS connection.
     */
    static forHeliosInstance(provider: FactoryProvider): DynamicModule {
        return {
            module: HeliosBlitzModule,
            global: true,
            providers: [provider],
            exports: [HELIOS_BLITZ_SERVICE_TOKEN],
        };
    }

    /**
     * Register {@link HeliosBlitzService} by reusing an existing Helios-owned
     * {@link BlitzService} with fence-awareness: the service is only accessible
     * after the Block 18.3 pre-cutover readiness fence has cleared.
     *
     * Use this in `distributed-auto` mode to prevent the NestJS bridge from
     * exposing or reusing the Helios-owned Blitz instance before authoritative
     * topology is applied and post-cutover JetStream readiness is green.
     */
    static forHeliosInstanceFenced(options: {
        fenceCheck: () => boolean;
        blitzServiceFactory: () => HeliosBlitzService | null;
    }): DynamicModule {
        const fenceProviderToken = 'HELIOS_BLITZ_FENCE_PROVIDER';
        const fenceProvider: FactoryProvider = {
            provide: fenceProviderToken,
            useFactory: () => new FenceAwareBlitzProvider(options.fenceCheck, options.blitzServiceFactory()),
        };
        const serviceProvider: FactoryProvider = {
            provide: HELIOS_BLITZ_SERVICE_TOKEN,
            useFactory: (fence: FenceAwareBlitzProvider) => fence.getService(),
            inject: [fenceProviderToken],
        };
        return {
            module: HeliosBlitzModule,
            global: true,
            providers: [fenceProvider, serviceProvider],
            exports: [HELIOS_BLITZ_SERVICE_TOKEN],
        };
    }

    /**
     * Register {@link HeliosBlitzService} asynchronously using a factory function.
     * Supports `useFactory` with optional `inject` and `extraProviders`.
     */
    static forRootAsync(options: HeliosBlitzModuleAsyncOptions): DynamicModule {
        const configProvider: FactoryProvider = {
            provide: BLITZ_CONFIG_TOKEN,
            useFactory: options.useFactory,
            inject: (options.inject ?? []) as never[],
        };

        const blitzServiceProvider: FactoryProvider = {
            provide: HELIOS_BLITZ_SERVICE_TOKEN,
            useFactory: async (config: BlitzConfig): Promise<HeliosBlitzService> => {
                const blitz = await BlitzService.connect(config);
                return new HeliosBlitzService(blitz);
            },
            inject: [BLITZ_CONFIG_TOKEN],
        };

        const extraProviders: Provider[] = options.extraProviders ?? [];

        return {
            module: HeliosBlitzModule,
            global: true,
            imports: options.imports ?? [],
            providers: [configProvider, blitzServiceProvider, ...extraProviders],
            exports: [HELIOS_BLITZ_SERVICE_TOKEN],
        };
    }
}
