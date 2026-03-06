/**
 * NestJS module that exposes distributed Helios objects as injectable providers.
 * Port of {@code com.hazelcast.spring.HazelcastObjectExtractionConfiguration}.
 *
 * Import this module alongside {@link HeliosModule} to access named distributed
 * objects (IMap, ITopic, etc.) by name through NestJS injection.
 *
 * Two registration styles are supported:
 *
 * 1. **Token map** (explicit token → name):
 *    ```typescript
 *    HeliosObjectExtractionModule.forRoot({ maps: { MY_MAP_TOKEN: 'myMap' } })
 *    // inject with: @Inject('MY_MAP_TOKEN')
 *    ```
 *
 * 2. **Named list** (auto-generates tokens via getMapToken/getQueueToken/…):
 *    ```typescript
 *    HeliosObjectExtractionModule.forRoot({ namedMaps: ['users', 'orders'] })
 *    // inject with: @InjectMap('users')
 *    ```
 */

import { DynamicModule, Module, Provider } from '@nestjs/common';
import { HELIOS_INSTANCE_TOKEN } from './HeliosInstanceDefinition';
import {
    getMapToken,
    getQueueToken,
    getTopicToken,
    getListToken,
    getSetToken,
    getMultiMapToken,
    getReplicatedMapToken,
} from './decorators/inject-distributed-object.decorator';
import type { HeliosInstance } from '@zenystx/helios-core/core/HeliosInstance';

export interface HeliosObjectExtractionOptions {
    /** Named map token registrations: token → map name (explicit token style). */
    maps?: Record<string, string>;

    /** Map names to register using auto-generated tokens (decorator style). */
    namedMaps?: string[];
    /** Queue names to register using auto-generated tokens (decorator style). */
    namedQueues?: string[];
    /** Topic names to register using auto-generated tokens (decorator style). */
    namedTopics?: string[];
    /** List names to register using auto-generated tokens (decorator style). */
    namedLists?: string[];
    /** Set names to register using auto-generated tokens (decorator style). */
    namedSets?: string[];
    /** MultiMap names to register using auto-generated tokens (decorator style). */
    namedMultiMaps?: string[];
    /** ReplicatedMap names to register using auto-generated tokens (decorator style). */
    namedReplicatedMaps?: string[];
}

type HzRecord = Record<string, (n: string) => unknown>;

@Module({})
export class HeliosObjectExtractionModule {
    /**
     * Register distributed-object providers extracted from the HeliosInstance.
     *
     * @param options  Which distributed objects to expose as providers.
     */
    static forRoot(options: HeliosObjectExtractionOptions = {}): DynamicModule {
        const providers: Provider[] = [];

        // ── Explicit token map (legacy / flexible style) ───────────────────
        for (const [token, name] of Object.entries(options.maps ?? {})) {
            providers.push({
                provide: token,
                useFactory: (hz: HeliosInstance) =>
                    (hz as unknown as HzRecord)['getMap']?.(name),
                inject: [HELIOS_INSTANCE_TOKEN],
            });
        }

        // ── Named auto-token helpers (decorator style) ─────────────────────
        for (const name of options.namedMaps ?? []) {
            providers.push({
                provide: getMapToken(name),
                useFactory: (hz: HeliosInstance) => hz.getMap(name),
                inject: [HELIOS_INSTANCE_TOKEN],
            });
        }

        for (const name of options.namedQueues ?? []) {
            providers.push({
                provide: getQueueToken(name),
                useFactory: (hz: HeliosInstance) => hz.getQueue(name),
                inject: [HELIOS_INSTANCE_TOKEN],
            });
        }

        for (const name of options.namedTopics ?? []) {
            providers.push({
                provide: getTopicToken(name),
                useFactory: (hz: HeliosInstance) => hz.getTopic(name),
                inject: [HELIOS_INSTANCE_TOKEN],
            });
        }

        for (const name of options.namedLists ?? []) {
            providers.push({
                provide: getListToken(name),
                useFactory: (hz: HeliosInstance) => hz.getList(name),
                inject: [HELIOS_INSTANCE_TOKEN],
            });
        }

        for (const name of options.namedSets ?? []) {
            providers.push({
                provide: getSetToken(name),
                useFactory: (hz: HeliosInstance) => hz.getSet(name),
                inject: [HELIOS_INSTANCE_TOKEN],
            });
        }

        for (const name of options.namedMultiMaps ?? []) {
            providers.push({
                provide: getMultiMapToken(name),
                useFactory: (hz: HeliosInstance) => hz.getMultiMap(name),
                inject: [HELIOS_INSTANCE_TOKEN],
            });
        }

        for (const name of options.namedReplicatedMaps ?? []) {
            providers.push({
                provide: getReplicatedMapToken(name),
                useFactory: (hz: HeliosInstance) => hz.getReplicatedMap(name),
                inject: [HELIOS_INSTANCE_TOKEN],
            });
        }

        return {
            module: HeliosObjectExtractionModule,
            providers,
            exports: providers.map((p) => (p as { provide: string }).provide),
        };
    }
}
