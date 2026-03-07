/**
 * NestJS module that exposes named Helios distributed objects as injectable providers,
 * with Spring Boot 4–style include/exclude filtering.
 *
 * Ports the behavior of:
 *   {@code com.hazelcast.spring.HazelcastObjectExtractionConfiguration}
 *   {@code com.hazelcast.spring.ExposeHazelcastObjects}
 *   {@code com.hazelcast.spring.boot.HazelcastBoot4ObjectExtractionAutoConfiguration}
 *
 * Usage:
 * ```typescript
 * HeliosBoot4ObjectExtractionModule.forRoot({
 *   objects: [
 *     { token: 'myMap',   name: 'my-map',   type: 'IMap' },
 *     { token: 'myQueue', name: 'my-queue', type: 'IQueue' },
 *   ],
 *   excludeByName: 'legacyMap',
 *   includeByType: ['IMap'],
 * })
 * ```
 */

import { DynamicModule, Module, Provider } from '@nestjs/common';
import type { HeliosInstance } from '@zenystx/helios-core/core/HeliosInstance';
import { HELIOS_INSTANCE_TOKEN } from '../HeliosInstanceDefinition';

/**
 * Supported distributed-object types for type-based include/exclude filtering.
 * Mirrors the Java {@code DistributedObject} sub-interface hierarchy.
 */
export type HeliosObjectType =
    | 'IMap'
    | 'Ringbuffer'
    | 'ITopic'
    | 'IQueue'
    | 'ISet'
    | 'IList'
    | 'MultiMap'
    | 'ReplicatedMap'
    | 'IAtomicLong'
    | 'IAtomicReference'
    | 'ICountDownLatch'
    | 'ISemaphore';

/** Descriptor for a single distributed object to expose as a NestJS provider. */
export interface HeliosObjectDescriptor {
    /** NestJS injection token (typically the same as {@link name}). */
    token: string;
    /** Name of the distributed object in the Helios instance. */
    name: string;
    /** Object type used for type-based include/exclude filtering. */
    type: HeliosObjectType;
}

export interface HeliosBoot4ObjectExtractionOptions {
    /** Objects to consider for registration. */
    objects?: HeliosObjectDescriptor[];

    /**
     * Whitelist by object name. When set, only objects whose {@link name} is
     * present in this array are registered.
     * Equivalent to {@code @ExposeHazelcastObjects(includeByName = {...})}.
     */
    includeByName?: string[];

    /**
     * Blacklist by object name. Objects whose {@link name} matches are skipped.
     * Accepts a single string or an array.
     * Equivalent to {@code @ExposeHazelcastObjects(excludeByName = "...")}.
     */
    excludeByName?: string | string[];

    /**
     * Whitelist by object type. When set, only objects whose {@link type} is
     * present in this array are registered.
     * Equivalent to {@code @ExposeHazelcastObjects(includeByType = {...})}.
     */
    includeByType?: HeliosObjectType[];

    /**
     * Blacklist by object type. Objects whose {@link type} matches are skipped.
     * Equivalent to {@code @ExposeHazelcastObjects(excludeByType = {...})}.
     */
    excludeByType?: HeliosObjectType[];
}

// ---------------------------------------------------------------------------
// Internal type-to-getter mapping
// ---------------------------------------------------------------------------

type ObjectGetter = (hz: HeliosInstance, name: string) => unknown;

const TYPE_GETTERS: Record<HeliosObjectType, ObjectGetter> = {
    IMap: (hz, name) => (hz as unknown as { getMap(n: string): unknown }).getMap?.(name),
    Ringbuffer: (hz, name) => (hz as unknown as { getRingbuffer(n: string): unknown }).getRingbuffer?.(name),
    ITopic: (hz, name) => (hz as unknown as { getTopic(n: string): unknown }).getTopic?.(name),
    IQueue: (hz, name) => (hz as unknown as { getQueue(n: string): unknown }).getQueue?.(name),
    ISet: (hz, name) => (hz as unknown as { getSet(n: string): unknown }).getSet?.(name),
    IList: (hz, name) => (hz as unknown as { getList(n: string): unknown }).getList?.(name),
    MultiMap: (hz, name) => (hz as unknown as { getMultiMap(n: string): unknown }).getMultiMap?.(name),
    ReplicatedMap: (hz, name) => (hz as unknown as { getReplicatedMap(n: string): unknown }).getReplicatedMap?.(name),
    IAtomicLong: (hz, name) => (hz as unknown as { getCPSubsystem(): { getAtomicLong(n: string): unknown } }).getCPSubsystem?.().getAtomicLong?.(name),
    IAtomicReference: (hz, name) => (hz as unknown as { getCPSubsystem(): { getAtomicReference(n: string): unknown } }).getCPSubsystem?.().getAtomicReference?.(name),
    ICountDownLatch: (hz, name) => (hz as unknown as { getCPSubsystem(): { getCountDownLatch(n: string): unknown } }).getCPSubsystem?.().getCountDownLatch?.(name),
    ISemaphore: (hz, name) => (hz as unknown as { getCPSubsystem(): { getSemaphore(n: string): unknown } }).getCPSubsystem?.().getSemaphore?.(name),
};

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

@Module({})
export class HeliosBoot4ObjectExtractionModule {
    /**
     * Register distributed-object providers extracted from the {@link HeliosInstance},
     * applying include/exclude filters as configured.
     *
     * This method is the NestJS equivalent of Spring's
     * {@code @ExposeHazelcastObjects} + {@code HazelcastObjectExtractionConfiguration}.
     */
    static forRoot(options: HeliosBoot4ObjectExtractionOptions = {}): DynamicModule {
        const includeNames = options.includeByName ? new Set(options.includeByName) : null;
        const excludeNames = new Set(
            Array.isArray(options.excludeByName)
                ? options.excludeByName
                : options.excludeByName
                ? [options.excludeByName]
                : [],
        );
        const includeTypes = options.includeByType ? new Set(options.includeByType) : null;
        const excludeTypes = new Set(options.excludeByType ?? []);

        const providers: Provider[] = [];

        for (const descriptor of options.objects ?? []) {
            const { token, name, type } = descriptor;

            const canIncludeByName = (!includeNames || includeNames.has(name)) && !excludeNames.has(name);
            const canIncludeByType = (!includeTypes || includeTypes.has(type)) && !excludeTypes.has(type);

            if (!canIncludeByName || !canIncludeByType) {
                continue;
            }

            const getter = TYPE_GETTERS[type];
            providers.push({
                provide: token,
                useFactory: (hz: HeliosInstance) => getter(hz, name),
                inject: [HELIOS_INSTANCE_TOKEN],
            });
        }

        return {
            module: HeliosBoot4ObjectExtractionModule,
            providers,
            exports: providers.map((p) => (p as { provide: string }).provide),
        };
    }
}
