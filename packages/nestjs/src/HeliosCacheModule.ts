/**
 * NestJS module for Helios cache integration.
 * Port of {@code com.hazelcast.spring.cache.HazelcastCacheManager}.
 *
 * Wraps @nestjs/cache-manager {@link CacheModule} with an in-process
 * Helios-backed store.  When a HeliosInstance is available in the module
 * context it is used as the backing store; otherwise an in-memory Map is used
 * so the module is always self-contained for testing.
 *
 * Usage (synchronous / standalone):
 *   HeliosCacheModule.register()
 *   HeliosCacheModule.register({ ttl: 30_000, isGlobal: true })
 *
 * Usage (async / factory with imports):
 *   HeliosCacheModule.registerAsync({
 *       imports: [ConfigModule],
 *       useFactory: async (config: ConfigService) => ({
 *           ttl: config.get('CACHE_TTL'),
 *       }),
 *       inject: [ConfigService],
 *   })
 */

import { DynamicModule, Module, type Provider } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { HeliosCache, type IHeliosCacheMap } from './HeliosCache';

// ---------------------------------------------------------------------------
// Module options
// ---------------------------------------------------------------------------

export interface HeliosCacheModuleOptions {
    /** Default TTL in milliseconds (0 = no expiry). */
    ttl?: number;
    /** When true the module is registered as a NestJS global module. */
    isGlobal?: boolean;
    /**
     * Optional backing map.  If omitted an in-process Map is used, which is
     * suitable for single-node deployments and tests.
     */
    store?: IHeliosCacheMap;
}

/** Interface for class-based async factories used with `registerAsync({ useClass })`. */
export interface HeliosCacheModuleOptionsFactory {
    createHeliosCacheOptions(): HeliosCacheModuleOptions | Promise<HeliosCacheModuleOptions>;
}

/** Options for `HeliosCacheModule.registerAsync`. */
export interface HeliosCacheModuleAsyncOptions {
    /** Modules imported into the registerAsync dynamic module (available to inject). */
    imports?: DynamicModule['imports'];
    /** Factory function that returns HeliosCacheModuleOptions. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useFactory?: (...args: any[]) => HeliosCacheModuleOptions | Promise<HeliosCacheModuleOptions>;
    /** Injectable class implementing HeliosCacheModuleOptionsFactory. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useClass?: new (...args: any[]) => HeliosCacheModuleOptionsFactory;
    /** Token of an existing provider implementing HeliosCacheModuleOptionsFactory. */
    useExisting?: string | symbol | (new (...args: unknown[]) => HeliosCacheModuleOptionsFactory);
    /** Tokens to inject into `useFactory`. */
    inject?: unknown[];
    /** Whether to register as a global module. */
    isGlobal?: boolean;
}

// ---------------------------------------------------------------------------
// Default in-process IHeliosCacheMap backed by a plain Map
// ---------------------------------------------------------------------------

function makeInMemoryMap(): IHeliosCacheMap {
    const store = new Map<string, { value: unknown; expiresAt?: number }>();
    return {
        async get(key: string) {
            const entry = store.get(key);
            if (!entry) return undefined;
            if (entry.expiresAt != null && Date.now() > entry.expiresAt) {
                store.delete(key);
                return undefined;
            }
            return entry.value;
        },
        async set(key: string, value: unknown, ttl?: number) {
            store.set(key, {
                value,
                expiresAt: ttl != null && ttl > 0 ? Date.now() + ttl : undefined,
            });
        },
        async delete(key: string) {
            return store.delete(key);
        },
        async clear() {
            store.clear();
        },
        async has(key: string) {
            return store.has(key);
        },
        async keys() {
            return [...store.keys()];
        },
    };
}

/** Build cache module options (store + ttl) from resolved HeliosCacheModuleOptions. */
function buildCacheModuleOpts(opts: HeliosCacheModuleOptions): { stores: never; ttl?: number } {
    const backingMap = opts.store ?? makeInMemoryMap();
    const heliosStore = new HeliosCache(backingMap);
    return { stores: heliosStore as never, ttl: opts.ttl };
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const HELIOS_CACHE_OPTIONS_FACTORY_TOKEN = 'HELIOS_CACHE_OPTIONS_FACTORY';

@Module({})
export class HeliosCacheModule {
    /**
     * Register the Helios cache module synchronously.
     *
     * @param options  Optional configuration options.
     */
    static register(options: HeliosCacheModuleOptions = {}): DynamicModule {
        const { ttl, isGlobal, store } = options;
        const backingMap = store ?? makeInMemoryMap();
        const heliosStore = new HeliosCache(backingMap);

        // Pass the raw KeyvStoreAdapter; @nestjs/cache-manager will wrap it
        // in a Keyv instance internally via its cachingFactory.
        const cacheModule = CacheModule.register({
            stores: heliosStore as never,
            ttl,
            isGlobal: isGlobal ?? false,
        });

        return {
            module: HeliosCacheModule,
            global: isGlobal,
            imports: [cacheModule],
            exports: [cacheModule],
        };
    }

    /**
     * Register the Helios cache module asynchronously.
     *
     * Supports three patterns:
     * - `useFactory` — function-based factory (supports `inject` + `imports`)
     * - `useClass`   — class-based factory (NestJS instantiates via DI)
     * - `useExisting`— reuse an already-registered factory provider
     *
     * @param options  Async registration options.
     */
    static registerAsync(options: HeliosCacheModuleAsyncOptions): DynamicModule {
        const { imports = [], isGlobal } = options;

        // --- build the options provider -----------------------------------------
        let optionsProviders: Provider[];
        let injectTokens: (string | symbol | Function)[];
        let factory: (...args: any[]) => HeliosCacheModuleOptions | Promise<HeliosCacheModuleOptions>;

        if (options.useClass) {
            // Create the factory class as a provider, then inject it
            optionsProviders = [
                { provide: HELIOS_CACHE_OPTIONS_FACTORY_TOKEN, useClass: options.useClass },
            ];
            injectTokens = [HELIOS_CACHE_OPTIONS_FACTORY_TOKEN];
            factory = async (...args: any[]) => {
                const [f] = args as [HeliosCacheModuleOptionsFactory];
                return f.createHeliosCacheOptions();
            };
        } else if (options.useExisting !== undefined) {
            optionsProviders = [];
            injectTokens = [options.useExisting as string | symbol];
            factory = async (...args: any[]) => {
                const [f] = args as [HeliosCacheModuleOptionsFactory];
                return f.createHeliosCacheOptions();
            };
        } else {
            // useFactory (default)
            optionsProviders = [];
            injectTokens = (options.inject ?? []) as (string | symbol | Function)[];
            factory = options.useFactory!;
        }

        // Build an inline module that exports the options factory providers so
        // that CacheModule.registerAsync can inject them.
        let allImports = [...imports];
        if (optionsProviders.length > 0) {
            @Module({
                providers: optionsProviders,
                exports: optionsProviders.map(p =>
                    typeof p === 'object' && 'provide' in p ? p.provide : p,
                ),
            })
            class InlineFactoryModule {}

            allImports = [...allImports, InlineFactoryModule];
        }

        const cacheModule = CacheModule.registerAsync({
            imports: allImports,
            useFactory: async (...args: any[]) => {
                const opts = await factory(...args);
                return buildCacheModuleOpts(opts);
            },
            inject: injectTokens as never[],
        });

        return {
            module: HeliosCacheModule,
            global: isGlobal,
            imports: [cacheModule],
            exports: [cacheModule],
        };
    }
}
