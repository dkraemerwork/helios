/**
 * NestJS module that exposes distributed Helios objects as injectable providers.
 * Port of {@code com.hazelcast.spring.HazelcastObjectExtractionConfiguration}.
 *
 * Import this module alongside {@link HeliosModule} to access named distributed
 * objects (IMap, ITopic, etc.) by name through NestJS injection.
 */

import { DynamicModule, Module, Provider } from '@nestjs/common';
import { HELIOS_INSTANCE_TOKEN } from './HeliosInstanceDefinition';
import type { HeliosInstance } from '@helios/core/core/HeliosInstance';

export interface HeliosObjectExtractionOptions {
    /** Named map token registrations: token → map name */
    maps?: Record<string, string>;
}

@Module({})
export class HeliosObjectExtractionModule {
    /**
     * Register distributed-object providers extracted from the HeliosInstance.
     *
     * @param options  Which distributed objects to expose as providers.
     */
    static forRoot(options: HeliosObjectExtractionOptions = {}): DynamicModule {
        const providers: Provider[] = [];

        for (const [token, name] of Object.entries(options.maps ?? {})) {
            providers.push({
                provide: token,
                useFactory: (hz: HeliosInstance) => (hz as unknown as Record<string, (n: string) => unknown>)['getMap']?.(name),
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
